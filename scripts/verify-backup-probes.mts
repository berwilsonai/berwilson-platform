/**
 * App-layer verification: the three backup probes on /settings/health.
 *
 * ⚠ These probes are the ONLY thing that notices a backup has stopped, and
 * every one of them has been wrong before: on 2026-09-23 the offsite push had
 * failed six of eight nights while the card read "ok", because the probe only
 * stat'd the local directory. So they are exercised here against every marker
 * shape rather than trusted — including the shapes nobody writes on purpose
 * (absent marker, unparseable marker, a success with nothing in it).
 *
 * §12: a listed route is not an answering one — assert no `NaN`, `undefined`
 * or `Infinity` reaches the detail string a human reads.
 *
 * Run: node --import ./deploy/register.mjs scripts/verify-backup-probes.mts
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { probeBackups } from '@/lib/system-health'

let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

const BAD = /\bNaN\b|\bundefined\b|\bInfinity\b|\bnull\b/
const clean = (s: string) => !BAD.test(s)

// A scratch BACKUP_DIR, so this never touches the real backups.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bw-backup-probe-'))
process.env.BACKUP_DIR = dir

const nowIso = () => new Date().toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

const write = (name: string, obj: unknown) =>
  fs.writeFile(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj))
const rm = (name: string) => fs.rm(path.join(dir, name), { force: true })

// ── 1. empty directory: nothing written at all ───────────────────────────────
{
  const p = await probeBackups()
  check('empty dir → missing', p.state === 'missing', p.state)
  check('empty dir → offsite unknown', p.offsite.state === 'unknown', p.offsite.state)
  check('empty dir → read-back unknown', p.readBack.state === 'unknown', p.readBack.state)
  check('empty dir → details are clean prose', clean(p.detail) && clean(p.offsite.detail) && clean(p.readBack.detail))
}

// ── 2. a fresh local backup, no markers ──────────────────────────────────────
await write('db-fresh.sql.gz', 'x')
{
  const p = await probeBackups()
  check('fresh local file → ok', p.state === 'ok', p.state)
  check('…but offsite is still unknown (the 09-23 failure)', p.offsite.state === 'unknown', p.offsite.state)
  check('…and read-back is still unknown', p.readBack.state === 'unknown', p.readBack.state)
  check('fresh local → clean prose', clean(p.detail))
}

// ── 3. Drive marker: healthy ─────────────────────────────────────────────────
await write('.drive-status', {
  ok: true, at: nowIso(), folder: 'CRITICAL — Backups', folder_id: 'abc',
  folder_recreated: false, artifacts: 30, bytes: 53_000_000_000, retain_days: 30, pruned: 1,
})
{
  const p = await probeBackups()
  check('healthy Drive marker → ok', p.offsite.state === 'ok', p.offsite.state)
  check('…names the artifact count', p.offsite.detail.includes('30 artifacts'), p.offsite.detail.slice(0, 90))
  check('…names the retention', p.offsite.detail.includes('30d retention'))
  check('…no NaN/undefined leaks', clean(p.offsite.detail))
}

// ── 4. Drive marker: the folder had to be RECREATED ──────────────────────────
await write('.drive-status', {
  ok: true, at: nowIso(), folder: 'CRITICAL — Backups', folder_id: 'abc',
  folder_recreated: true, artifacts: 1, bytes: 1_700_000_000, retain_days: 30,
})
{
  const p = await probeBackups()
  // Still a successful push, so still 'ok' — but it MUST say so, because a
  // deleted folder destroys the whole recovery window, not one night.
  check('recreated folder → still ok (the push worked)', p.offsite.state === 'ok', p.offsite.state)
  check('…but LEADS with the recreation warning', p.offsite.detail.startsWith('⚠'), p.offsite.detail.slice(0, 60))
  check('…and flags a single-artifact window', p.offsite.detail.includes('no history'), p.offsite.detail.slice(-80))
}

// ── 5. Drive marker: failing, and stale ──────────────────────────────────────
await write('.drive-status', { ok: false, at: nowIso(), detail: 'token refresh failed' })
check('failed push → failing', (await probeBackups()).offsite.state === 'failing')
await write('.drive-status', { ok: true, at: daysAgo(4), artifacts: 3, bytes: 1, retain_days: 30 })
check('4d-old marker → stale', (await probeBackups()).offsite.state === 'stale')

// ── 6. a success marker with NOTHING in it — the shape nobody writes ─────────
await write('.drive-status', { ok: true, at: nowIso() })
{
  const p = await probeBackups()
  check('bare success marker → ok, not a crash', p.offsite.state === 'ok', p.offsite.state)
  check('…and still clean prose with no fields present', clean(p.offsite.detail), p.offsite.detail.slice(0, 110))
}

// ── 7. an unparseable marker ─────────────────────────────────────────────────
await write('.drive-status', 'not json at all')
{
  const p = await probeBackups()
  check('garbage marker → unknown, not a throw', p.offsite.state === 'unknown', p.offsite.state)
}

// ── 8. read-back marker: pass, fail, stale ───────────────────────────────────
await write('.drive-status', { ok: true, at: nowIso(), artifacts: 3, bytes: 1, retain_days: 30 })
await write('.drive-verify-status', { ok: true, at: nowIso(), checked: 3, failed: 0 })
{
  const p = await probeBackups()
  check('read-back passed → ok', p.readBack.state === 'ok', p.readBack.state)
  check('…says INTEGRITY not recoverability', p.readBack.detail.includes('NOT that it restores'), p.readBack.detail.slice(-70))
  check('…clean prose', clean(p.readBack.detail))
}
await write('.drive-verify-status', { ok: false, at: nowIso(), checked: 3, failed: 1 })
{
  const p = await probeBackups()
  check('read-back failed → failing', p.readBack.state === 'failing', p.readBack.state)
  check('…and the detail is clean even with no `detail` field', clean(p.readBack.detail), p.readBack.detail.slice(0, 80))
}
await write('.drive-verify-status', { ok: true, at: daysAgo(14), checked: 3, failed: 0 })
check('14d-old read-back → stale', (await probeBackups()).readBack.state === 'stale')
await rm('.drive-verify-status')
check('no read-back marker → unknown', (await probeBackups()).readBack.state === 'unknown')

// ── 9. the retired mini marker must NOT resurrect the offsite verdict ────────
await rm('.drive-status')
await write('.offsite-status', { ok: true, at: nowIso(), target: 'richards-mac-mini', secrets: true })
{
  const p = await probeBackups()
  check(
    'a stale MINI marker does NOT read as a current offsite copy',
    p.offsite.state === 'unknown',
    `got ${p.offsite.state} — falling back to the retired destination would report a copy that no longer happens`
  )
}

await fs.rm(dir, { recursive: true, force: true })
console.log(fail === 0 ? '\nAll backup probe checks passed.' : `\n${fail} check(s) FAILED.`)
process.exit(fail === 0 ? 0 : 1)
