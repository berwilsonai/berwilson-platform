#!/usr/bin/env node
/**
 * One-time mailbox consent — the no-gcloud, no-service-account path.
 *
 *   node scripts/setup-google-oauth.mjs
 *
 * Point it at the OAuth client JSON you downloaded from the Cloud console, and
 * it walks you through signing in as each mailbox. The result is written to
 * ~/berwilson-data/google-oauth-tokens.json, which is what the platform reads.
 *
 * Why this exists: this organization blocks service account key downloads, and
 * the keyless alternative needs gcloud installed on the machine. An OAuth
 * client secret is NOT a service account key, so it downloads fine, and the
 * consent happens in a browser — nothing to install.
 *
 * Read-only scopes. Re-run any time to re-consent a mailbox.
 */

import { createServer } from 'http'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { createInterface } from 'readline/promises'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const PORT = 47823 // fixed, so it can be registered as a redirect URI if needed

/**
 * The scope list is READ FROM the app rather than duplicated here.
 *
 * It used to be a second hand-maintained copy, and it drifted twice in one day:
 * drive.readonly, then calendar.events were each added to the app and not to
 * this file, so a consent run minted tokens that 403'd on the first call — the
 * precise failure the old comment here warned about, which is what a duplicated
 * constant guarantees eventually. Parsing the source is less elegant than an
 * import and completely removes the class of bug; this is a dev script, so the
 * coupling costs nothing at runtime.
 */
function loadScopes() {
  const src = join(
    dirname(fileURLToPath(import.meta.url)),
    '../src/lib/integrations/google-workspace.ts'
  )
  const text = readFileSync(src, 'utf8')

  /** Pull one `export const NAME = [ ... ]` scope array out of the source. */
  const block = (name) => {
    const start = text.indexOf(`export const ${name} = [`)
    if (start === -1) return []
    const chunk = text.slice(start)
    return [
      ...chunk
        .slice(0, chunk.indexOf(']'))
        .matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g),
    ].map((m) => m[1])
  }

  const scopes = block('SCOPES')
  if (scopes.length === 0) {
    console.error(`\n${RED}Could not read SCOPES from ${src}.${OFF}`)
    console.error('Consenting with a guessed scope list would mint tokens that fail later.\n')
    process.exit(1)
  }
  // The narrower tiers are optional by construction — an empty one just means
  // no mailbox is currently singled out for elevated access.
  return {
    scopes,
    primaryOnly: block('PRIMARY_ONLY_SCOPES'),
    leadOnly: block('LEAD_ONLY_SCOPES'),
  }
}

const {
  scopes: SCOPES,
  primaryOnly: PRIMARY_ONLY_SCOPES,
  leadOnly: LEAD_ONLY_SCOPES,
} = loadScopes()

const GREEN = '\x1b[32m', RED = '\x1b[31m', BOLD = '\x1b[1m', DIM = '\x1b[2m', OFF = '\x1b[0m'

const TOKENS_PATH =
  process.env.GOOGLE_OAUTH_TOKENS_FILE ??
  join(process.env.HOME, 'berwilson-data/google-oauth-tokens.json')

// Both pipelines' mailboxes. The lead sweep reads info@, which is NOT in
// GOOGLE_IMPERSONATE_MAILBOXES — leaving it out here would mint tokens for the
// deal mailboxes only and the lead sweep would fail with no credential.
const ALL_MAILBOXES = [
  ...new Set(
    [
      process.env.GOOGLE_IMPERSONATE_MAILBOXES ?? 'moose@berwilson.com,tuaone@berwilson.com',
      process.env.GOOGLE_LEAD_MAILBOXES ?? 'info@berwilson.com',
    ]
      .join(',')
      .split(',')
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean)
  ),
]

const LEAD_MAILBOX_SET = new Set(
  (process.env.GOOGLE_LEAD_MAILBOXES ?? 'info@berwilson.com')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean)
)

/**
 * Which scopes to ask for on one mailbox.
 *
 * Mirrors scopesFor() in google-workspace.ts. The elevated tiers are asked for
 * ONLY where they are used, so re-consenting a mailbox that no longer qualifies
 * hands the extra permission back — which is the intended way to revoke it.
 */
function scopesForMailbox(mailbox) {
  return [
    ...SCOPES,
    ...(mailbox === ALL_MAILBOXES[0] ? PRIMARY_ONLY_SCOPES : []),
    ...(LEAD_MAILBOX_SET.has(mailbox) ? LEAD_ONLY_SCOPES : []),
  ]
}

// --only <address> re-consents a single mailbox, leaving the others' stored
// tokens untouched. Useful when one of several flows fails.
const onlyIndex = process.argv.indexOf('--only')
const ONLY = onlyIndex !== -1 ? process.argv[onlyIndex + 1]?.toLowerCase() : null
const MAILBOXES = ONLY ? ALL_MAILBOXES.filter((m) => m === ONLY) : ALL_MAILBOXES

/** Read the client id/secret out of a downloaded OAuth client JSON. */
function readClientFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  // The console exports either an "installed" (Desktop app) or "web" block.
  const block = raw.installed ?? raw.web
  if (!block?.client_id || !block?.client_secret) {
    throw new Error(
      'That file does not look like an OAuth client download (no client_id/client_secret).\n' +
      'Make sure you downloaded the OAuth 2.0 Client ID, not something else.'
    )
  }
  return { client_id: block.client_id, client_secret: block.client_secret }
}

/**
 * Wait for Google to redirect back with ?code=, and return the code.
 *
 * Deliberately tolerant about what arrives on this port. A browser will send
 * more than just the one redirect we want: favicon requests, and — the reason
 * this used to break — a REPLAYED redirect from a previous mailbox's flow,
 * still sitting in an open tab. Those carry a stale `state`, and treating a
 * mismatch as fatal aborted the run before the real sign-in ever landed.
 * So anything that isn't the redirect we're waiting for is answered politely
 * and ignored; only a matching `state` resolves.
 */
function waitForCode(expectedState, { timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false

    const page = (title, body, color) => `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 24px;color:#1e293b}
h2{color:${color}}</style></head><body><h2>${title}</h2><p>${body}</p></body></html>`

    const finish = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // close() alone leaves keep-alive sockets open, which can hold the port
      // and make the NEXT mailbox fail with EADDRINUSE.
      server.closeAllConnections?.()
      server.close(() => fn(arg))
    }

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      const state = url.searchParams.get('state')

      // Not an OAuth redirect at all (favicon, probes) — say nothing, keep waiting.
      if (!code && !error) {
        res.writeHead(204)
        res.end()
        return
      }

      // A redirect from an earlier flow. Keep waiting for the current one.
      if (state !== expectedState) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(page(
          'Leftover tab',
          'This is a stale sign-in from an earlier step — you can close it. The sign-in you just started is still waiting in the terminal.',
          '#b45309'
        ))
        return
      }

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(page('Consent declined', `Google reported: ${error}. You can close this tab and try again.`, '#dc2626'))
        return finish(reject, new Error(`consent declined: ${error}`))
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page('Connected', 'You can close this tab and return to the terminal.', '#16a34a'))
      finish(resolve, code)
    })

    const timer = setTimeout(
      () => finish(reject, new Error('timed out waiting for the browser (5 minutes)')),
      timeoutMs
    )

    server.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        err.code === 'EADDRINUSE'
          ? new Error(`Port ${PORT} is still in use. Wait a few seconds and re-run, or close whatever is using it.`)
          : err
      )
    })
    server.listen(PORT, '127.0.0.1')
  })
}

async function consentFor(mailbox, client, rl) {
  const state = randomBytes(16).toString('hex')
  const redirectUri = `http://127.0.0.1:${PORT}`

  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopesForMailbox(mailbox).join(' '),
    access_type: 'offline',   // this is what yields a refresh token
    // 'select_account' forces the account chooser even when the browser
    // already has a Google session. Without it, a browser signed into an
    // unrelated account (a personal gmail.com, say) sails straight past the
    // picker and lands on a consent screen for the WRONG account.
    // 'consent' forces a fresh grant even if previously approved, which is
    // what re-issues a refresh token when the scope list changes.
    prompt: 'select_account consent',
    login_hint: mailbox,
    state,
  })
  const authUrl = `${AUTH_ENDPOINT}?${params}`

  console.log(`\n${BOLD}--- ${mailbox} ---${OFF}`)
  console.log('Opening your browser. Sign in as this mailbox and approve.')
  console.log(`${DIM}Close any leftover localhost tabs from the previous step first.${OFF}`)
  console.log(`${DIM}If nothing opens, paste this into a browser:${OFF}`)
  console.log(`${DIM}${authUrl}${OFF}\n`)

  const pending = waitForCode(state)
  spawn('open', [authUrl], { stdio: 'ignore', detached: true }).unref()

  const code = await pending

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} — ${text.slice(0, 300)}`)

  const data = JSON.parse(text)
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. This usually means the account had already ' +
      'granted consent. Remove the app at https://myaccount.google.com/permissions and re-run.'
    )
  }

  // Confirm we actually signed in as the intended mailbox — it is easy to be
  // logged into the wrong account in the browser and not notice.
  const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${data.access_token}` },
  })
  if (profRes.ok) {
    const profile = await profRes.json()
    const actual = (profile.emailAddress ?? '').toLowerCase()
    if (actual && actual !== mailbox) {
      console.log(`${RED}  You signed in as ${actual}, not ${mailbox}.${OFF}`)
      const again = await rl.question('  Retry this mailbox? [Y/n] ')
      if (again.trim().toLowerCase() !== 'n') return consentFor(mailbox, client, rl)
      throw new Error(`wrong account for ${mailbox}`)
    }
    console.log(`${GREEN}  Connected${OFF} — ${profile.messagesTotal?.toLocaleString() ?? '?'} messages, ${profile.threadsTotal?.toLocaleString() ?? '?'} threads`)
  } else {
    console.log(`${GREEN}  Connected${OFF} (could not read the profile to confirm, but the token was issued)`)
  }

  return data.refresh_token
}

async function main() {
  console.log(`\n${BOLD}=== Connect the mailboxes to the platform ===${OFF}`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  // The stored token file already carries the OAuth client id + secret, so a
  // re-consent (adding a mailbox, or a newly required scope) needs nothing from
  // the Cloud console. Only a first run, or a lost token file, does.
  let client = null
  try {
    const existing = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
    if (existing.client?.client_id && existing.client?.client_secret) {
      client = existing.client
      console.log(`\n${GREEN}Reusing the OAuth client already stored at ${TOKENS_PATH}.${OFF}`)
      console.log(`${DIM}(No console download needed. Pass a client JSON path to override.)${OFF}\n`)
    }
  } catch { /* no stored client — fall through to the file prompt */ }

  // An explicit path on the command line always wins over the stored client.
  const explicitPath = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== ONLY)
  if (explicitPath) client = null

  if (!client) {
    console.log('\nThis needs the OAuth client JSON you downloaded from the Cloud console.')
    console.log(`${DIM}(Console → APIs & Services → Credentials → your OAuth 2.0 Client ID → Download JSON)${OFF}\n`)
  }

  // Find the client file: argument, or the newest matching download.
  let clientPath = explicitPath
  if (!client && !clientPath) {
    const guess = join(process.env.HOME, 'Downloads')
    const candidates = existsSync(guess)
      ? (await import('fs')).readdirSync(guess)
          .filter((f) => f.startsWith('client_secret') && f.endsWith('.json'))
          .map((f) => join(guess, f))
      : []
    if (candidates.length > 0) {
      clientPath = candidates[candidates.length - 1]
      console.log(`Found: ${clientPath}`)
      const use = await rl.question('Use this file? [Y/n] ')
      if (use.trim().toLowerCase() === 'n') clientPath = null
    }
  }
  if (!client && !clientPath) {
    clientPath = (await rl.question('Full path to the OAuth client JSON: ')).trim().replace(/^['"]|['"]$/g, '')
  }

  if (!client) {
    try {
      client = readClientFile(clientPath)
    } catch (err) {
      console.error(`\n${RED}${err.message}${OFF}\n`)
      process.exit(1)
    }
    console.log(`${GREEN}OAuth client loaded.${OFF}`)
  }

  // Keep any existing consents so re-running for one mailbox doesn't drop the other.
  let store = { client, tokens: {} }
  try {
    const existing = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
    store.tokens = existing.tokens ?? {}
  } catch { /* first run */ }

  if (MAILBOXES.length === 0) {
    console.error(`\n${RED}--only ${ONLY} matched no configured mailbox.${OFF}`)
    console.error(`Configured: ${ALL_MAILBOXES.join(', ')}\n`)
    process.exit(1)
  }

  for (const mailbox of MAILBOXES) {
    try {
      store.tokens[mailbox] = await consentFor(mailbox, client, rl)
    } catch (err) {
      console.error(`${RED}  Failed: ${err.message}${OFF}`)
      const cont = await rl.question('  Continue with the next mailbox? [Y/n] ')
      if (cont.trim().toLowerCase() === 'n') break
    }
  }

  rl.close()

  mkdirSync(dirname(TOKENS_PATH), { recursive: true })
  writeFileSync(TOKENS_PATH, JSON.stringify(store, null, 2), { mode: 0o600 })

  const connected = Object.keys(store.tokens)
  console.log(`\n${GREEN}=== Saved ${connected.length} mailbox(es) ===${OFF}`)
  console.log(`  ${TOKENS_PATH}  ${DIM}(mode 600)${OFF}`)
  console.log(`  ${connected.join(', ')}\n`)

  if (connected.length > 0) {
    console.log('Add to .env.local, and make sure the two service-account vars are NOT set:\n')
    console.log(`  GOOGLE_OAUTH_TOKENS_FILE=${TOKENS_PATH}`)
    console.log(`  GOOGLE_IMPERSONATE_MAILBOXES=${connected.join(',')}\n`)
    console.log('Then verify:  node scripts/verify-google-auth.mjs\n')
  }
}

main().catch((err) => {
  console.error(`\n${RED}Error:${OFF} ${err?.message ?? err}\n`)
  process.exit(1)
})
