#!/usr/bin/env node
/**
 * Read the Drive backup BACK and prove it is the same bytes we uploaded.
 *
 * §12: "A backup is not a backup until it has been read back." Measured
 * 2026-10-21: there is no `pg_restore` anywhere in this repo and nothing had
 * ever read back either copy — 50GB across two machines of never-verified
 * artifacts. This closes the half that can be checked on this box.
 *
 * ⚠ WHAT THIS PROVES, AND WHAT IT DOES NOT.
 * It streams each artifact down from Drive and compares sha256 against the
 * hash the uploader recorded for the local original. That proves the copy is
 * COMPLETE and UNCORRUPTED — a truncated chunk, a silent retry that duplicated
 * a range, or Drive mangling the bytes would all fail here.
 * It does NOT prove the dump RESTORES. That needs the age private key, which
 * deliberately lives only on Richard's MacBook and in his password manager, so
 * a full restore drill cannot run on the Studio by design — that is the point
 * of the key being off-box, not an oversight. The restore half is still open.
 *
 * It also checks the age header on the decrypted-stream prefix, which catches
 * an artifact that is intact but is not actually an age file (a truncated
 * encryption step writing a zero-length or partial header).
 *
 * Usage:  node drive-backup-verify.mjs [--newest-only]
 * Exit 0 = every checked artifact matched. Exit 1 = a mismatch or no manifest.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const HOME = os.homedir()
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(HOME, 'Backups/berwilson')
const STATUS_FILE = path.join(BACKUP_DIR, '.drive-status')
const VERIFY_FILE = path.join(BACKUP_DIR, '.drive-verify-status')
const MAILBOX = process.env.BACKUP_DRIVE_MAILBOX || 'moose@berwilson.com'
const PRIMARY_TOKENS = process.env.GOOGLE_OAUTH_TOKENS_FILE || path.join(HOME, 'berwilson-data/google-oauth-tokens.json')
const SPARE_TOKENS = path.join(HOME, '.config/bw-backup/google-oauth-tokens.json')

const log = (m) => console.log(`${new Date().toISOString()}: drive-verify ${m}`)

async function accessToken() {
  let store
  for (const p of [PRIMARY_TOKENS, SPARE_TOKENS]) {
    try {
      const s = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (s?.client?.client_id && s?.tokens?.[MAILBOX]) { store = s; break }
    } catch { /* next */ }
  }
  if (!store) throw new Error('no usable token store')
  const body = new URLSearchParams({
    client_id: store.client.client_id,
    client_secret: store.client.client_secret,
    refresh_token: store.tokens[MAILBOX],
    grant_type: 'refresh_token',
  })
  const j = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })).json()
  if (!j.access_token) throw new Error(`token refresh failed: ${JSON.stringify(j).slice(0, 200)}`)
  return j.access_token
}

/** Stream a Drive file down, returning its sha256, byte count and first bytes. */
async function hashRemote(at, fileId) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${at}` },
  })
  if (!r.ok) throw new Error(`download failed ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const h = crypto.createHash('sha256')
  let bytes = 0
  let head = Buffer.alloc(0)
  for await (const chunk of r.body) {
    const b = Buffer.from(chunk)
    h.update(b)
    bytes += b.length
    if (head.length < 64) head = Buffer.concat([head, b.subarray(0, 64 - head.length)])
  }
  return { sha256: h.digest('hex'), bytes, head: head.toString('utf8', 0, 32) }
}

async function main() {
  const newestOnly = process.argv.includes('--newest-only')
  let marker
  try {
    marker = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
  } catch {
    throw new Error(`no Drive status marker at ${STATUS_FILE} — run drive-backup-push.mjs first`)
  }
  const manifest = marker.hashes || {}
  let names = Object.keys(manifest)
  if (names.length === 0) {
    throw new Error('status marker records no hashes — it predates sha256 recording; the next nightly run will populate it')
  }
  // The database dump is the irreplaceable artifact; check it first so a
  // failure is reported before a 1.6GB storage download has to finish.
  names.sort((a, b) => (a.startsWith('db-') ? -1 : b.startsWith('db-') ? 1 : 0))
  if (newestOnly) names = names.filter((n) => n.startsWith('db-') || n.startsWith('secrets-'))

  const at = await accessToken()
  const folderId = marker.folder_id
  if (!folderId) throw new Error('status marker records no folder_id')

  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}&fields=files(id,name,size)&pageSize=200`,
    { headers: { Authorization: `Bearer ${at}` } }
  )
  const j = await r.json()
  const remote = new Map((j.files || []).map((f) => [f.name, f]))

  const results = []
  let bad = 0
  for (const name of names) {
    const want = manifest[name]
    const f = remote.get(name)
    if (!f) {
      log(`MISSING on Drive: ${name}`)
      results.push({ name, ok: false, detail: 'not present on Drive' })
      bad++
      continue
    }
    // size:null means the manifest predates per-file size recording (only the
    // 2026-10-21 first run). The sha256 below subsumes it, so skip rather than
    // fail — but never skip a size that WAS recorded.
    if (want.size != null && Number(f.size) !== want.size) {
      log(`SIZE MISMATCH ${name}: Drive ${f.size} vs local ${want.size}`)
      results.push({ name, ok: false, detail: `size ${f.size} != ${want.size}` })
      bad++
      continue
    }
    const got = await hashRemote(at, f.id)
    const hashOk = got.sha256 === want.sha256
    // An age file starts with the literal "age-encryption.org/v1" header line.
    const ageOk = got.head.startsWith('age-encryption.org/v1')
    if (hashOk && ageOk) {
      log(`ok ${name} — ${(got.bytes / 1e6).toFixed(0)}MB, sha256 matches, age header present`)
      results.push({ name, ok: true, bytes: got.bytes })
    } else {
      log(`FAILED ${name} — ${hashOk ? '' : 'sha256 MISMATCH '}${ageOk ? '' : 'not an age file (header missing)'}`)
      results.push({ name, ok: false, detail: `${hashOk ? '' : 'sha256 mismatch; '}${ageOk ? '' : 'age header missing'}` })
      bad++
    }
  }

  const ok = bad === 0
  try {
    // mkdir first: a marker that cannot be written reads as "never run", which
    // is not the same thing as "ran and failed" — and the health card tells
    // them apart.
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    fs.writeFileSync(
      VERIFY_FILE,
      JSON.stringify({ ok, at: new Date().toISOString(), checked: results.length, failed: bad, results }) + '\n'
    )
  } catch (e) {
    log(`WARN could not write verify marker: ${e.message}`)
  }
  log(ok ? `READ-BACK OK — ${results.length} artifact(s) verified byte-for-byte` : `READ-BACK FAILED — ${bad} of ${results.length} bad`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  log(`ERROR ${e.message}`)
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
    fs.writeFileSync(VERIFY_FILE, JSON.stringify({ ok: false, at: new Date().toISOString(), detail: e.message }) + '\n')
  } catch { /* nothing more to do */ }
  process.exit(1)
})
