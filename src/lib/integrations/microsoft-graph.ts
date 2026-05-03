/**
 * Microsoft Graph API integration for email ingestion.
 * Handles OAuth token management, email fetching, and subscription lifecycle.
 */

import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const OAUTH_BASE = 'https://login.microsoftonline.com'
const TARGET_EMAIL = 'info@berwilson.com'

// Scopes needed for reading mail via OAuth2 auth code flow
const SCOPES = ['https://graph.microsoft.com/Mail.Read', 'offline_access']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphTokens {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  scope: string
}

export interface GraphMessage {
  id: string
  internetMessageId: string
  conversationId: string
  subject: string
  bodyPreview: string
  body: { contentType: string; content: string }
  from: { emailAddress: { name: string; address: string } }
  toRecipients: { emailAddress: { name: string; address: string } }[]
  ccRecipients: { emailAddress: { name: string; address: string } }[]
  receivedDateTime: string
  hasAttachments: boolean
  isRead: boolean
}

export interface GraphAttachment {
  id: string
  name: string
  contentType: string
  size: number
  contentBytes?: string // base64 for file attachments
  isInline: boolean
}

export interface GraphSubscription {
  id: string
  resource: string
  changeType: string
  notificationUrl: string
  expirationDateTime: string
  clientState: string
}

export interface ChangeNotification {
  subscriptionId: string
  clientState: string
  changeType: string
  resource: string
  resourceData: {
    '@odata.type': string
    '@odata.id': string
    '@odata.etag': string
    id: string
  }
}

// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

function tenantId(): string {
  return process.env.MICROSOFT_TENANT_ID!
}

function clientId(): string {
  return process.env.MICROSOFT_CLIENT_ID!
}

function clientSecret(): string {
  return process.env.MICROSOFT_CLIENT_SECRET!
}

/**
 * Build the URL the user should visit once to authorize Mail.Read access.
 * After consent, Microsoft redirects to `redirectUri` with an auth code.
 */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
  })
  return `${OAUTH_BASE}/${tenantId()}/oauth2/v2.0/authorize?${params}`
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GraphTokens> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPES.join(' '),
  })

  const res = await fetch(
    `${OAUTH_BASE}/${tenantId()}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token exchange failed: ${res.status} — ${err}`)
  }

  return res.json()
}

/**
 * Refresh an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GraphTokens> {
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES.join(' '),
  })

  const res = await fetch(
    `${OAUTH_BASE}/${tenantId()}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token refresh failed: ${res.status} — ${err}`)
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Token persistence (Supabase)
// ---------------------------------------------------------------------------

/**
 * Store tokens in the email_tokens table. Upserts by email_address.
 */
export async function storeTokens(tokens: GraphTokens, email: string = TARGET_EMAIL) {
  const supabase = createAdminClient()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const { error } = await supabase
    .from('email_tokens')
    .upsert(
      {
        email_address: email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: tokens.token_type,
        expires_at: expiresAt,
        scopes: tokens.scope.split(' '),
      },
      { onConflict: 'email_address' }
    )

  if (error) throw new Error(`Failed to store tokens: ${error.message}`)
}

/**
 * Get a valid access token. Refreshes automatically if expired or within 5 min of expiry.
 */
export async function getValidAccessToken(email: string = TARGET_EMAIL): Promise<string> {
  const supabase = createAdminClient()

  const { data: row, error } = await supabase
    .from('email_tokens')
    .select('*')
    .eq('email_address', email)
    .single()

  if (error || !row) {
    throw new Error(`No stored tokens for ${email}. Run the OAuth flow first.`)
  }

  // Refresh if expired or within 5 minutes of expiry
  const expiresAt = new Date(row.expires_at).getTime()
  const buffer = 5 * 60 * 1000 // 5 minutes
  if (Date.now() + buffer >= expiresAt) {
    const newTokens = await refreshAccessToken(row.refresh_token)
    await storeTokens(newTokens, email)
    return newTokens.access_token
  }

  return row.access_token
}

// ---------------------------------------------------------------------------
// Graph API: Email fetching
// ---------------------------------------------------------------------------

async function graphFetch<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph API ${path} failed: ${res.status} — ${err}`)
  }

  return res.json()
}

/**
 * Fetch a single email message by ID.
 */
export async function fetchMessage(
  messageId: string,
  email: string = TARGET_EMAIL
): Promise<GraphMessage> {
  const token = await getValidAccessToken(email)
  return graphFetch<GraphMessage>(
    `/users/${email}/messages/${messageId}?$select=id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead`,
    token
  )
}

/**
 * Fetch attachments for a message.
 */
export async function fetchAttachments(
  messageId: string,
  email: string = TARGET_EMAIL
): Promise<GraphAttachment[]> {
  const token = await getValidAccessToken(email)
  const result = await graphFetch<{ value: GraphAttachment[] }>(
    `/users/${email}/messages/${messageId}/attachments`,
    token
  )
  return result.value
}

// ---------------------------------------------------------------------------
// Graph API: Subscription management
// ---------------------------------------------------------------------------

/**
 * Create a new webhook subscription for inbox changes.
 * Max subscription duration is ~4230 minutes (~3 days) for mail resources.
 */
export async function createSubscription(
  notificationUrl: string,
  email: string = TARGET_EMAIL
): Promise<GraphSubscription> {
  const token = await getValidAccessToken(email)
  const clientState = process.env.MICROSOFT_WEBHOOK_SECRET!

  // Set expiration to 2 days 23 hours from now (just under max of 3 days)
  const expirationDateTime = new Date(
    Date.now() + 2 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000
  ).toISOString()

  const res = await fetch(`${GRAPH_BASE}/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      resource: `users/${email}/mailFolders/inbox/messages`,
      expirationDateTime,
      clientState,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Create subscription failed: ${res.status} — ${err}`)
  }

  const sub: GraphSubscription = await res.json()

  // Persist to DB
  const supabase = createAdminClient()
  await supabase.from('graph_subscriptions').insert({
    subscription_id: sub.id,
    resource: sub.resource,
    change_type: sub.changeType,
    notification_url: sub.notificationUrl,
    expiration_date_time: sub.expirationDateTime,
    client_state: sub.clientState,
    email_address: email,
    is_active: true,
  })

  return sub
}

/**
 * Renew an existing subscription. Called by the cron job.
 */
export async function renewSubscription(subscriptionId: string): Promise<void> {
  const supabase = createAdminClient()

  const { data: sub, error } = await supabase
    .from('graph_subscriptions')
    .select('*')
    .eq('subscription_id', subscriptionId)
    .single()

  if (error || !sub) {
    throw new Error(`Subscription ${subscriptionId} not found in DB`)
  }

  const token = await getValidAccessToken(sub.email_address)

  // Extend by ~3 days
  const newExpiration = new Date(
    Date.now() + 2 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000
  ).toISOString()

  const res = await fetch(`${GRAPH_BASE}/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expirationDateTime: newExpiration }),
  })

  if (!res.ok) {
    const err = await res.text()
    // If subscription no longer exists, mark as inactive
    if (res.status === 404) {
      await supabase
        .from('graph_subscriptions')
        .update({ is_active: false })
        .eq('subscription_id', subscriptionId)
      throw new Error(`Subscription ${subscriptionId} not found on Graph — marked inactive`)
    }
    throw new Error(`Renew subscription failed: ${res.status} — ${err}`)
  }

  // Update DB expiration
  await supabase
    .from('graph_subscriptions')
    .update({ expiration_date_time: newExpiration })
    .eq('subscription_id', subscriptionId)
}

/**
 * Get all active subscriptions expiring within the given window (ms).
 */
export async function getExpiringSubscriptions(withinMs: number = 24 * 60 * 60 * 1000) {
  const supabase = createAdminClient()
  const threshold = new Date(Date.now() + withinMs).toISOString()

  const { data, error } = await supabase
    .from('graph_subscriptions')
    .select('*')
    .eq('is_active', true)
    .lte('expiration_date_time', threshold)

  if (error) throw new Error(`Failed to query subscriptions: ${error.message}`)
  return data ?? []
}

// ---------------------------------------------------------------------------
// Idempotency: processed email tracking
// ---------------------------------------------------------------------------

/**
 * Check if an email has already been processed (by internetMessageId).
 */
export async function isEmailProcessed(internetMessageId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('processed_emails')
    .select('id')
    .eq('internet_message_id', internetMessageId)
    .maybeSingle()
  return !!data
}

/**
 * Mark an email as processed.
 */
export async function markEmailProcessed(params: {
  internetMessageId: string
  graphMessageId: string
  emailAddress: string
  subject: string
  senderEmail: string
  updateId: string | null
  status?: string
}) {
  const supabase = createAdminClient()
  await supabase.from('processed_emails').insert({
    internet_message_id: params.internetMessageId,
    graph_message_id: params.graphMessageId,
    email_address: params.emailAddress,
    subject: params.subject,
    sender_email: params.senderEmail,
    update_id: params.updateId,
    status: params.status ?? 'processed',
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract plain text from an email body. Prefers text/plain; strips HTML if only HTML available.
 */
export function extractPlainText(body: { contentType: string; content: string }): string {
  if (body.contentType === 'text') {
    return body.content
  }
  // Strip HTML tags, decode common entities, collapse whitespace
  return body.content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
