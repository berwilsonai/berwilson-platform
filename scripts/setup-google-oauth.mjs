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
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { createInterface } from 'readline/promises'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const PORT = 47823 // fixed, so it can be registered as a redirect URI if needed

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
]

const GREEN = '\x1b[32m', RED = '\x1b[31m', BOLD = '\x1b[1m', DIM = '\x1b[2m', OFF = '\x1b[0m'

const TOKENS_PATH =
  process.env.GOOGLE_OAUTH_TOKENS_FILE ??
  join(process.env.HOME, 'berwilson-data/google-oauth-tokens.json')

const ALL_MAILBOXES = (process.env.GOOGLE_IMPERSONATE_MAILBOXES ??
  'moose@berwilson.com,tuaone@berwilson.com')
  .split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)

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
    scope: SCOPES.join(' '),
    access_type: 'offline',   // this is what yields a refresh token
    prompt: 'consent',        // force one even if previously granted
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
  console.log('\nThis needs the OAuth client JSON you downloaded from the Cloud console.')
  console.log(`${DIM}(Console → APIs & Services → Credentials → your OAuth 2.0 Client ID → Download JSON)${OFF}\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })

  // Find the client file: argument, or the newest matching download.
  let clientPath = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== ONLY)
  if (!clientPath) {
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
  if (!clientPath) {
    clientPath = (await rl.question('Full path to the OAuth client JSON: ')).trim().replace(/^['"]|['"]$/g, '')
  }

  let client
  try {
    client = readClientFile(clientPath)
  } catch (err) {
    console.error(`\n${RED}${err.message}${OFF}\n`)
    process.exit(1)
  }
  console.log(`${GREEN}OAuth client loaded.${OFF}`)

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
