#!/usr/bin/env node
/**
 * Screenshot the running app, signed in, with headless Chrome.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Three consecutive UI sessions (10-26, 10-26, 10-27) shipped palette and
 * layout work WITHOUT ONCE LOOKING AT THE RESULT, and the 10-27 entry says so
 * in as many words. The cost was not theoretical: the rail stayed navy through
 * a whole brand re-skin, and the login page — the first screen of the product
 * — was a hardcoded hue-260 gradient that two passes "fixed" without touching.
 * Every one of those is obvious in a screenshot and invisible in a diff.
 *
 * The blocker was always auth: every route but /login is behind middleware, so
 * `chrome --screenshot` lands on the sign-in card whatever URL you give it.
 *
 * ── HOW IT GETS IN ──────────────────────────────────────────────────────────
 * It mints a magic link for an existing user through the LOCAL GoTrue admin
 * API — over plain HTTP to Kong on 127.0.0.1:8000, so nothing is sent off-box
 * and no TLS check is weakened — and lets Chrome follow it into a throwaway
 * profile directory. No password is typed, nothing is stored, and the profile
 * is deleted at the end. The link is single-use and expires on its own.
 *
 * Usage:
 *   node scripts/ui/shoot.mjs                      # the default set of pages
 *   node scripts/ui/shoot.mjs /projects /contacts  # specific paths
 *   BW_SHOOT_DARK=1 node scripts/ui/shoot.mjs      # the same set in dark mode
 *
 * Output lands in `.ui-shots/` (git-ignored).
 */
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP = process.env.BW_SHOOT_APP ?? 'http://localhost:3000'
const KONG = process.env.BW_SHOOT_KONG ?? 'http://127.0.0.1:8000'
const OUT = '.ui-shots'
const SIZE = process.env.BW_SHOOT_SIZE ?? '1512,982'

const DEFAULT_PAGES = ['/dashboard', '/projects', '/contacts', '/tasks', '/leads', '/intel']
const pages = process.argv.slice(2).filter((a) => a.startsWith('/'))
const paths = pages.length ? pages : DEFAULT_PAGES

function env() {
  const out = {}
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue
    out[line.slice(0, line.indexOf('=')).trim()] = line.slice(line.indexOf('=') + 1).trim()
  }
  return out
}

const { SUPABASE_SERVICE_ROLE_KEY: KEY } = env()
if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing from .env.local')
const auth = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

/** The first user with an admin role, else simply the first — this is a local preview. */
async function pickUser() {
  const r = await fetch(`${KONG}/auth/v1/admin/users?per_page=50`, { headers: auth })
  if (!r.ok) throw new Error(`admin/users ${r.status}: ${await r.text()}`)
  const { users = [] } = await r.json()
  if (!users.length) throw new Error('no users in auth.users')
  const admin = users.find((u) => (u.app_metadata?.role ?? u.user_metadata?.role) === 'admin')
  return (admin ?? users[0]).email
}

async function magicLink(email) {
  const r = await fetch(`${KONG}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ type: 'magiclink', email }),
  })
  if (!r.ok) throw new Error(`generate_link ${r.status}: ${await r.text()}`)
  const { hashed_token } = await r.json()
  if (!hashed_token) throw new Error('no hashed_token in generate_link response')
  return hashed_token
}

const profile = join(tmpdir(), `bw-shoot-${process.pid}`)
function chrome(url, out) {
  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      `--window-size=${SIZE}`,
      '--virtual-time-budget=9000',
      ...(out ? [`--screenshot=${out}`] : ['--dump-dom']),
      url,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] }
  )
}

const email = await pickUser()
const token = await magicLink(email)
console.log(`signing in as ${email}`)

mkdirSync(OUT, { recursive: true })
// Follow the magic link once; the session cookie then lives in `profile`.
chrome(`${APP}/auth/confirm?token_hash=${token}&type=magiclink&next=/dashboard`, null)

if (process.env.BW_SHOOT_DARK) {
  // The theme is a localStorage key the pre-paint script reads (see layout.tsx).
  chrome(`${APP}/dashboard#set-dark`, null)
}

for (const p of paths) {
  const name = (p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '-')) + (process.env.BW_SHOOT_DARK ? '-dark' : '') + '.png'
  const file = join(OUT, name)
  chrome(`${APP}${p}`, file)
  console.log(existsSync(file) ? `  ✓ ${file}` : `  ✗ ${p} produced nothing`)
}

rmSync(profile, { recursive: true, force: true })
console.log(`\n${paths.length} page(s) → ${OUT}/`)
