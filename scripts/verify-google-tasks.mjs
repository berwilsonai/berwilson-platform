#!/usr/bin/env node
/**
 * Is the Google Tasks sync actually able to work?
 *
 *   node scripts/verify-google-tasks.mjs
 *
 * Read-only. Creates nothing, changes nothing, on either side.
 *
 * Deliberately standalone — it reads the token file and calls Google directly
 * rather than importing the app, so it answers questions about the CREDENTIAL
 * independently of whether the platform is running or the database is up.
 *
 * The checks are ordered so the first failure is the thing to fix: a mailbox
 * with no token, a token minted before the tasks scope existed, then what is
 * actually sitting in the list that is about to be synced.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', D = '\x1b[2m', O = '\x1b[0m'

// Self-loading, for the same reason setup-google-oauth.mjs is: which mailboxes
// matter is read from the environment, and a missing var here would report a
// clean bill of health for mailboxes it never looked at.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
}

const TOKENS_PATH =
  process.env.GOOGLE_OAUTH_TOKENS_FILE ??
  join(process.env.HOME, 'berwilson-data/google-oauth-tokens.json')

const MAILBOXES = (process.env.GOOGLE_TASK_MAILBOXES ?? '')
  .split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)

let failed = false
const pass = (m) => console.log(`  ${G}PASS${O}  ${m}`)
const fail = (m) => { failed = true; console.log(`  ${R}FAIL${O}  ${m}`) }
const warn = (m) => console.log(`  ${Y}WARN${O}  ${m}`)
const note = (m) => console.log(`        ${D}${m}${O}`)

console.log(`\n${B}Google Tasks sync — can it work?${O}`)

// 1 ─ configuration
console.log(`\n1. Configuration`)
if (MAILBOXES.length === 0) {
  fail('GOOGLE_TASK_MAILBOXES is not set, so no member syncs.')
  note('Add the addresses to .env.local, then re-consent each one.')
  process.exit(1)
}
pass(`${MAILBOXES.length} mailbox(es): ${MAILBOXES.join(', ')}`)

if (!existsSync(TOKENS_PATH)) {
  fail(`No token file at ${TOKENS_PATH}`)
  process.exit(1)
}
const store = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'))
pass(`Token file present (${Object.keys(store.tokens ?? {}).length} mailboxes stored)`)

// 2 ─ credential + scope, per mailbox
console.log(`\n2. Credentials and the tasks scope`)
const tokens = new Map()
for (const mailbox of MAILBOXES) {
  const refresh = store.tokens?.[mailbox]
  if (!refresh) {
    fail(`${mailbox} has no stored token — never consented.`)
    note(`node scripts/setup-google-oauth.mjs --only ${mailbox}`)
    continue
  }
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
  const body = await res.json()
  if (!res.ok) {
    fail(`${mailbox}: could not refresh — ${body.error_description ?? body.error}`)
    continue
  }
  const granted = String(body.scope ?? '').split(' ')
  if (!granted.includes('https://www.googleapis.com/auth/tasks')) {
    fail(`${mailbox}: consented, but WITHOUT the tasks scope.`)
    note(`Its token predates the scope. Re-consent: node scripts/setup-google-oauth.mjs --only ${mailbox}`)
    note(`The consent screen must list "tasks" — watch for it.`)
    continue
  }
  tokens.set(mailbox, body.access_token)
  pass(`${mailbox}: tasks scope granted`)
}

if (tokens.size === 0) {
  console.log(`\n${R}Nothing can sync until at least one mailbox has the scope.${O}\n`)
  process.exit(1)
}

// 3 ─ what is actually in the list that is about to be synced
console.log(`\n3. The default list, and what is in it`)
for (const [mailbox, token] of tokens) {
  const call = async (url) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) }
  }

  const list = await call('https://tasks.googleapis.com/tasks/v1/users/@me/lists/@default')
  if (!list.ok) {
    fail(`${mailbox}: cannot read the default list — ${list.status} ${JSON.stringify(list.body?.error?.message ?? '')}`)
    if (list.status === 403) note('Enable the Google Tasks API on the project that owns the OAuth client.')
    continue
  }
  pass(`${mailbox}: default list is "${list.body.title}" (${list.body.id.slice(0, 12)}…)`)

  // Every flag on, exactly as the sync reads it — a completed task is HIDDEN by
  // default, and a listing that cannot see it reads completion as deletion.
  const tasks = await call(
    'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks' +
      '?maxResults=100&showCompleted=true&showHidden=true&showDeleted=true'
  )
  if (!tasks.ok) {
    fail(`${mailbox}: cannot list tasks — ${tasks.status}`)
    continue
  }
  const items = tasks.body.items ?? []
  const open = items.filter((t) => t.status !== 'completed' && !t.deleted)
  const done = items.filter((t) => t.status === 'completed' && !t.deleted)
  const gone = items.filter((t) => t.deleted)
  const subs = open.filter((t) => t.parent)
  const ours = items.filter((t) => /[?&]task=/.test(t.notes ?? ''))

  note(`${open.length} open · ${done.length} completed · ${gone.length} trashed · ${ours.length} already from the platform`)
  if (subs.length) note(`${subs.length} subtask(s) — these are skipped, never imported`)

  const incoming = open.filter((t) => !t.parent && t.title?.trim() && !/[?&]task=/.test(t.notes ?? ''))
  if (incoming.length > 20) {
    warn(`${incoming.length} tasks here are not from the platform — over the 20 limit, so the first sync will import NONE of them and say so.`)
    note('That guard exists because a personal list looks exactly like this. Raise INBOUND_LIMIT if they really are work.')
  } else if (incoming.length > 0) {
    warn(`${incoming.length} task(s) would be imported onto the shared board on the first sync:`)
    for (const t of incoming.slice(0, 10)) note(`• ${t.title}`)
  } else {
    pass('Nothing unexpected would be imported')
  }
}

console.log(
  failed
    ? `\n${R}Not ready.${O} Fix the first failure above and re-run.\n`
    : `\n${G}Ready.${O} Dry-run it before the real thing:\n` +
      `  ${D}curl -s -H "Authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)" \\\n` +
      `    'http://localhost:3000/api/cron/google-tasks?dryRun=1' | python3 -m json.tool${O}\n`
)
process.exit(failed ? 1 : 0)
