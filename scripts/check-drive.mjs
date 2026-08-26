#!/usr/bin/env node
/**
 * Is the Drive knowledge sync actually working?
 *
 * Deliberately standalone — it reads the token file and calls Google directly
 * rather than importing the app, so it works with a plain `node` and tells you
 * about the CREDENTIAL path independently of whether the platform is running.
 *
 *   node --env-file=.env.local scripts/check-drive.mjs
 *
 * The four checks are ordered so the first failure is the thing to fix: a
 * missing scope, an API not enabled on the credential's project, a folder the
 * mailbox cannot open, and finally what is actually in it.
 *
 * An EMPTY folder is a pass. "seen: 0" from the sync means it looked and found
 * nothing to do — which is indistinguishable from a failure unless something
 * says so out loud, which is why this script exists.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', D = '\x1b[2m', O = '\x1b[0m'
const pass = (m) => console.log(`  ${G}PASS${O}  ${m}`)
const fail = (m) => { console.log(`  ${R}FAIL${O}  ${m}`); failed++ }
const note = (m) => console.log(`  ${Y}NOTE${O}  ${m}`)
let failed = 0

const TOKENS_PATH =
  process.env.GOOGLE_OAUTH_TOKENS_FILE ??
  join(process.env.HOME, 'berwilson-data/google-oauth-tokens.json')

// The Drive sync impersonates the FIRST impersonated mailbox (PRIMARY_MAILBOX),
// so that is the only mailbox whose Drive access matters.
const MAILBOX = (process.env.GOOGLE_IMPERSONATE_MAILBOXES ?? 'moose@berwilson.com')
  .split(',')[0].trim().toLowerCase()
const FOLDER = process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID?.trim()

console.log(`\n${B}=== Drive knowledge sync check ===${O}`)
console.log(`${D}mailbox: ${MAILBOX}${O}`)

let store
try {
  store = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
} catch {
  console.log(`\n  ${R}FAIL${O}  No token file at ${TOKENS_PATH}`)
  console.log(`        Fix: node scripts/setup-google-oauth.mjs\n`)
  process.exit(1)
}

const refresh = store.tokens?.[MAILBOX]
if (!refresh) {
  console.log(`\n  ${R}FAIL${O}  ${MAILBOX} has no stored consent.`)
  console.log(`        Fix: node scripts/setup-google-oauth.mjs --only ${MAILBOX}\n`)
  process.exit(1)
}

console.log(`\n1. Access token + Drive scope`)
const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: store.client.client_id,
    client_secret: store.client.client_secret,
    refresh_token: refresh,
  }),
})
const tok = await res.json()
if (!res.ok) {
  fail(`could not refresh: ${tok.error} ${tok.error_description ?? ''}`)
  console.log(`        Fix: node scripts/setup-google-oauth.mjs --only ${MAILBOX}\n`)
  process.exit(1)
}
const scopes = (tok.scope ?? '').split(' ')
if (scopes.some((s) => s.endsWith('/drive.readonly'))) pass('drive.readonly granted')
else {
  fail('drive.readonly NOT granted on this token')
  console.log(`        Fix: node scripts/setup-google-oauth.mjs --only ${MAILBOX}`)
}

const call = async (url) => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok.access_token}` } })
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }
}

console.log(`\n2. Drive API enabled on the credential's project`)
const probe = await call('https://www.googleapis.com/drive/v3/files?pageSize=1')
if (probe.ok) pass('Drive API responding')
else {
  const msg = probe.body?.error?.message ?? `HTTP ${probe.status}`
  fail(msg)
  if (/has not been used in project|accessNotConfigured/.test(msg)) {
    console.log(`        The API must be enabled on the project that owns the OAUTH CLIENT`)
    console.log(`        — NOT whichever project you happen to be viewing. The message`)
    console.log(`        above names the correct project number; use that link.`)
  }
}

console.log(`\n3. The configured folder`)
if (!FOLDER) {
  fail('GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID is not set in .env.local')
} else {
  const meta = await call(
    `https://www.googleapis.com/drive/v3/files/${FOLDER}?fields=name,trashed,capabilities(canListChildren)&supportsAllDrives=true`
  )
  if (!meta.ok) {
    fail(`${MAILBOX} cannot open folder ${FOLDER} — ${meta.body?.error?.message ?? meta.status}`)
    console.log(`        Usually means the folder belongs to another account.`)
    console.log(`        Fix: share it with ${MAILBOX} (Viewer is enough), or use a folder it owns.`)
  } else if (meta.body.trashed) {
    fail(`folder "${meta.body.name}" is in the Trash`)
  } else {
    pass(`"${meta.body.name}" reachable (canList=${meta.body.capabilities?.canListChildren})`)
  }
}

console.log(`\n4. Contents`)
if (FOLDER) {
  const q = encodeURIComponent(`'${FOLDER}' in parents and trashed=false`)
  const list = await call(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(name,mimeType,size)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`
  )
  const files = list.body?.files ?? []
  if (!list.ok) fail(list.body?.error?.message ?? `HTTP ${list.status}`)
  else if (files.length === 0) {
    pass('folder readable, 0 files')
    note('The folder is EMPTY, so the sync has nothing to index and reports')
    console.log(`        "seen: 0". That is success, not failure. Drop a PDF or Word`)
    console.log(`        doc in and re-run the sync to see it indexed.`)
  } else {
    pass(`${files.length} file(s) ready to index`)
    for (const f of files.slice(0, 20)) console.log(`        - ${f.name}`)
  }
}

console.log(
  failed === 0
    ? `\n${G}${B}Drive is working.${O}\n`
    : `\n${R}${B}${failed} check(s) failed — fix the first one above.${O}\n`
)
process.exit(failed === 0 ? 0 : 1)
