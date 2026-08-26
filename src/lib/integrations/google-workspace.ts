/**
 * Google Workspace integration — Gmail, Calendar, and Contacts.
 *
 * Replaces the Microsoft Graph integration (removed 2026-08-23). Auth is a
 * **service account with domain-wide delegation**: the platform mints a signed
 * JWT and exchanges it for an access token that impersonates a mailbox
 * directly. There is no consent screen, no redirect URI, and no refresh token
 * to expire — which is the whole point, since this runs headless on the Studio
 * behind Tailscale where an OAuth callback URL is awkward to register.
 *
 * The DWD assertion can be signed two ways, and the platform picks whichever is
 * configured:
 *
 * 1. **Local key** — a downloaded service account JSON key signs it here.
 * 2. **Remote signing (`signJwt`)** — Google signs it with the service
 *    account's *Google-managed* key, which never leaves Google. Needed because
 *    the `iam.managed.disableServiceAccountKeyCreation` org policy on this
 *    organization blocks downloading keys at all. Requires a caller credential
 *    with Token Creator on the service account; that comes from gcloud's
 *    Application Default Credentials.
 *
 * And a third mode that skips service accounts entirely:
 *
 * 3. **Per-mailbox OAuth** — a stored refresh token per mailbox, obtained once
 *    by consent (`scripts/setup-google-oauth.mjs`). No service account, no
 *    domain-wide delegation, no org policy involvement, and nothing to install:
 *    it is set up entirely in the Cloud console plus one browser sign-in per
 *    mailbox. The tradeoff is that a refresh token CAN be revoked — a password
 *    change or an admin revoking app access means re-running the consent — so
 *    the "reconnect the mailbox" story exists again in this mode only.
 *
 * `getAccessToken()` picks whichever is configured, in the order above.
 *
 * Setup lives in `deploy/google-workspace-setup.md`. The service account's
 * client ID must be authorized for SCOPES in the Workspace admin console, or
 * every call here 401s with `unauthorized_client`.
 *
 * Plain fetch, no SDK — same house style as local.ts (§11: one provider
 * surface, no vendor client libraries in the runtime path).
 *
 * Build note: this module reads credential files whose paths come from env
 * vars, so Turbopack can't resolve them statically and emits an
 * "unexpected file in NFT list" warning naming this file. That is expected and
 * harmless — output file tracing only shapes serverless bundles, and this app
 * runs as a long-lived `next start` on the Studio with the whole repo present.
 * Don't "fix" it by hard-coding credential paths.
 */

import { createSign, randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1'
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'
const PEOPLE_BASE = 'https://people.googleapis.com/v1'

/**
 * Scopes requested in the JWT. Must match — exactly, string for string — the
 * scope list authorized against the service account's client ID in
 * Admin console → Security → API controls → Domain-wide delegation.
 * Adding one here without adding it there breaks ALL calls, not just the new one.
 */
export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  // The ONLY write scope, and it is narrow: gmail.send can send mail but cannot
  // read, modify, or delete anything. Needed by the weekly task digest.
  // Tokens minted before this was added keep working (the refresh call does not
  // send `scope`) — they simply cannot send until the mailbox re-consents via
  // `node scripts/setup-google-oauth.mjs`. sendMail() says exactly that.
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  // Write scope for the deadline calendar. Bid dates, site visits and RFI
  // deadlines otherwise exist ONLY inside a tailnet-only app the wider team
  // cannot reach — a mandatory pre-bid site visit nobody can see is a missed
  // bid. Scoped to events, so it cannot create or delete calendars themselves.
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  // Read-only Drive, for the nominated knowledge folder the nightly sync
  // indexes into the company knowledge base. Grants no write of any kind.
  'https://www.googleapis.com/auth/drive.readonly',
] as const

/**
 * Scopes requested for the PRIMARY mailbox only.
 *
 * Docs write is the first genuinely powerful permission this platform asks for:
 * it can edit and delete any Google Doc in the account it is granted on. Only
 * the Drive-sync mailbox needs it (that is the account the knowledge folder is
 * read as), so granting it on all three would hand out authority nothing uses —
 * the opposite of how every other scope here was chosen.
 *
 * The consent script adds these to {@link SCOPES} for PRIMARY_MAILBOX and to no
 * one else. Re-consenting without this entry removes the grant again, which is
 * the intended way to hand the permission back after an edit.
 */
export const PRIMARY_ONLY_SCOPES = [
  // Read + write Google Docs. Needed to correct the knowledge document in place
  // rather than asking a human to hand-edit prose the platform is scored on.
  'https://www.googleapis.com/auth/documents',
] as const

/**
 * Mailboxes the platform reads. Order matters only in that the first is the
 * default for calendar/contact lookups that aren't mailbox-specific.
 * Override with GOOGLE_IMPERSONATE_MAILBOXES (comma separated).
 */
export const MAILBOXES: readonly string[] = (
  process.env.GOOGLE_IMPERSONATE_MAILBOXES ?? 'moose@berwilson.com,tuaone@berwilson.com'
)
  .split(',')
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean)

/** Default mailbox for calendar + contact reads. */
export const PRIMARY_MAILBOX = MAILBOXES[0] ?? 'moose@berwilson.com'

/**
 * Mailboxes swept for INBOUND LEADS rather than deal correspondence.
 *
 * Kept separate from {@link MAILBOXES} because the two pipelines are different
 * shapes and must not mix: deal mail is clustered into multi-thread pursuits and
 * staged as email_intake_sessions, while lead mail is one thread = one lead,
 * triaged and scored on its own. A thread's `pipeline` column records which
 * side it came in on.
 */
export const LEAD_MAILBOXES: readonly string[] = (
  process.env.GOOGLE_LEAD_MAILBOXES ?? 'info@berwilson.com'
)
  .split(',')
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean)

/** Every mailbox the platform holds a credential for, deduped. */
export function allMailboxes(): string[] {
  return [...new Set([...MAILBOXES, ...LEAD_MAILBOXES])]
}

interface ServiceAccountKey {
  client_email: string
  private_key: string
  client_id?: string
}

let _key: ServiceAccountKey | null = null

/**
 * Load the service account key from GOOGLE_SERVICE_ACCOUNT_KEY (raw JSON) or
 * GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path — preferred on the Studio, keeps the
 * multi-line private key out of .env.local).
 */
function serviceAccountKey(): ServiceAccountKey {
  if (_key) return _key

  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_KEY

  let raw: string
  if (file) {
    try {
      raw = readFileSync(file, 'utf8')
    } catch (err) {
      throw new Error(
        `Could not read GOOGLE_SERVICE_ACCOUNT_KEY_FILE at ${file}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  } else if (inline) {
    raw = inline
  } else {
    throw new Error(
      'Google Workspace is not configured — set GOOGLE_SERVICE_ACCOUNT_KEY_FILE (path to the downloaded JSON key) or GOOGLE_SERVICE_ACCOUNT_KEY (the JSON itself).'
    )
  }

  let parsed: ServiceAccountKey
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('The Google service account key is not valid JSON.')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('The Google service account key is missing client_email or private_key.')
  }

  // Env vars carrying the key inline arrive with literal \n instead of newlines.
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  _key = parsed
  return _key
}

/** True when a downloaded key is available to sign locally. */
function hasLocalKey(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  )
}

/**
 * The service account being impersonated. Comes from the key file when one
 * exists; otherwise it must be given explicitly, since without a key there is
 * nothing to read it from.
 */
export function serviceAccountEmail(): string {
  const explicit = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  if (explicit) return explicit
  if (hasLocalKey()) return serviceAccountKey().client_email
  throw new Error(
    'Set GOOGLE_SERVICE_ACCOUNT_EMAIL (the service account address, e.g. berwilson-platform-mail@PROJECT.iam.gserviceaccount.com) — without a downloaded key there is no other way to know which account to impersonate.'
  )
}

/** True when any auth mode is configured — lets callers degrade instead of throwing. */
export function isGoogleConfigured(): boolean {
  if (hasLocalKey()) return true
  // Remote signing needs to know the target account; the ADC credential itself
  // is resolved lazily so a missing gcloud login surfaces as a clear error.
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) return true
  return hasOAuthTokens()
}

// ---------------------------------------------------------------------------
// Auth — signed JWT → impersonated access token
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Build and sign the RS256 assertion that requests impersonation of `mailbox`. */
function buildAssertion(mailbox: string): string {
  const key = serviceAccountKey()
  const now = Math.floor(Date.now() / 1000)

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      sub: mailbox, // the user being impersonated — this is the DWD part
      scope: SCOPES.join(' '),
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    })
  )

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = base64url(signer.sign(key.private_key))

  return `${header}.${claims}.${signature}`
}

// ---------------------------------------------------------------------------
// Remote signing — Application Default Credentials → IAM signJwt
// ---------------------------------------------------------------------------

const IAM_CREDENTIALS_BASE = 'https://iamcredentials.googleapis.com/v1'

interface AdcFile {
  type: string
  client_id?: string
  client_secret?: string
  refresh_token?: string
}

let _adcToken: { token: string; expiresAt: number } | null = null

/**
 * Mint an access token for the *caller* — the identity allowed to ask Google to
 * sign on the service account's behalf.
 *
 * Reads gcloud's Application Default Credentials, written by
 * `gcloud auth application-default login`. That file holds a USER refresh
 * token, not a service account key, which is precisely why it is unaffected by
 * the key-creation policy.
 */
async function adcAccessToken(): Promise<string> {
  if (_adcToken && Date.now() < _adcToken.expiresAt - 5 * 60 * 1000) {
    return _adcToken.token
  }

  const path =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    `${process.env.HOME}/.config/gcloud/application_default_credentials.json`

  let adc: AdcFile
  try {
    adc = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(
      `No Application Default Credentials at ${path}. Run: gcloud auth application-default login --no-launch-browser`
    )
  }

  if (adc.type === 'service_account') {
    // A key file pointed at by GOOGLE_APPLICATION_CREDENTIALS — the caller
    // should be using local signing instead of coming through here.
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS points at a service account key. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE to that path instead and the platform will sign locally.'
    )
  }
  if (!adc.refresh_token || !adc.client_id || !adc.client_secret) {
    throw new Error(`The credentials at ${path} are not a usable authorized_user credential.`)
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Could not refresh the gcloud credential: ${res.status} — ${explainTokenError(text)}`
    )
  }

  const data = JSON.parse(text) as { access_token: string; expires_in: number }
  _adcToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return _adcToken.token
}

/**
 * Ask Google to sign a JWT payload with the service account's Google-managed
 * key. The payload carries the DWD `sub` claim, so the resulting assertion
 * impersonates a mailbox exactly as a locally-signed one would.
 */
async function signJwtRemotely(payload: Record<string, unknown>): Promise<string> {
  const caller = await adcAccessToken()
  const sa = serviceAccountEmail()

  const res = await fetch(
    `${IAM_CREDENTIALS_BASE}/projects/-/serviceAccounts/${encodeURIComponent(sa)}:signJwt`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${caller}`,
        'Content-Type': 'application/json',
      },
      // The API takes the claim set as a JSON *string*, not an object.
      body: JSON.stringify({ payload: JSON.stringify(payload) }),
    }
  )

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`signJwt failed: ${res.status} — ${explainSignJwtError(text, sa)}`)
  }
  return (JSON.parse(text) as { signedJwt: string }).signedJwt
}

/** Translate the signJwt failures that actually happen into plain English. */
function explainSignJwtError(raw: string, sa: string): string {
  if (raw.includes('PERMISSION_DENIED') || raw.includes('iam.serviceAccounts.signJwt')) {
    return `the signed-in gcloud account lacks Token Creator on ${sa}. Grant it with:\n  gcloud iam service-accounts add-iam-policy-binding ${sa} --member="user:YOUR@berwilson.com" --role="roles/iam.serviceAccountTokenCreator"`
  }
  if (raw.includes('has not been used in project') || raw.includes('SERVICE_DISABLED')) {
    return 'the IAM Service Account Credentials API is not enabled. Enable it with:\n  gcloud services enable iamcredentials.googleapis.com'
  }
  if (raw.includes('NOT_FOUND')) {
    return `the service account ${sa} was not found. Check GOOGLE_SERVICE_ACCOUNT_EMAIL.`
  }
  return raw.slice(0, 400)
}

/** Same claim set as buildAssertion, but signed by Google rather than locally. */
async function buildAssertionRemote(mailbox: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signJwtRemotely({
    iss: serviceAccountEmail(),
    sub: mailbox, // the user being impersonated — this is the DWD part
    scope: SCOPES.join(' '),
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  })
}

// ---------------------------------------------------------------------------
// Mode 3 — per-mailbox OAuth refresh tokens
// ---------------------------------------------------------------------------

interface OAuthClient {
  client_id: string
  client_secret: string
}

interface OAuthStore {
  client: OAuthClient
  /** mailbox address (lowercased) → refresh token */
  tokens: Record<string, string>
}

let _oauthStore: OAuthStore | null = null

/** Where the consent script writes its result. */
export function oauthTokensPath(): string {
  return (
    process.env.GOOGLE_OAUTH_TOKENS_FILE ??
    `${process.env.HOME}/berwilson-data/google-oauth-tokens.json`
  )
}

function hasOAuthTokens(): boolean {
  // A stat, not a read — this runs on every isGoogleConfigured() call, and the
  // file holds live credentials worth touching as little as possible.
  try {
    return existsSync(oauthTokensPath())
  } catch {
    return false
  }
}

function oauthStore(): OAuthStore {
  if (_oauthStore) return _oauthStore
  const path = oauthTokensPath()
  let parsed: OAuthStore
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(
      `No OAuth tokens at ${path}. Run: node scripts/setup-google-oauth.mjs`
    )
  }
  if (!parsed.client?.client_id || !parsed.client?.client_secret) {
    throw new Error(`${path} is missing the OAuth client details — re-run the consent script.`)
  }
  _oauthStore = parsed
  return parsed
}

/** Exchange a mailbox's stored refresh token for a fresh access token. */
async function oauthAccessToken(mailbox: string): Promise<string> {
  const store = oauthStore()
  const refreshToken = store.tokens[mailbox.toLowerCase()]
  if (!refreshToken) {
    throw new Error(
      `No stored consent for ${mailbox}. Run: node scripts/setup-google-oauth.mjs`
    )
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: store.client.client_id,
      client_secret: store.client.client_secret,
      refresh_token: refreshToken,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `Google token request for ${mailbox} failed: ${res.status} — ${explainOAuthError(text, mailbox)}`
    )
  }
  return (JSON.parse(text) as { access_token: string }).access_token
}

function explainOAuthError(raw: string, mailbox: string): string {
  if (raw.includes('invalid_grant')) {
    return `the stored consent for ${mailbox} is no longer valid — usually a password change or an admin revoking app access. Re-consent with: node scripts/setup-google-oauth.mjs`
  }
  if (raw.includes('invalid_client')) {
    return 'the OAuth client id/secret was rejected. The client may have been deleted in the Cloud console — recreate it and re-run the consent script.'
  }
  return raw.slice(0, 400)
}

interface CachedToken {
  token: string
  expiresAt: number
}

/** Access tokens are good for an hour; cache per mailbox in module memory. */
const tokenCache = new Map<string, CachedToken>()

/**
 * Get a valid access token impersonating `mailbox`. Cached until 5 minutes
 * before expiry, then silently re-minted — no stored state, so there is
 * nothing to "reconnect".
 */
export async function getAccessToken(mailbox: string = PRIMARY_MAILBOX): Promise<string> {
  const key = mailbox.toLowerCase()
  const cached = tokenCache.get(key)
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.token
  }

  // Mode 3: no service account in play at all.
  if (!hasLocalKey() && !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    const token = await oauthAccessToken(key)
    // Google's refresh response reports expires_in; re-fetching an hour later is
    // cheap, so cache conservatively rather than parsing it twice.
    tokenCache.set(key, { token, expiresAt: Date.now() + 55 * 60 * 1000 })
    return token
  }

  const assertion = hasLocalKey() ? buildAssertion(key) : await buildAssertionRemote(key)

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  })

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Google token request for ${mailbox} failed: ${res.status} — ${explainTokenError(text)}`)
  }

  const data = JSON.parse(text) as { access_token: string; expires_in: number }
  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  })
  return data.access_token
}

/** Translate the handful of Google auth errors we actually expect into plain English. */
export function explainTokenError(raw: string): string {
  if (raw.includes('unauthorized_client')) {
    return 'the service account is not authorized for these scopes. In the Workspace admin console → Security → API controls → Domain-wide delegation, confirm the client ID is listed with EXACTLY the scopes in SCOPES (a single missing scope fails the whole grant).'
  }
  if (raw.includes('invalid_grant')) {
    return 'the impersonated mailbox was rejected. Check the address exists in the Workspace domain and that the server clock is accurate (a skewed clock invalidates the signed JWT).'
  }
  if (raw.includes('invalid_client') || raw.includes('Invalid JWT Signature')) {
    return 'the service account key was rejected. It may have been deleted or rotated in Google Cloud — download a fresh JSON key and update GOOGLE_SERVICE_ACCOUNT_KEY_FILE.'
  }
  if (raw.includes('insufficientPermissions') || raw.includes('insufficient authentication scopes')) {
    // The token predates a scope the code now needs — the usual cause is a
    // scope added to SCOPES without re-running consent for each mailbox.
    return 'the stored consent predates a scope this call needs. Re-consent with: node scripts/setup-google-oauth.mjs'
  }
  if (raw.includes('accessNotConfigured') || raw.includes('has not been used in project')) {
    // Google's own message names the exact API and includes a direct enable
    // link for this project, which beats any list we hard-code here — the
    // original text said "Gmail, Calendar, and People" and so pointed the
    // reader at the wrong three APIs the day Drive was added.
    const detail = /"message":\s*"([^"]*has not been used in project[^"]*)"/.exec(raw)?.[1]
    if (detail) return `the required API is not enabled on the Google Cloud project. ${detail}`
    return 'the required API is not enabled on the Google Cloud project. Enable it in the Cloud console (APIs & Services → Library), then retry.'
  }
  return raw.slice(0, 400)
}

export async function googleFetch<T>(url: string, mailbox: string): Promise<T> {
  const token = await getAccessToken(mailbox)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    const err = await res.text()
    const path = url.split('?')[0].replace(/https:\/\/[^/]+/, '')
    throw new Error(`Google API ${path} failed: ${res.status} — ${explainTokenError(err)}`)
  }
  return res.json() as Promise<T>
}

/** Same auth path as {@link googleFetch}, but for endpoints that return bytes. */
export async function googleFetchBytes(url: string, mailbox: string): Promise<ArrayBuffer> {
  const token = await getAccessToken(mailbox)
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    const err = await res.text()
    const path = url.split('?')[0].replace(/https:\/\/[^/]+/, '')
    throw new Error(`Google API ${path} failed: ${res.status} — ${explainTokenError(err)}`)
  }
  return res.arrayBuffer()
}

/**
 * Send an HTML email as `from` via Gmail (`users.messages.send`).
 *
 * Replaces the Microsoft Graph sendMail removed with the rest of Graph on
 * 2026-08-23. The outbound notification layer (src/lib/notify) is the only
 * caller; everything else here is read-only.
 *
 * Requires the gmail.send scope. Refresh tokens minted before that scope was
 * added will fail here with a 403 — the error below names the fix rather than
 * leaving a bare Google error in notification_log.
 */
/** A file to attach to an outbound message. */
export interface MailAttachment {
  fileName: string
  mimeType: string
  /** Raw bytes — base64 encoding happens here. */
  content: Buffer | ArrayBuffer
}

export async function sendMail(opts: {
  to: string
  subject: string
  html: string
  from?: string
  attachments?: MailAttachment[]
}): Promise<void> {
  const from = opts.from ?? PRIMARY_MAILBOX
  const token = await getAccessToken(from)

  // RFC 2822. Subject is RFC 2047 encoded so non-ASCII survives the hop.
  const subject = /^[\x20-\x7E]*$/.test(opts.subject)
    ? opts.subject
    : `=?UTF-8?B?${Buffer.from(opts.subject, 'utf8').toString('base64')}?=`

  const attachments = opts.attachments ?? []
  const headers = [`From: ${from}`, `To: ${opts.to}`, `Subject: ${subject}`, 'MIME-Version: 1.0']

  let message: string
  if (attachments.length === 0) {
    message = [...headers, 'Content-Type: text/html; charset=UTF-8', '', opts.html].join('\r\n')
  } else {
    // A boundary must not occur in any part. Random hex is the conventional
    // guarantee, and these are one-shot messages so it need not be reproducible.
    const boundary = `bw_${randomBytes(16).toString('hex')}`
    const parts: string[] = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      opts.html,
    ]

    for (const a of attachments) {
      const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content)
      parts.push(
        `--${boundary}`,
        `Content-Type: ${a.mimeType}; name="${a.fileName.replace(/"/g, '')}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${a.fileName.replace(/"/g, '')}"`,
        '',
        // RFC 2045 caps encoded lines at 76 characters.
        buf.toString('base64').replace(/(.{76})/g, '$1\r\n')
      )
    }

    parts.push(`--${boundary}--`, '')
    message = parts.join('\r\n')
  }

  const raw = base64url(Buffer.from(message, 'utf8'))

  const res = await fetch(
    `${GMAIL_BASE}/users/${encodeURIComponent(from)}/messages/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    if (res.status === 403 || err.includes('insufficient') || err.includes('scope')) {
      throw new Error(
        `Gmail refused to send as ${from}: the stored token lacks the gmail.send scope. ` +
          `Re-consent that mailbox with: node scripts/setup-google-oauth.mjs --only ${from}`
      )
    }
    throw new Error(`Gmail send as ${from} failed: ${res.status} — ${explainTokenError(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Gmail — types
// ---------------------------------------------------------------------------

export interface EmailAddress {
  name: string
  address: string
}

/** A Gmail message normalized into the shape the ingestion pipeline consumes. */
export interface MailMessage {
  /** Gmail's per-mailbox message id — only valid within `mailbox`. */
  id: string
  /** Gmail's per-mailbox thread id — differs between mailboxes for the SAME thread. */
  threadId: string
  /** RFC 2822 Message-ID. Stable across mailboxes — the real dedupe key. */
  messageId: string
  mailbox: string
  subject: string
  from: EmailAddress | null
  to: EmailAddress[]
  cc: EmailAddress[]
  /** ISO 8601, from the internal Gmail timestamp (not the spoofable Date header). */
  receivedAt: string
  bodyText: string
  snippet: string
  attachments: MailAttachmentRef[]
  webLink: string
}

/** Attachment metadata. Gmail does NOT return bytes inline — see fetchAttachmentBytes. */
export interface MailAttachmentRef {
  attachmentId: string
  messageId: string
  name: string
  mimeType: string
  size: number
  isInline: boolean
}

interface GmailHeader {
  name: string
  value: string
}

interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { attachmentId?: string; size?: number; data?: string }
  parts?: GmailPart[]
}

interface GmailMessageRaw {
  id: string
  threadId: string
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}

interface GmailThreadRaw {
  id: string
  messages?: GmailMessageRaw[]
}

// ---------------------------------------------------------------------------
// Gmail — MIME parsing
// ---------------------------------------------------------------------------

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  const target = name.toLowerCase()
  return headers?.find((h) => h.name.toLowerCase() === target)?.value ?? ''
}

/**
 * Parse an RFC 5322 address list ("Jane Doe" <jane@x.com>, bob@y.com).
 * Deliberately simple — good enough for display and matching, and it never
 * throws on the malformed headers real mail is full of.
 */
export function parseAddressList(raw: string): EmailAddress[] {
  if (!raw.trim()) return []

  // Split on commas that are not inside quotes or angle brackets. Display
  // names routinely contain commas ("Doe, Jane" <jane@x.com>), so a plain
  // split(',') would shred them.
  const chunks: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch === '<') depth++
    else if (!quoted && ch === '>') depth--
    if (ch === ',' && !quoted && depth <= 0) {
      chunks.push(current)
      current = ''
      continue
    }
    current += ch
  }
  chunks.push(current)

  return chunks
    .map((chunk) => {
      const s = chunk.trim()
      if (!s) return null
      const angle = s.match(/^(.*?)<([^>]+)>$/)
      if (angle) {
        const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim()
        const address = angle[2].trim().toLowerCase()
        return { name: name || address, address }
      }
      const address = s.toLowerCase()
      return { name: address, address }
    })
    .filter((a): a is EmailAddress => a !== null && Boolean(a.address))
}

/** Strip HTML down to readable plain text. Ported from the Graph integration. */
export function htmlToPlainText(html: string): string {
  return html
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

/**
 * Walk the MIME tree collecting the best body text and every attachment.
 * Prefers text/plain; falls back to stripped text/html when that's all there is.
 */
function walkParts(
  part: GmailPart | undefined,
  messageId: string,
  acc: { plain: string[]; html: string[]; attachments: MailAttachmentRef[] }
): void {
  if (!part) return

  const mime = (part.mimeType ?? '').toLowerCase()
  const filename = part.filename ?? ''
  const attachmentId = part.body?.attachmentId

  if (attachmentId && filename) {
    // Inline images carry a Content-ID and are referenced from the HTML body;
    // they're chrome (signatures, logos), not documents worth ingesting.
    const contentId = headerValue(part.headers, 'content-id')
    const disposition = headerValue(part.headers, 'content-disposition').toLowerCase()
    acc.attachments.push({
      attachmentId,
      messageId,
      name: filename,
      mimeType: part.mimeType ?? 'application/octet-stream',
      size: part.body?.size ?? 0,
      isInline: Boolean(contentId) || disposition.startsWith('inline'),
    })
  } else if (part.body?.data) {
    if (mime === 'text/plain') acc.plain.push(decodeBase64Url(part.body.data))
    else if (mime === 'text/html') acc.html.push(decodeBase64Url(part.body.data))
  }

  for (const child of part.parts ?? []) walkParts(child, messageId, acc)
}

function normalizeMessage(raw: GmailMessageRaw, mailbox: string): MailMessage {
  const headers = raw.payload?.headers
  const acc = { plain: [] as string[], html: [] as string[], attachments: [] as MailAttachmentRef[] }
  walkParts(raw.payload, raw.id, acc)

  const bodyText = acc.plain.length > 0
    ? acc.plain.join('\n').trim()
    : htmlToPlainText(acc.html.join('\n'))

  const from = parseAddressList(headerValue(headers, 'from'))[0] ?? null

  // internalDate is Gmail's own receipt timestamp in epoch ms — unlike the
  // Date header it can't be forged or wrong, so threads sort correctly.
  const receivedAt = raw.internalDate
    ? new Date(Number(raw.internalDate)).toISOString()
    : new Date(0).toISOString()

  return {
    id: raw.id,
    threadId: raw.threadId,
    messageId: headerValue(headers, 'message-id').trim() || `gmail:${raw.id}`,
    mailbox,
    subject: headerValue(headers, 'subject') || '(no subject)',
    from,
    to: parseAddressList(headerValue(headers, 'to')),
    cc: parseAddressList(headerValue(headers, 'cc')),
    receivedAt,
    bodyText,
    snippet: raw.snippet ?? '',
    attachments: acc.attachments,
    webLink: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${raw.threadId}`,
  }
}

// ---------------------------------------------------------------------------
// Gmail — reading
// ---------------------------------------------------------------------------

export interface ThreadStub {
  threadId: string
  mailbox: string
  snippet: string
  historyId: string
}

export interface ListThreadsResult {
  threads: ThreadStub[]
  nextPageToken: string | null
  /** Gmail's estimate of total matches — approximate, and only on page one. */
  estimatedTotal: number | null
}

/**
 * Page through a mailbox's threads. `q` is Gmail search syntax, which — unlike
 * Graph's $search — supports server-side date filtering (`after:2025/01/01`),
 * so no client-side date pass is needed.
 */
export async function listThreads(
  mailbox: string,
  opts: { q?: string; pageToken?: string | null; maxResults?: number } = {}
): Promise<ListThreadsResult> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(opts.maxResults ?? 100, 500)),
  })
  if (opts.q) params.set('q', opts.q)
  if (opts.pageToken) params.set('pageToken', opts.pageToken)

  const data = await googleFetch<{
    threads?: { id: string; snippet?: string; historyId?: string }[]
    nextPageToken?: string
    resultSizeEstimate?: number
  }>(`${GMAIL_BASE}/users/${encodeURIComponent(mailbox)}/threads?${params}`, mailbox)

  return {
    threads: (data.threads ?? []).map((t) => ({
      threadId: t.id,
      mailbox,
      snippet: t.snippet ?? '',
      historyId: t.historyId ?? '',
    })),
    nextPageToken: data.nextPageToken ?? null,
    estimatedTotal: data.resultSizeEstimate ?? null,
  }
}

/**
 * Fetch every message in one thread, oldest first. One API call — Gmail returns
 * the full thread inline, which is a meaningful improvement over Graph's
 * filter-then-sort dance.
 */
export async function fetchThread(mailbox: string, threadId: string): Promise<MailMessage[]> {
  const data = await googleFetch<GmailThreadRaw>(
    `${GMAIL_BASE}/users/${encodeURIComponent(mailbox)}/threads/${encodeURIComponent(threadId)}?format=full`,
    mailbox
  )
  return (data.messages ?? [])
    .map((m) => normalizeMessage(m, mailbox))
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
}

/**
 * Download one attachment's bytes as base64.
 *
 * Gmail, unlike Graph, does not include file bytes in the message payload —
 * every attachment costs an extra round trip, which is why callers should
 * filter by size/type BEFORE calling this.
 */
export async function fetchAttachmentBytes(
  mailbox: string,
  messageId: string,
  attachmentId: string
): Promise<string | null> {
  const data = await googleFetch<{ data?: string; size?: number }>(
    `${GMAIL_BASE}/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(
      messageId
    )}/attachments/${encodeURIComponent(attachmentId)}`,
    mailbox
  )
  if (!data.data) return null
  // Gmail returns base64url; storage and the AI file path both want plain base64.
  return Buffer.from(data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64')
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarAttendee {
  name: string
  email: string
  /** accepted | declined | tentative | needsAction */
  response: string
  optional: boolean
}

/** Provider-neutral calendar event — consumers no longer see Graph's shape. */
export interface CalendarEvent {
  id: string
  subject: string
  bodyPreview: string
  /** ISO 8601 with offset for timed events; YYYY-MM-DD for all-day events. */
  start: string
  end: string
  isAllDay: boolean
  location: string | null
  organizer: { name: string; email: string } | null
  attendees: CalendarAttendee[]
  webLink: string
  joinUrl: string | null
}

interface GoogleEventRaw {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  organizer?: { email?: string; displayName?: string }
  attendees?: { email?: string; displayName?: string; responseStatus?: string; optional?: boolean }[]
  htmlLink?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
}

/**
 * Fetch calendar events in a time range for one mailbox.
 * `singleEvents` expands recurring series into individual instances, which is
 * what every consumer here actually wants.
 */
export async function fetchCalendarEvents(
  timeMin: string,
  timeMax: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })

  const data = await googleFetch<{ items?: GoogleEventRaw[] }>(
    `${CALENDAR_BASE}/calendars/${encodeURIComponent(mailbox)}/events?${params}`,
    mailbox
  )

  return (data.items ?? [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const isAllDay = Boolean(e.start?.date)
      const meetUri =
        e.hangoutLink ??
        e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ??
        null

      return {
        id: e.id,
        subject: e.summary || '(no subject)',
        bodyPreview: (e.description ?? '').slice(0, 500),
        start: e.start?.dateTime ?? e.start?.date ?? '',
        end: e.end?.dateTime ?? e.end?.date ?? '',
        isAllDay,
        location: e.location ?? null,
        organizer: e.organizer?.email
          ? { name: e.organizer.displayName || e.organizer.email, email: e.organizer.email }
          : null,
        attendees: (e.attendees ?? [])
          .filter((a) => a.email)
          .map((a) => ({
            name: a.displayName || a.email!,
            email: a.email!.toLowerCase(),
            response: a.responseStatus ?? 'needsAction',
            optional: a.optional === true,
          })),
        webLink: e.htmlLink ?? '',
        joinUrl: meetUri,
      }
    })
}

// ---------------------------------------------------------------------------
// Contacts (People API) — used by party enrichment
// ---------------------------------------------------------------------------

export interface ContactLookupResult {
  displayName?: string
  jobTitle?: string
  companyName?: string
  phone?: string
}

interface PersonRaw {
  names?: { displayName?: string }[]
  organizations?: { name?: string; title?: string }[]
  phoneNumbers?: { value?: string }[]
}

/**
 * Look up a contact by email address across the mailbox's saved contacts and
 * "other contacts" (people they've corresponded with but never saved — which
 * is where most counterparties actually live).
 *
 * Returns null rather than throwing when Google isn't configured or the
 * lookup fails: enrichment treats this as one optional source among several.
 */
export async function lookupContactByEmail(
  email: string,
  mailbox: string = PRIMARY_MAILBOX
): Promise<ContactLookupResult | null> {
  if (!isGoogleConfigured()) return null

  const readMask = 'names,organizations,phoneNumbers'
  const endpoints = [
    `${PEOPLE_BASE}/people:searchContacts?query=${encodeURIComponent(email)}&readMask=${readMask}`,
    `${PEOPLE_BASE}/otherContacts:search?query=${encodeURIComponent(email)}&readMask=${readMask}`,
  ]

  for (const url of endpoints) {
    try {
      const data = await googleFetch<{ results?: { person?: PersonRaw }[] }>(url, mailbox)
      const person = data.results?.[0]?.person
      if (!person) continue

      const org = person.organizations?.[0]
      return {
        displayName: person.names?.[0]?.displayName,
        jobTitle: org?.title,
        companyName: org?.name,
        phone: person.phoneNumbers?.[0]?.value,
      }
    } catch {
      // Try the next endpoint; a miss here is never fatal to enrichment.
      continue
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Health probe
// ---------------------------------------------------------------------------

export interface GoogleProbe {
  state: 'ok' | 'broken' | 'disconnected'
  mailboxes?: { email: string; ok: boolean; error?: string }[]
  /** Which signing mode is active — the first thing to check when debugging. */
  signingMode?: 'local key' | 'google-managed key (signJwt)' | 'per-mailbox OAuth'
  reason?: string
  rawError?: string
}

/**
 * Definitive connection test: mint a real token for every configured mailbox.
 * Unlike the Graph probe this needs no stored state — a failure here is always
 * a configuration problem (scopes, key, or clock), never an expired grant.
 */
export async function probeGoogleConnection(): Promise<GoogleProbe> {
  if (!isGoogleConfigured()) {
    return {
      state: 'disconnected',
      reason:
        'Google is not configured — run node scripts/setup-google-oauth.mjs (per-mailbox OAuth), or set GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY_FILE. See deploy/google-workspace-setup.md.',
    }
  }

  const signingMode: GoogleProbe['signingMode'] = hasLocalKey()
    ? 'local key'
    : process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
      ? 'google-managed key (signJwt)'
      : 'per-mailbox OAuth'

  const results = await Promise.all(
    MAILBOXES.map(async (email) => {
      try {
        // Bypass the cache so this probes Google rather than module memory.
        tokenCache.delete(email)
        await getAccessToken(email)
        return { email, ok: true }
      } catch (err) {
        return { email, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  )

  const failed = results.filter((r) => !r.ok)
  if (failed.length === 0) return { state: 'ok', mailboxes: results, signingMode }

  return {
    state: 'broken',
    mailboxes: results,
    signingMode,
    reason:
      failed.length === MAILBOXES.length
        ? signingMode === 'per-mailbox OAuth'
          ? 'No mailbox could be reached — the stored consent is missing or was revoked. Re-run node scripts/setup-google-oauth.mjs.'
          : 'No mailbox could be reached — the domain-wide delegation grant is missing or its scopes do not match.'
        : `${failed.length} of ${MAILBOXES.length} mailboxes could not be reached.`,
    rawError: failed[0]?.error,
  }
}

/** A date-only deadline written to the calendar as an all-day event. */
export interface CalendarWrite {
  /** Stable key so re-running never creates a second copy of the same date. */
  externalId: string
  summary: string
  description?: string | null
  location?: string | null
  /** YYYY-MM-DD. All-day: a bid deadline is a day, not a moment. */
  date: string
  /** Who should see it. Defaults to the calendar owner only. */
  attendees?: string[]
}

/**
 * Create or update an all-day event, keyed by {@link CalendarWrite.externalId}.
 *
 * Idempotent by construction: Google lets the caller supply the event id, so
 * the same deadline written twice is one event that gets updated, not two that
 * both fire. That matters because the lead sweep runs daily and a bid date can
 * change — an ITB whose date moves should MOVE, not duplicate.
 *
 * Never throws: a calendar write failing must not fail the sweep that produced
 * the lead. The lead is safe in the queue either way.
 */
export async function upsertCalendarEvent(
  event: CalendarWrite,
  mailbox: string = PRIMARY_MAILBOX
): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  // Google requires event ids to be base32hex (lowercase a-v and 0-9), 5-1024
  // chars. A UUID with the hyphens stripped is not valid — w/x/y/z appear — so
  // the key is hashed into the allowed alphabet.
  const id = externalIdToEventId(event.externalId)
  const token = await getAccessToken(mailbox)

  const end = new Date(`${event.date}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1) // all-day end is exclusive

  const body = {
    id,
    summary: event.summary,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    start: { date: event.date },
    end: { date: end.toISOString().split('T')[0] },
    ...(event.attendees?.length
      ? { attendees: event.attendees.map((email) => ({ email })) }
      : {}),
    // A deadline you are not reminded of is a deadline you miss.
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 },
        { method: 'popup', minutes: 3 * 24 * 60 },
      ],
    },
  }

  const base = `${CALENDAR_BASE}/calendars/${encodeURIComponent(mailbox)}/events`
  const insert = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (insert.ok) return { ok: true, created: true }

  // 409 means the id already exists — the deadline is already on the calendar,
  // so update it in place rather than leaving a stale date sitting there.
  if (insert.status === 409) {
    const patch = await fetch(`${base}/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (patch.ok) return { ok: true, created: false }
    return { ok: false, error: explainTokenError(await patch.text()) }
  }

  return { ok: false, error: explainTokenError(await insert.text()) }
}

/** Map any string to a valid Google event id (base32hex, deterministic). */
function externalIdToEventId(external: string): string {
  const hash = createHash('sha1').update(external).digest('hex')
  // hex uses 0-9a-f, all inside base32hex's 0-9a-v — valid as-is.
  return `bw${hash}`
}

/**
 * Do the stored consents actually carry every scope the code declares?
 *
 * Adding a scope to {@link SCOPES} does nothing to tokens already minted — they
 * keep working for everything they were granted and 403 on the new call, which
 * surfaces at the worst possible moment as a raw permissions error. This has
 * happened twice: drive.readonly, then calendar.events. The consent script no
 * longer drifts (it reads SCOPES from this file), but a stored token can still
 * predate a scope, and only re-consent fixes that.
 *
 * Cheap: one refresh per mailbox, and Google returns the granted scope list in
 * the same response. Never throws.
 */
export async function probeScopeCoverage(): Promise<{
  state: 'ok' | 'stale' | 'unknown'
  missing: { mailbox: string; scopes: string[] }[]
  detail: string
}> {
  const store = (() => {
    try {
      return oauthStore()
    } catch {
      return null
    }
  })()

  // Only per-mailbox OAuth has a stored grant to go stale; a service account
  // is authorised centrally and picks up scope changes without re-consent.
  if (!store) return { state: 'unknown', missing: [], detail: 'Not using per-mailbox OAuth.' }

  const wanted = SCOPES as readonly string[]
  const missing: { mailbox: string; scopes: string[] }[] = []

  for (const mailbox of Object.keys(store.tokens)) {
    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: store.client.client_id,
          client_secret: store.client.client_secret,
          refresh_token: store.tokens[mailbox],
        }),
      })
      if (!res.ok) continue // connection health is the other probe's job
      const granted = String(((await res.json()) as { scope?: string }).scope ?? '').split(' ')
      const gaps = wanted.filter((w) => !granted.includes(w))
      if (gaps.length > 0) {
        missing.push({ mailbox, scopes: gaps.map((g) => g.split('/auth/')[1] ?? g) })
      }
    } catch {
      // Ignore — an unreachable Google is not a scope problem.
    }
  }

  if (missing.length === 0) {
    return { state: 'ok', missing, detail: `All ${wanted.length} scopes granted on every connected mailbox.` }
  }

  return {
    state: 'stale',
    missing,
    detail: `${missing
      .map((m) => `${m.mailbox} is missing ${m.scopes.join(', ')}`)
      .join('; ')}. Features using those scopes will fail with a permissions error until you re-consent: node scripts/setup-google-oauth.mjs`,
  }
}
