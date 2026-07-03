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
const TARGET_EMAIL = 'tuaone@berwilson.com'

// Scopes needed for reading mail + calendar via OAuth2 auth code flow.
// Mail.Read.Shared lets Email Research read shared/delegated mailboxes
// (info@, moose@) with tuaone's token — re-consent via /api/email/oauth
// after adding a scope.
const SCOPES = [
  'https://graph.microsoft.com/Mail.Read',
  'https://graph.microsoft.com/Mail.Read.Shared',
  'https://graph.microsoft.com/Calendars.Read',
  'offline_access',
]

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
  webLink: string
}

export interface GraphAttachment {
  id: string
  name: string
  contentType: string
  size: number
  contentBytes?: string // base64 for file attachments
  isInline: boolean
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
    `/users/${email}/messages/${messageId}?$select=id,internetMessageId,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,isRead,webLink`,
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
// Graph API: Calendar
// ---------------------------------------------------------------------------

export interface GraphCalendarEvent {
  id: string
  subject: string
  bodyPreview: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  location: { displayName: string } | null
  organizer: { emailAddress: { name: string; address: string } }
  attendees: {
    emailAddress: { name: string; address: string }
    status: { response: string }
    type: string
  }[]
  isAllDay: boolean
  isCancelled: boolean
  webLink: string
  onlineMeeting: { joinUrl: string } | null
}

/**
 * Fetch calendar events in a time range.
 */
export async function fetchCalendarEvents(
  startDateTime: string,
  endDateTime: string,
  email: string = TARGET_EMAIL
): Promise<GraphCalendarEvent[]> {
  const token = await getValidAccessToken(email)
  const params = new URLSearchParams({
    startDateTime,
    endDateTime,
    $select: 'id,subject,bodyPreview,start,end,location,organizer,attendees,isAllDay,isCancelled,webLink,onlineMeeting',
    $orderby: 'start/dateTime',
    $top: '50',
  })

  const result = await graphFetch<{ value: GraphCalendarEvent[] }>(
    `/users/${email}/calendarView?${params}`,
    token
  )
  // Filter out cancelled events
  return result.value.filter(e => !e.isCancelled)
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
