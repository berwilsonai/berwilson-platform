#!/usr/bin/env node
/**
 * Push the nightly age-encrypted backup artifacts to Google Drive.
 *
 * Invoked by ~/supabase-selfhost/backup.sh after the local dump + age step.
 * Standalone by design: ZERO imports from src/lib. The backup runs from a
 * launchd agent outside the app, and §12 records five load-time failures that
 * only bite a plain node script importing src/lib (a parameter property, an
 * unresolvable named import, a .tsx import, a require cycle through a barrel,
 * and `next/server`/`next/headers` not resolving at all).
 *
 * It does NOT reuse `uploadToFolder` in src/lib/integrations/google-drive-write.ts
 * for two independent reasons:
 *   1. That helper is MULTIPART and Buffer.concat's the whole file, so a 1.6GB
 *      artifact peaks ~3.2GB RSS. This box is 36GB with llama-server holding
 *      ~25GB and swap already full. Its own docblock says "Revisit if a >100MB
 *      drawing set ever shows up" — a backup is 16x past that line.
 *   2. See the src/lib note above.
 *
 * ⚠ CHUNKED resumable upload, not one big PUT. A single 1.6GB request takes
 * ~291s at the 5.5MB/s measured to Google on 2026-10-21, and the server sends
 * no response headers until the body is fully received — so undici's 300s
 * headersTimeout fires on a marginally slow night. That is the same `fetch`
 * ceiling §12 records for prompt processing, and no option in this codebase
 * reaches it. 128MiB chunks are ~23s each, well clear, and each completed
 * chunk is a resume point if the link drops.
 *
 * Usage:
 *   node drive-backup-push.mjs <file> [<file> ...]
 *   node drive-backup-push.mjs --prune-only
 *
 * Env:
 *   BACKUP_DRIVE_FOLDER_NAME   folder in the mailbox's My Drive (default below)
 *   BACKUP_DRIVE_RETAIN_DAYS   days of .age artifacts to keep on Drive (default 30)
 *   BACKUP_DRIVE_MAILBOX       which mailbox to upload as (default moose@)
 *   BACKUP_DIR                 where the status marker is written
 *   GOOGLE_OAUTH_TOKENS_FILE   token store (default ~/berwilson-data/...)
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const HOME = os.homedir()
// ⚠ The folder is resolved BY NAME and recreated if absent, deliberately.
// Richard asked for a name nobody would reach for; the name is also the only
// handle we have, because a human deleting the folder destroys the id. §12: a
// vendor's folder name is a UI string, not an API contract — so the name is
// ours, we own both sides, and a rename by hand is the one thing that orphans
// this. The status marker records the id actually used each night so a silent
// re-create is visible rather than looking like a first run.
const FOLDER_NAME =
  process.env.BACKUP_DRIVE_FOLDER_NAME ||
  'CRITICAL — Ber AI Platform Backups (DO NOT DELETE)'
const RETAIN_DAYS = Number(process.env.BACKUP_DRIVE_RETAIN_DAYS || 30)
const MAILBOX = process.env.BACKUP_DRIVE_MAILBOX || 'moose@berwilson.com'
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(HOME, 'Backups/berwilson')
const STATUS_FILE = path.join(BACKUP_DIR, '.drive-status')

// Google requires every chunk but the last to be a multiple of 256 KiB.
const CHUNK = 128 * 1024 * 1024 // 128 MiB = 512 * 256KiB
const UPLOAD_TRIES = 5

const PRIMARY_TOKENS = process.env.GOOGLE_OAUTH_TOKENS_FILE || path.join(HOME, 'berwilson-data/google-oauth-tokens.json')
// ⚠ Second copy, on a DIFFERENT path, and the reason is specific: the 2026-08-25
// crash destroyed ~/berwilson-data entirely, taking the OAuth client secret and
// every refresh token with it. That file is one of the things this uploader
// BACKS UP, so a Drive-only backup that authenticates with it is circular — the
// night it is lost, the upload silently stops and the loss is exactly when the
// backup matters. A copy outside that directory separates the blast radius, and
// it is refreshed automatically (no human step, §12: a channel whose setup
// cannot be automated is a channel that is off).
const SPARE_TOKENS = path.join(HOME, '.config/bw-backup/google-oauth-tokens.json')

const log = (m) => console.log(`${new Date().toISOString()}: drive-push ${m}`)

function readTokens() {
  for (const p of [PRIMARY_TOKENS, SPARE_TOKENS]) {
    try {
      const raw = fs.readFileSync(p, 'utf8')
      const store = JSON.parse(raw)
      if (store?.client?.client_id && store?.tokens?.[MAILBOX]) return { store, from: p }
    } catch {
      /* try the next path */
    }
  }
  throw new Error(`no usable token store (looked in ${PRIMARY_TOKENS}, ${SPARE_TOKENS})`)
}

/** Keep the spare copy current, with private permissions, after a proven refresh. */
function refreshSpare(store, from) {
  if (from === SPARE_TOKENS) return
  try {
    fs.mkdirSync(path.dirname(SPARE_TOKENS), { recursive: true, mode: 0o700 })
    fs.writeFileSync(SPARE_TOKENS, JSON.stringify(store), { mode: 0o600 })
  } catch (e) {
    log(`WARN could not refresh spare token copy: ${e.message}`)
  }
}

async function accessToken() {
  const { store, from } = readTokens()
  const body = new URLSearchParams({
    client_id: store.client.client_id,
    client_secret: store.client.client_secret,
    refresh_token: store.tokens[MAILBOX],
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  const j = await r.json()
  if (!j.access_token) throw new Error(`token refresh failed (${from}): ${JSON.stringify(j).slice(0, 200)}`)
  refreshSpare(store, from)
  return j.access_token
}

const api = (at) => ({ Authorization: `Bearer ${at}` })

/** Resolve the backup folder, creating it if a human deleted it. */
async function ensureFolder(at) {
  const q = [
    `name = '${FOLDER_NAME.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "'root' in parents",
    'trashed = false',
  ].join(' and ')
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`,
    { headers: api(at) }
  )
  const j = await r.json()
  if (j.files?.length) return { id: j.files[0].id, created: false }

  const c = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { ...api(at), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
      folderColorRgb: '#cc0000',
      description:
        'Nightly encrypted backups of the Ber Wilson platform (database, storage, secrets). ' +
        'Written by com.berwilson.backup on the Mac Studio at 02:30. age-encrypted — ' +
        'the private key is NOT on any machine that writes here. Do not delete: ' +
        'removing this folder destroys the recovery window, not just the newest copy.',
    }),
  })
  const cj = await c.json()
  if (!cj.id) throw new Error(`folder create failed: ${JSON.stringify(cj).slice(0, 300)}`)
  return { id: cj.id, created: true }
}

/** Files already in the folder, by name, so a re-run does not duplicate. */
async function listFolder(at, folderId) {
  const out = []
  let pageToken
  do {
    const q = `'${folderId}' in parents and trashed = false`
    const u = new URL('https://www.googleapis.com/drive/v3/files')
    u.searchParams.set('q', q)
    u.searchParams.set('fields', 'nextPageToken,files(id,name,size,createdTime)')
    u.searchParams.set('pageSize', '200')
    if (pageToken) u.searchParams.set('pageToken', pageToken)
    const r = await fetch(u, { headers: api(at) })
    const j = await r.json()
    if (j.error) throw new Error(`list failed: ${JSON.stringify(j.error).slice(0, 200)}`)
    out.push(...(j.files || []))
    pageToken = j.nextPageToken
  } while (pageToken)
  return out
}

/** Chunked resumable upload. Returns the created file id. */
async function uploadFile(at, folderId, file) {
  const total = fs.statSync(file).size
  const name = path.basename(file)

  const init = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size',
    {
      method: 'POST',
      headers: { ...api(at), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [folderId], mimeType: 'application/octet-stream' }),
    }
  )
  const session = init.headers.get('location')
  if (!session) throw new Error(`resumable init failed ${init.status}: ${(await init.text()).slice(0, 200)}`)

  let offset = 0
  let tries = 0
  const t0 = Date.now()
  while (offset < total) {
    const end = Math.min(offset + CHUNK, total) - 1
    const len = end - offset + 1
    let res
    try {
      res = await fetch(session, {
        method: 'PUT',
        // ⚠ redirect:'manual' is load-bearing. An intermediate chunk answers
        // 308 Resume Incomplete, and fetch treats 308 as a REDIRECT — without
        // this it is followed and the real status is never seen.
        redirect: 'manual',
        headers: {
          'Content-Length': String(len),
          'Content-Range': `bytes ${offset}-${end}/${total}`,
          'Content-Type': 'application/octet-stream',
        },
        body: fs.createReadStream(file, { start: offset, end }),
        duplex: 'half',
      })
    } catch (e) {
      if (++tries > UPLOAD_TRIES) throw new Error(`chunk at ${offset} failed after ${tries} tries: ${e.message}`)
      log(`WARN chunk at ${offset} errored (${e.message}) — querying session and retrying`)
      offset = await queryOffset(session, total)
      await new Promise((r) => setTimeout(r, 5000 * tries))
      continue
    }

    if (res.status === 308) {
      // Trust the server's own received range rather than our arithmetic.
      const range = res.headers.get('range')
      offset = range ? Number(range.split('-')[1]) + 1 : offset + len
      tries = 0
      continue
    }
    if (res.status === 200 || res.status === 201) {
      const j = await res.json().catch(() => ({}))
      const secs = (Date.now() - t0) / 1000
      log(`uploaded ${name} (${(total / 1e6).toFixed(0)}MB in ${secs.toFixed(0)}s, ${(total / 1e6 / secs).toFixed(1)}MB/s)`)
      return j.id
    }
    // 5xx is retryable per Google's spec; 4xx is not.
    const txt = (await res.text()).slice(0, 300)
    if (res.status >= 500 && ++tries <= UPLOAD_TRIES) {
      log(`WARN chunk at ${offset} got ${res.status} — resuming`)
      offset = await queryOffset(session, total)
      await new Promise((r) => setTimeout(r, 5000 * tries))
      continue
    }
    throw new Error(`chunk at ${offset} failed ${res.status}: ${txt}`)
  }
  throw new Error(`upload of ${name} ended without a completion response`)
}

/** Ask the session how many bytes it actually holds. */
async function queryOffset(session, total) {
  const r = await fetch(session, {
    method: 'PUT',
    redirect: 'manual',
    headers: { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' },
  })
  if (r.status === 200 || r.status === 201) return total
  const range = r.headers.get('range')
  return range ? Number(range.split('-')[1]) + 1 : 0
}

/** Delete .age artifacts older than RETAIN_DAYS. */
async function prune(at, files) {
  const cutoff = Date.now() - RETAIN_DAYS * 86400 * 1000
  let removed = 0
  for (const f of files) {
    if (!f.name.endsWith('.age')) continue
    if (new Date(f.createdTime).getTime() >= cutoff) continue
    const d = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
      method: 'DELETE',
      headers: api(at),
    })
    if (d.status === 204) removed++
    else log(`WARN could not delete ${f.name}: ${d.status}`)
  }
  return removed
}

/**
 * sha256 of a local file, streamed.
 *
 * Recorded in the status marker so drive-backup-verify.mjs can READ THE COPY
 * BACK and prove Drive holds the same bytes. §12: a backup is not a backup
 * until it has been read back — and before 2026-10-21 nothing in this repo
 * ever read one back (there is still no `pg_restore` anywhere). This half is
 * what can be checked WITHOUT the age private key, which deliberately lives
 * only on Richard's MacBook: it proves the artifact is intact and complete,
 * not that it restores. The restore half still needs the key.
 */
function sha256(file) {
  const h = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(4 * 1024 * 1024)
    let n
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
  } finally {
    fs.closeSync(fd)
  }
  return h.digest('hex')
}

function writeStatus(obj) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ ...obj, at: new Date().toISOString() }) + '\n')
  } catch (e) {
    log(`WARN could not write status marker: ${e.message}`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const pruneOnly = args.includes('--prune-only')
  const inputs = args.filter((a) => !a.startsWith('--'))
  if (!pruneOnly && inputs.length === 0) {
    console.error('usage: drive-backup-push.mjs <file> [<file> ...] | --prune-only')
    process.exit(2)
  }

  const at = await accessToken()
  const { id: folderId, created } = await ensureFolder(at)
  if (created) log(`folder was MISSING and has been recreated: ${FOLDER_NAME}`)

  const before = await listFolder(at, folderId)
  const byName = new Map(before.map((f) => [f.name, f]))

  const uploaded = []
  const skipped = []
  const hashes = {}
  for (const file of inputs) {
    if (!fs.existsSync(file)) {
      log(`WARN missing locally, skipped: ${file}`)
      continue
    }
    const name = path.basename(file)
    const size = fs.statSync(file).size
    const existing = byName.get(name)
    // Same name AND same byte count = already up. §12 warns a name is not
    // evidence of sameness; here the name carries a timestamp this script
    // minted and the size is checked too, which is enough for idempotency
    // on a re-run of the same night.
    if (existing && Number(existing.size) === size) {
      skipped.push(name)
      hashes[name] = { sha256: sha256(file), size }
      continue
    }
    await uploadFile(at, folderId, file)
    uploaded.push(name)
    hashes[name] = { sha256: sha256(file), size }
  }

  const after = await listFolder(at, folderId)
  const removed = await prune(at, after)
  // ⚠ Re-list AFTER pruning. Counting `after` would include the rows just
  // deleted, so the nightly line would report a window one night longer than
  // Drive actually holds — a count that lies about the thing it exists to
  // report. One extra call a night.
  const final = removed > 0 ? await listFolder(at, folderId) : after
  const kept = final.filter((f) => f.name.endsWith('.age'))
  const bytes = kept.reduce((n, f) => n + Number(f.size || 0), 0)

  writeStatus({
    ok: true,
    folder: FOLDER_NAME,
    folder_id: folderId,
    folder_recreated: created,
    uploaded,
    skipped,
    hashes,
    pruned: removed,
    artifacts: kept.length,
    bytes,
    retain_days: RETAIN_DAYS,
    mailbox: MAILBOX,
  })
  log(
    `ok — ${uploaded.length} uploaded, ${skipped.length} already present, ${removed} pruned; ` +
      `${kept.length} artifacts / ${(bytes / 1e9).toFixed(1)}GB held, ${RETAIN_DAYS}d retention`
  )
}

main().catch((e) => {
  log(`FAILED ${e.message}`)
  writeStatus({ ok: false, detail: e.message, folder: FOLDER_NAME, mailbox: MAILBOX })
  process.exit(1)
})
