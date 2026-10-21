/**
 * Live system-health probes for /settings/health.
 *
 * These go beyond "does a row exist" — they exercise the real dependency:
 * a real Google token mint, a real ping to LM Studio, a stat of the backup
 * directory and the disk. Everything returns a result object and never throws;
 * the health page renders whatever came back.
 *
 * Server-only (fs/os); do not import from client components.
 */

import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import {
  allMailboxes,
  MAILBOXES,
  isGoogleConfigured,
  probeGoogleConnection,
  probeScopeCoverage,
  googleFetch,
  LEAD_MAILBOXES,
  PRIMARY_MAILBOX,
  type GoogleProbe,
} from '@/lib/integrations/google-workspace'
import { listMeetTranscripts } from '@/lib/integrations/google-drive'
import { isChatConfigured } from '@/lib/notify/chat'
import { createAdminClient } from '@/lib/supabase/admin'
import { isFileable } from '@/lib/drive/file-document'
import { INDEXED_IN_MAIL } from '@/lib/documents/status'
import { leadsDb } from '@/lib/leads/db'
import { sweepDb } from '@/lib/email-sweep/db'

const PROBE_TIMEOUT_MS = 10_000

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Google Workspace — live grant probe
// ---------------------------------------------------------------------------

/**
 * Definitive connection test: mint a real access token for every configured
 * mailbox against Google.
 *
 * Deliberately thinner than the Microsoft probe it replaces. Service-account
 * auth stores nothing and expires nothing, so there is no grant to go stale
 * and no "reconnect" ritual — a failure here is always a configuration
 * problem (scopes, key, or clock), and google-workspace.ts already translates
 * those into plain English.
 */
export type { GoogleProbe }

export async function probeMailboxConnection(): Promise<GoogleProbe> {
  try {
    // Bounded like the Graph probe it replaces: this runs on every load of
    // /settings/health, so a hung Google call must never hang the page.
    return await withTimeout(
      probeGoogleConnection(),
      PROBE_TIMEOUT_MS * 2, // one mint per mailbox, in parallel
      'Google token mint'
    )
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    return { state: 'broken', reason: 'The Google connection probe itself failed.', rawError: raw }
  }
}

// ---------------------------------------------------------------------------
// LM Studio — local AI engine liveness
// ---------------------------------------------------------------------------

export interface LmStudioProbe {
  state: 'ok' | 'degraded' | 'down' | 'not_local'
  detail: string
  models?: string[]
}

/**
 * Ping LM Studio's OpenAI-compatible /models endpoint and confirm the
 * configured chat + embedding models are actually available.
 */
export async function probeLmStudio(): Promise<LmStudioProbe> {
  if (process.env.AI_PROVIDER !== 'local') return { state: 'not_local', detail: 'AI provider is not local.' }

  const baseUrl = process.env.LOCAL_AI_BASE_URL
  if (!baseUrl) return { state: 'down', detail: 'LOCAL_AI_BASE_URL is not set.' }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })
    if (!res.ok) return { state: 'down', detail: `LM Studio responded ${res.status} — the server may be starting up.` }

    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const models = (json.data ?? []).map((m) => m.id ?? '').filter(Boolean)

    const wanted = [process.env.LOCAL_AI_MODEL, process.env.LOCAL_EMBEDDING_MODEL].filter(Boolean) as string[]
    const missing = wanted.filter((w) => !models.includes(w))

    if (missing.length > 0) {
      return {
        state: 'degraded',
        detail: `LM Studio is up but not serving: ${missing.join(', ')}. Load the model(s) in LM Studio on the Studio.`,
        models,
      }
    }
    return { state: 'ok', detail: `Serving ${models.length} model${models.length === 1 ? '' : 's'}.`, models }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    return {
      state: 'down',
      detail: `Cannot reach LM Studio at ${baseUrl} (${raw}). All AI features are offline until it is running with the server enabled.`,
    }
  }
}

// ---------------------------------------------------------------------------
// Backups — freshness of the nightly local backup
// ---------------------------------------------------------------------------

export interface BackupProbe {
  state: 'ok' | 'stale' | 'missing'
  detail: string
  newestAgeHours?: number
  dir: string
  /** The encrypted copy on Google Drive — the only protection against losing the Studio. */
  offsite: {
    state: 'ok' | 'stale' | 'failing' | 'unknown'
    detail: string
    ageHours?: number
  }
  /**
   * Whether that copy has been READ BACK and compared byte-for-byte.
   * A push reporting success proves only that the API accepted it; §12 is
   * explicit that a backup is not a backup until it has been read back.
   */
  readBack: {
    state: 'ok' | 'stale' | 'failing' | 'unknown'
    detail: string
    ageDays?: number
  }
}

/**
 * Freshness of the OFFSITE copy, read from the marker the backup script writes.
 *
 * This exists because the local check above cannot see it. On 2026-09-23 the
 * offsite push had failed 6 of the previous 8 nights while this card reported
 * "ok" throughout, because the local artifacts were written perfectly every
 * night. A local-only backup is not a backup against the failure that actually
 * destroys it (the Studio itself), and the 2026-08-25 data loss showed that
 * failure is not hypothetical.
 *
 * ⚠ The destination changed on 2026-10-21 from the Mac mini to Google Drive
 * (Richard's call — the mini had 37GB free total against 25GB of backups,
 * where the GSuite pooled quota has ~6.58TB free). The marker it reads is
 * `.drive-status`, written by deploy/drive-backup-push.mjs. The mini's own
 * `.offsite-status` is no longer written and is deliberately NOT read: a
 * fallback to a stale marker from a decommissioned destination would report a
 * copy that no longer happens, which is the exact failure this probe exists
 * to catch.
 */
async function probeOffsite(dir: string): Promise<BackupProbe['offsite']> {
  const marker = path.join(dir, '.drive-status')
  let raw: string
  try {
    raw = await fs.readFile(marker, 'utf8')
  } catch {
    return {
      state: 'unknown',
      detail:
        'No Drive marker yet — the encrypted push to Google Drive has not run since this check was added. It is written by ~/supabase-selfhost/backup.sh at 2:30am.',
    }
  }
  let parsed: {
    ok?: boolean
    at?: string
    detail?: string
    folder?: string
    folder_recreated?: boolean
    artifacts?: number
    bytes?: number
    retain_days?: number
    pruned?: number
  }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    return { state: 'unknown', detail: `Drive marker at ${marker} is unreadable.` }
  }
  const at = parsed.at ? Date.parse(parsed.at) : NaN
  const ageHours = Number.isNaN(at) ? undefined : (Date.now() - at) / 3_600_000

  if (!parsed.ok) {
    return {
      state: 'failing',
      // Name the likely causes in the order they actually occur, rather than
      // guessing — the 2026-09-23 lesson. A refresh-token failure is by far
      // the most likely, because that token is shared with every other Google
      // feature and a re-consent elsewhere can invalidate it.
      detail: `Last Drive push FAILED — ${parsed.detail ?? 'reason not recorded'}. Check ~/Library/Logs/berwilson/backup.err.log on the Studio: a token error means moose@ needs re-consent (\`node scripts/setup-google-oauth.mjs --only moose@berwilson.com\`), a 403 means the drive.file/drive scope was dropped, and a quota error means the GSuite pool is full. Until this clears, the ONLY copy of the database is on this machine.`,
      ageHours,
    }
  }
  if (ageHours !== undefined && ageHours > 30) {
    return {
      state: 'stale',
      detail: `Newest Drive copy is ${Math.round(ageHours / 24)}d old — the encrypted push to Google Drive has stopped even though local backups are fine.`,
      ageHours,
    }
  }

  const held = parsed.artifacts ?? 0
  const gb = parsed.bytes ? (parsed.bytes / 1e9).toFixed(1) : '0.0'
  const when = ageHours !== undefined && ageHours < 1 ? 'under an hour' : `${Math.round(ageHours ?? 0)}h`
  // ⚠ Lead with the folder having been recreated. It means a human deleted it,
  // which destroys the whole recovery WINDOW rather than one night — and the
  // push itself still succeeds, so nothing else here would say so.
  const recreated = parsed.folder_recreated
    ? `⚠ The backup folder was MISSING and had to be recreated — someone deleted it, so the recovery window restarted from this run. `
    : ''
  // A single artifact is one night of history, which is a real degradation
  // whatever caused it. Reported as a count, not inferred — §12.
  const thin = held <= 1 ? ` ⚠ Only ${held} artifact${held === 1 ? '' : 's'} held, so there is no history to roll back to yet.` : ''
  return {
    state: 'ok',
    detail: `${recreated}Encrypted copy pushed to Google Drive ${when} ago — ${held} artifact${held === 1 ? '' : 's'} / ${gb}GB held in "${parsed.folder ?? 'the backup folder'}", ${parsed.retain_days ?? 30}d retention.${thin}`,
    ageHours,
  }
}

/**
 * Freshness and verdict of the weekly READ-BACK check.
 *
 * `com.berwilson.backup-verify` (Sundays 04:00) streams the newest Drive
 * artifacts down and compares sha256 against the hash the uploader recorded.
 * It is reported separately from the push because the two fail for completely
 * different reasons: the push fails on auth, scope or quota, and the read-back
 * fails on corruption — which nothing else here would ever notice.
 *
 * ⚠ It cannot prove the dump RESTORES. The age private key is on Richard's
 * MacBook by design, so the Studio can verify integrity and not recoverability.
 * Saying so here matters: a green card must not be read as "a restore drill
 * passed", because no restore drill exists yet.
 */
async function probeReadBack(dir: string): Promise<BackupProbe['readBack']> {
  const marker = path.join(dir, '.drive-verify-status')
  let parsed: { ok?: boolean; at?: string; detail?: string; checked?: number; failed?: number }
  try {
    parsed = JSON.parse(await fs.readFile(marker, 'utf8')) as typeof parsed
  } catch {
    return {
      state: 'unknown',
      detail:
        'The Drive copy has never been read back. deploy/drive-backup-verify.mjs does it (com.berwilson.backup-verify, Sundays 04:00) — run it by hand to check now.',
    }
  }
  const at = parsed.at ? Date.parse(parsed.at) : NaN
  const ageDays = Number.isNaN(at) ? undefined : (Date.now() - at) / 86_400_000
  if (!parsed.ok) {
    return {
      state: 'failing',
      detail: `Read-back FAILED — ${parsed.detail ?? `${parsed.failed ?? '?'} of ${parsed.checked ?? '?'} artifacts did not match`}. The copy on Drive is NOT a faithful copy of what was dumped. Check ~/Library/Logs/berwilson/backup-verify.err.log; a sha256 mismatch means the upload corrupted or truncated, and re-running the push re-uploads from the local original.`,
      ageDays,
    }
  }
  // A verdict nobody has refreshed is not a passing verdict. Weekly schedule,
  // so 10 days is already a missed run.
  if (ageDays !== undefined && ageDays > 10) {
    return {
      state: 'stale',
      detail: `Last read-back passed but was ${Math.round(ageDays)}d ago — the weekly check (Sundays 04:00) has stopped running, so nothing has verified the recent copies.`,
      ageDays,
    }
  }
  return {
    state: 'ok',
    detail: `${parsed.checked ?? 0} artifact${parsed.checked === 1 ? '' : 's'} read back from Drive and matched byte-for-byte ${
      ageDays !== undefined && ageDays < 1 ? 'today' : `${Math.round(ageDays ?? 0)}d ago`
    }. ⚠ This proves the copy is intact, NOT that it restores — the age private key is off-box by design, so no restore drill runs here.`,
    ageDays,
  }
}

/**
 * The nightly backup (launchd com.berwilson.backup, 2:30am) writes a pg dump
 * + storage tarball into ~/Backups/berwilson on the Studio. If the newest
 * file there is older than ~30h, the backup has silently stopped.
 */
export async function probeBackups(): Promise<BackupProbe> {
  const dir = process.env.BACKUP_DIR ?? path.join(os.homedir(), 'Backups', 'berwilson')
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    let newest = 0
    // Walk one level deep — the script may organize by dated subdirectories.
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile()) {
        const st = await fs.stat(full)
        newest = Math.max(newest, st.mtimeMs)
      } else if (entry.isDirectory()) {
        for (const child of await fs.readdir(full)) {
          const st = await fs.stat(path.join(full, child)).catch(() => null)
          if (st?.isFile()) newest = Math.max(newest, st.mtimeMs)
        }
      }
    }
    const offsite = await probeOffsite(dir)
    const readBack = await probeReadBack(dir)
    if (newest === 0)
      return { state: 'missing', detail: 'Backup directory exists but is empty.', dir, offsite, readBack }

    const ageHours = (Date.now() - newest) / 3_600_000
    if (ageHours > 30) {
      return {
        state: 'stale',
        detail: `Newest backup file is ${Math.round(ageHours / 24)}d old — the nightly backup has stopped. Check ~/Library/Logs/berwilson/backup.err.log on the Studio.`,
        newestAgeHours: ageHours,
        dir,
        offsite,
        readBack,
      }
    }
    return {
      state: 'ok',
      detail: `Newest backup ${ageHours < 1 ? 'under an hour' : `${Math.round(ageHours)}h`} old.`,
      newestAgeHours: ageHours,
      dir,
      offsite,
      readBack,
    }
  } catch {
    return {
      state: 'missing',
      detail: `Backup directory not found at ${dir}. Expected on the Studio (this warning is normal on a dev machine).`,
      dir,
      offsite: { state: 'unknown', detail: 'No backup directory, so no offsite copy either.' },
      readBack: { state: 'unknown', detail: 'No backup directory, so nothing to read back.' },
    }
  }
}

// ---------------------------------------------------------------------------
// Disk space — the Studio hosts app + database + models + backups + map tiles
// ---------------------------------------------------------------------------

export interface DiskProbe {
  state: 'ok' | 'low' | 'critical' | 'unknown'
  detail: string
  freeGb?: number
  totalGb?: number
}

export async function probeDisk(): Promise<DiskProbe> {
  try {
    const st = await fs.statfs('/')
    const freeGb = (st.bavail * st.bsize) / 1e9
    const totalGb = (st.blocks * st.bsize) / 1e9
    const base = { freeGb, totalGb }
    if (freeGb < 15) {
      return {
        state: 'critical',
        detail: `${Math.round(freeGb)} GB free of ${Math.round(totalGb)} GB — the database, backups, and AI models all live on this disk. Free space now.`,
        ...base,
      }
    }
    if (freeGb < 50) {
      return { state: 'low', detail: `${Math.round(freeGb)} GB free of ${Math.round(totalGb)} GB — getting tight; plan a cleanup.`, ...base }
    }
    return { state: 'ok', detail: `${Math.round(freeGb)} GB free of ${Math.round(totalGb)} GB.`, ...base }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    return { state: 'unknown', detail: `Could not read disk stats (${raw}).` }
  }
}

// ---------------------------------------------------------------------------
// Cheap DB-only mailbox staleness check (for the dashboard — no network)
// ---------------------------------------------------------------------------

/**
 * True when a mailbox's sweep is in a failed state.
 *
 * Replaces the old token-staleness heuristic: service-account auth stores no
 * token to go stale, so the honest cheap signal that mail ingestion is broken
 * is the sweep itself having failed. Reads a persisted column — no network
 * call — which is what makes it safe on every dashboard load.
 */
export function mailboxLooksBroken(state: string | null | undefined): boolean {
  return state === 'failed'
}

/**
 * Can the Drive knowledge sync actually read its folder?
 *
 * Three separate things must line up and they fail in ways that look alike from
 * the outside: the mailbox needs the drive.readonly scope, the Drive API must be
 * enabled on the project that owns the OAUTH CLIENT (not whichever project is
 * on screen), and the folder must be shared with the mailbox the sync
 * impersonates. Reporting an EMPTY folder as "ok, nothing to index" matters just
 * as much — a clean sync of zero files is otherwise indistinguishable from a
 * broken one.
 */
export async function probeDriveKnowledge(): Promise<{
  state: 'ok' | 'empty' | 'unconfigured' | 'failed'
  detail: string
}> {
  const folderIds = (process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (folderIds.length === 0) {
    return {
      state: 'unconfigured',
      detail:
        'Set GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID to one or more comma-separated Drive folder ids to index capability statements, past performance and credentials into the company knowledge base. Lead fit scores are graded against whatever is in there.',
    }
  }

  const mailbox = PRIMARY_MAILBOX
  try {
    // Counted per folder, and the count is of the top level only — it is a
    // reachability check, not an inventory. A deep walk of the corporate tree
    // on every page load would make the health page the slowest thing here.
    let count = 0
    for (const folderId of folderIds) {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
      const data = await googleFetch<{ files?: { name: string }[] }>(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        mailbox
      )
      count += data.files?.length ?? 0
    }
    const where = `${folderIds.length} folder${folderIds.length === 1 ? '' : 's'}`
    if (count === 0) {
      return {
        state: 'empty',
        detail: `${where} readable by ${mailbox}, but nothing in them, so the nightly sync has nothing to index. Add documents and they will be indexed on the next run (3:15am), or trigger it sooner.`,
      }
    }
    return {
      state: 'ok',
      detail: `${count} item${count === 1 ? '' : 's'} across ${where}, readable by ${mailbox}.`,
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    let fix = ''
    if (/has not been used in project|accessNotConfigured/.test(raw)) {
      fix =
        ' Enable the Drive API on the project that owns the OAuth client — the message names the project number; it is NOT necessarily the project you were last looking at.'
    } else if (/insufficient|scope|403/i.test(raw)) {
      fix = ` Re-consent with: node scripts/setup-google-oauth.mjs --only ${mailbox}`
    } else if (/404|not found/i.test(raw)) {
      fix = ` The folder is probably owned by another account — share it with ${mailbox} (Viewer is enough).`
    }
    return { state: 'failed', detail: `${raw}${fix}` }
  }
}

/**
 * Are the documents we hold actually indexed, or just sitting there?
 *
 * A document with a file but no chunks is invisible to Ber AI while looking
 * perfectly normal everywhere a human looks: it is on the record, it opens, it
 * downloads. Only a retrieval that should have found it and didn't reveals the
 * gap, and that surfaces as a wrong answer weeks later rather than as a fault.
 *
 * Counted out loud because this has now happened at least four times, most
 * recently on 2026-09-09 when sixteen company documents — a DoD award letter, a
 * Phase 1 environmental report, the Tooele LOI — sat unreadable because the
 * company sync had no retry for an unfinished pass. Everything reported healthy
 * throughout.
 *
 * 'skipped' is deliberately NOT counted as a problem: it is the settled state
 * for a file nothing here can read, such as a scanned plat with no vision model
 * loaded, and treating it as a fault would make this permanently red.
 */
export async function probeDocumentIndexing(): Promise<{
  state: 'ok' | 'stalled' | 'failed'
  detail: string
}> {
  const supabase = createAdminClient()
  try {
    // BOTH document tables. This read `documents` alone until 2026-09-23, so
    // the card reported "Every document is settled" while 28 opportunity
    // documents — the whole M&A file for the Englert / Gold mine deal — had
    // never been indexed and one had been stranded mid-pass since 09-22.
    // A record kind the check cannot see is a record kind that goes dark
    // quietly, which is the exact failure this card exists to prevent.
    const [docsRes, oppRes] = await Promise.all([
      supabase.from('documents').select('embedding_status, uploaded_at').is('superseded_at', null),
      supabase.from('opportunity_documents').select('embedding_status, uploaded_at').is('superseded_at', null),
    ])
    if (docsRes.error) throw new Error(docsRes.error.message)
    if (oppRes.error) throw new Error(oppRes.error.message)

    type Row = { embedding_status: string | null; uploaded_at: string | null }
    const rows = [...((docsRes.data ?? []) as Row[]), ...((oppRes.data ?? []) as Row[])]
    let complete = 0
    let skipped = 0
    // Searchable, but through its email thread rather than through chunks of
    // its own — a settled state, and counted apart so the card can say so. A
    // reader who sees these folded into `complete` has no way to tell the two
    // corpora apart, and a reader who sees them in `stuck` is looking at a
    // backlog that does not exist.
    let inMail = 0
    const stuck: Record<string, number> = {}
    // A 'processing' row that is genuinely in flight was touched by the pass
    // running right now, and a pass only ever touches a document it has just
    // read — so an old upload still sitting in 'processing' is a corpse, not a
    // worker. Neither table has an updated_at (checked 2026-10-05), so
    // uploaded_at is the only clock available; it is a FLOOR on the row's age,
    // which is the safe direction: it can make a stranded row look young, never
    // a live one look old.
    const PASS_IN_FLIGHT_MS = 24 * 60 * 60 * 1000
    let processingFresh = 0
    let processingStaleOldestDays = 0
    for (const r of rows) {
      const status = r.embedding_status ?? 'pending'
      if (status === 'complete') complete++
      else if (status === 'skipped') skipped++
      else if (status === INDEXED_IN_MAIL) inMail++
      else {
        stuck[status] = (stuck[status] ?? 0) + 1
        if (status === 'processing') {
          const ageMs = r.uploaded_at ? Date.now() - new Date(r.uploaded_at).getTime() : Infinity
          if (ageMs < PASS_IN_FLIGHT_MS) processingFresh++
          else
            processingStaleOldestDays = Math.max(
              processingStaleOldestDays,
              Math.floor(ageMs / 86_400_000)
            )
        }
      }
    }

    const tail =
      `${complete} indexed` +
      (inMail ? `, ${inMail} indexed with their email thread` : '') +
      `, ${skipped} not readable (correctly skipped).`

    // 'processing' means a pass is RUNNING, and the syncs work one document at
    // a time — so a single one is almost certainly in flight right now, and
    // calling that stalled would make this check cry wolf through every nightly
    // run. One pass may legitimately be in flight per table, so up to two are
    // excused. If a parallel importer is ever added, this rule has to change.
    //
    // ⚠ EXCUSING BY COUNT ALONE HID A STRANDED ROW FOR THIRTEEN DAYS. The
    // comment above this check already named it — "one had been stranded
    // mid-pass since 09-22" — and the rule then excused that very row as a
    // pass running now, every night, while `GridEdge DC Use of Funds` sat at 0
    // chunks and 0 characters with nothing on earth due to retry it. A row is
    // only in flight if it is ALSO recent.
    const inFlight = Math.min(processingFresh, 2)
    const stuckTotal = Object.values(stuck).reduce((a, b) => a + b, 0) - inFlight
    if (stuckTotal === 0) {
      return {
        state: 'ok',
        detail: inFlight
          ? `Every document is settled, ${inFlight} pass${inFlight === 1 ? '' : 'es'} running now. ${tail}`
          : `Every document is settled. ${tail}`,
      }
    }

    // The in-flight pass is excluded from the breakdown as well as the count,
    // or the two disagree: "1 document never finished (1 error, 1 processing)".
    const breakdown = Object.entries(stuck)
      .map(([k, v]) => [k, k === 'processing' ? v - inFlight : v] as const)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')
    return {
      state: 'stalled',
      detail:
        `${stuckTotal} document${stuckTotal === 1 ? '' : 's'} never finished indexing (${breakdown}) — ` +
        `${stuckTotal === 1 ? 'it is' : 'they are'} on the record but invisible to Ber AI. ` +
        `A Drive-sourced document is retried by its nightly sync; anything else needs the Reindex button on the document ` +
        `(an OPPORTUNITY document has no nightly retry at all — run scripts/reindex-opportunity-documents.mts). ` +
        (processingStaleOldestDays > 0
          ? `The oldest mid-pass row has been stranded ${processingStaleOldestDays} days, so no pass is coming back for it. `
          : '') +
        tail,
    }
  } catch (err) {
    return {
      state: 'failed',
      detail: `Could not count document indexing: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Are project Drive folders actually linked, and reaching the projects?
 *
 * Coverage, not pass/fail — the same argument as the publishing check beside
 * it. The inbound path existed for months pointed at a column no project ever
 * had, so it ran nightly and imported nothing while looking perfectly healthy.
 * An unlinked project is a legitimate state; an unlinked ESTATE is the failure,
 * and only a count says which one this is.
 */
export async function probeDriveSourceFolders(): Promise<{
  state: 'ok' | 'partial' | 'none'
  detail: string
}> {
  const supabase = createAdminClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, status, drive_source_folder_id, deal_folder_id')

  const rows = (projects ?? []) as {
    status: string | null
    drive_source_folder_id: string | null
    deal_folder_id: string | null
  }[]
  const open = rows.filter((r) => !['closed', 'lost'].includes(r.status ?? ''))
  const linked = open.filter((r) => r.drive_source_folder_id || r.deal_folder_id)

  const { count: imported } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .not('drive_file_id', 'is', null)
    .not('project_id', 'is', null)

  if (open.length === 0) return { state: 'ok', detail: 'No open projects.' }

  const tail = `${imported ?? 0} document${imported === 1 ? '' : 's'} imported from Drive so far.`
  if (linked.length === 0) {
    return {
      state: 'none',
      detail: `None of the ${open.length} open projects has a Drive folder linked, so nothing the team files in Drive reaches the platform. Link one from a project's Documents tab. ${tail}`,
    }
  }
  if (linked.length < open.length) {
    return {
      state: 'partial',
      detail: `${linked.length} of ${open.length} open projects have a Drive folder linked. The rest only see documents uploaded here. ${tail}`,
    }
  }
  return {
    state: 'ok',
    detail: `All ${open.length} open projects have a Drive folder linked and imported nightly. ${tail}`,
  }
}

/**
 * Is correspondence actually reaching the records it belongs to?
 *
 * This exists because the failure it watches for is silent by construction.
 * Before 2026-09-09 a reply to a stored thread was discarded outright — the
 * fingerprint is the thread's FIRST Message-ID, so a growing conversation looked
 * like one already seen. Nothing anywhere reported that, and measured against
 * live Gmail 3 of 40 sampled threads had quietly gone stale.
 *
 * Three numbers, each answering a different question a person would ask:
 * how much correspondence is filed, how much is waiting on a human, and whether
 * anything is stuck unrouted.
 */

/**
 * Open projects and opportunities that carry no match alias and have no
 * correspondence filed against them — the records the mail router is most
 * likely to be missing, listed so the fix is obvious rather than a chore.
 */
/**
 * Threads summarized long enough ago that routing should certainly have
 * reached them. Routing is deterministic and processes hundreds of threads in
 * seconds, so anything older than a few hours still unrouted means the phase
 * itself is not running.
 */
async function staleUnrouted(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - 6 * 3_600_000).toISOString()
    const { count } = await sweepDb()
      .from('email_threads')
      .select('id', { count: 'exact', head: true })
      .eq('summary_state', 'summarized')
      .is('routed_at', null)
      .lt('updated_at', cutoff)
    return count ?? 0
  } catch {
    return 0
  }
}

async function darkRecords(): Promise<string[]> {
  try {
    const admin = createAdminClient()
    const [{ data: projects }, { data: opportunities }, { data: links }] = await Promise.all([
      admin.from('projects').select('id, name, match_aliases').eq('status', 'active'),
      admin
        .from('opportunities')
        .select('id, name, match_aliases')
        .not('status', 'in', '("closed_won","closed_lost")'),
      sweepDb().from('thread_links').select('record_id'),
    ])

    const filed = new Set(
      ((links ?? []) as unknown as Array<{ record_id: string }>).map((l) => l.record_id)
    )
    const rows = [...(projects ?? []), ...(opportunities ?? [])] as Array<{
      id: string
      name: string | null
      match_aliases: string[] | null
    }>
    return rows
      .filter((r) => (r.match_aliases ?? []).length === 0 && !filed.has(r.id))
      .map((r) => r.name ?? 'Untitled')
      .sort()
  } catch {
    // The headline number is the point; a failure to enumerate must not turn a
    // healthy check into a failed one.
    return []
  }
}

export async function probeThreadRouting(): Promise<{
  state: 'ok' | 'empty' | 'warn' | 'failed'
  detail: string
}> {
  try {
    const db = sweepDb()
    const [linked, inferred, unrouted, pendingUpdates] = await Promise.all([
      db.from('thread_links').select('id', { count: 'exact', head: true }).eq('certainty', 'linked'),
      db
        .from('thread_links')
        .select('id', { count: 'exact', head: true })
        .eq('certainty', 'inferred'),
      db
        .from('email_threads')
        .select('id', { count: 'exact', head: true })
        .eq('summary_state', 'summarized')
        .is('routed_at', null),
      createAdminClient()
        .from('updates')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'email')
        .eq('review_state', 'pending'),
    ])

    const linkedCount = linked.count ?? 0
    const inferredCount = inferred.count ?? 0
    const unroutedCount = unrouted.count ?? 0
    const awaiting = pendingUpdates.count ?? 0

    if (linkedCount + inferredCount === 0) {
      return {
        state: 'empty',
        detail:
          'No email thread is tied to a record yet. Links are created when a lead is promoted, when a clustered deal is confirmed, and when routing matches a conversation to an existing project.',
      }
    }

    const parts = [
      `${linkedCount} thread${linkedCount === 1 ? '' : 's'} tied to a record directly, ${inferredCount} matched by inference.`,
    ]
    if (awaiting > 0) {
      parts.push(
        `${awaiting} email update${awaiting === 1 ? '' : 's'} waiting in the review queue — inferred matches stage there rather than posting straight onto a record.`
      )
    }
    if (unroutedCount > 0) {
      parts.push(`${unroutedCount} summarized thread${unroutedCount === 1 ? '' : 's'} not yet routed.`)
    }

    // Name the records that are dark, because the lever here is manual and
    // otherwise invisible. The router only files mail it can RECOGNISE, and
    // most threads never use a record's full name — an alias is the human
    // assertion that closes that gap, and setting one re-examines stored mail
    // immediately. A record with no alias AND no filed mail is the case where
    // adding one is most likely to pay.
    const dark = await darkRecords()
    if (dark.length > 0) {
      const shown = dark.slice(0, 5).join(', ')
      parts.push(
        `${dark.length} open record${dark.length === 1 ? ' has' : 's have'} no alias and no filed correspondence (${shown}${dark.length > 5 ? `, +${dark.length - 5} more` : ''}) — add short names under "Also known as" on the record and its stored mail is re-examined on save.`
      )
    }

    // AGE, not volume, is what catches a dead phase.
    //
    // The volume threshold below only fires on a large backlog, and for nine
    // days the route/apply/embed phases did not run at all in the hourly cron
    // (the serving process predated the deploy that added them) while the
    // backlog sat at a few dozen threads — well under any sensible count. A
    // count that has stopped growing is indistinguishable from a quiet inbox.
    // A thread that was summarized hours ago and is STILL unrouted is not:
    // routing is deterministic and takes seconds, so the only explanation is
    // that the phase is not running.
    const stale = await staleUnrouted()
    if (stale > 0) {
      parts.push(
        `${stale} thread${stale === 1 ? ' was summarized' : 's were summarized'} more than six hours ago and ${stale === 1 ? 'has' : 'have'} still not been routed — the route phase of the hourly sweep is not running. Check that the platform service was restarted after the last deploy (launchctl kickstart -k gui/$(id -u)/com.berwilson.platform), then look at ~/Library/Logs/berwilson/cron-email-sweep.log for which phases ran.`
      )
    }

    // A large unrouted backlog means the phase is not keeping up, which is worth
    // saying out loud — it is the shape of a stalled cron, not a quiet inbox.
    return {
      state: stale > 0 ? 'warn' : unroutedCount > 1000 ? 'warn' : 'ok',
      detail: parts.join(' '),
    }
  } catch (err) {
    return {
      state: 'failed',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Is the correspondence index keeping up with the mailbox?
 *
 * Counted out loud because the failure is invisible from the outside: an
 * unindexed thread does not error, it simply never appears in an answer, and a
 * question that returns nothing looks identical to a question with no answer.
 * That is the same argument as the Drive publishing and document indexing cards.
 */
export async function probeCorrespondenceIndex(): Promise<{
  state: 'ok' | 'empty' | 'warn' | 'failed'
  detail: string
}> {
  try {
    const db = sweepDb()
    const [indexed, pending, chunks] = await Promise.all([
      db
        .from('email_threads')
        .select('id', { count: 'exact', head: true })
        .not('embedded_at', 'is', null),
      db
        .from('email_threads')
        .select('id', { count: 'exact', head: true })
        .eq('summary_state', 'summarized')
        .is('embedded_at', null)
        // Same filter as the embedder: lead threads carry no summary, so a
        // plain .neq() on relevance would drop every one of them and the card
        // would under-report the backlog by ~1,000 threads.
        .or('summary->>relevance.is.null,summary->>relevance.neq.noise'),
      db.from('thread_chunks').select('id', { count: 'exact', head: true }),
    ])

    const indexedCount = indexed.count ?? 0
    const pendingCount = pending.count ?? 0
    const chunkCount = chunks.count ?? 0

    if (indexedCount === 0) {
      return {
        state: 'empty',
        detail:
          'No correspondence is indexed yet, so Ber AI cannot answer from what was said in email. The sweep indexes a batch each run; run scripts/backfill-thread-embeddings.mjs to catch up at once.',
      }
    }

    const detail = `${indexedCount.toLocaleString()} threads indexed (${chunkCount.toLocaleString()} passages). ${
      pendingCount > 0
        ? `${pendingCount.toLocaleString()} waiting — the hourly sweep works through them.`
        : 'Nothing waiting.'
    }`

    // A large backlog means the phase is not keeping up, which is worth saying
    // rather than leaving as a number nobody reads.
    return { state: pendingCount > 500 ? 'warn' : 'ok', detail }
  } catch (err) {
    return { state: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Is the website deal-intake folder reachable, and is anything waiting?
 *
 * The whole path is a pull: a form writes a folder, a cron reads it. If the
 * credential lapses or the folder id is wrong, submissions simply stop arriving
 * and "no new deals" is indistinguishable from "everything is fine". That is
 * the exact failure shape this platform has rediscovered repeatedly, so it is
 * checked rather than assumed.
 *
 * `empty` is deliberately its own state: no submissions yet is the correct
 * condition on day one, and it must not read as broken.
 */
export async function probeDealIntake(): Promise<{
  state: 'ok' | 'empty' | 'unconfigured' | 'failed'
  detail: string
}> {
  const folderId = process.env.GOOGLE_DEAL_INTAKE_FOLDER_ID?.trim()
  if (!folderId) {
    return {
      state: 'unconfigured',
      detail:
        'Set GOOGLE_DEAL_INTAKE_FOLDER_ID to the Drive folder the berwilson.com deal form creates one subfolder per submission inside. Unset means deal intake is switched off — the form can still run, but nothing reaches the leads queue.',
    }
  }

  const mailbox = PRIMARY_MAILBOX
  try {
    const q = encodeURIComponent(
      `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )
    const data = await googleFetch<{ files?: { name: string }[] }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      mailbox
    )
    const folders = data.files?.length ?? 0

    // What actually matters is how many became leads. A folder count alone
    // would look healthy while every manifest failed to parse.
    let staged = 0
    try {
      const { count } = await leadsDb()
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'web_form')
      staged = count ?? 0
    } catch {
      // Pre-migration, or leads unreachable — the Drive half is still worth
      // reporting on its own.
    }

    if (folders === 0) {
      return {
        state: 'empty',
        detail: `Folder is readable by ${mailbox}, and no deals have been submitted yet. The scan runs every 15 minutes.`,
      }
    }
    const behind = folders - staged
    return {
      state: 'ok',
      detail:
        `${folders} deal folder${folders === 1 ? '' : 's'}, ${staged} staged as leads` +
        (behind > 0
          ? `. ${behind} not staged — usually a submission still uploading (the form writes _intake.json last); check the cron log if it persists.`
          : '.'),
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    let fix = ''
    if (/has not been used in project|accessNotConfigured/.test(raw)) {
      fix =
        ' Enable the Drive API on the project that owns the OAuth client — the message names the project number.'
    } else if (/insufficient|scope|403/i.test(raw)) {
      fix = ` Re-consent with: node scripts/setup-google-oauth.mjs --only ${mailbox}`
    } else if (/404|not found/i.test(raw)) {
      fix = ` The folder is probably owned by another account — share it with ${mailbox}.`
    }
    return { state: 'failed', detail: `${raw}${fix}` }
  }
}

/**
 * Is the Google Chat space wired up?
 *
 * Purely a config read — there is no way to test an incoming webhook without
 * posting to the space, and a health check that spams the room every time
 * somebody opens the page is worse than no check at all.
 */
export function probeChat(): { state: 'ok' | 'unconfigured'; detail: string } {
  const spaces = Object.keys(process.env)
    .filter((k) => k.startsWith('GOOGLE_CHAT_WEBHOOK_URL_') && process.env[k]?.trim())
    .map((k) => k.replace('GOOGLE_CHAT_WEBHOOK_URL_', '').toLowerCase())

  if (!isChatConfigured()) {
    return {
      state: 'unconfigured',
      detail:
        'Set GOOGLE_CHAT_WEBHOOK_URL to post the weekly brief and the lead digest into a Chat space — the cheapest way to reach teammates who cannot get onto the tailnet. Get the URL from Chat → the space → Apps & integrations → Webhooks → Add webhook. Treat it as a secret: it carries its own auth token.',
    }
  }

  const extra = spaces.length ? ` Dedicated spaces: ${spaces.join(', ')}.` : ''
  return {
    state: 'ok',
    detail: `Default space configured — the weekly brief and lead digests post there.${extra}`,
  }
}

/**
 * How much of the directory has reached the mailboxes' contacts?
 *
 * Reported as coverage rather than pass/fail: a party with no address and no
 * number is deliberately not synced, so "not everything is in Google" is the
 * correct steady state and must not read as a fault.
 */
export async function probeContactsSync(): Promise<{
  state: 'ok' | 'stale' | 'unconfigured'
  detail: string
}> {
  if (!isGoogleConfigured()) {
    return { state: 'unconfigured', detail: 'Google Workspace is not configured.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('parties')
    .select('email, phone, status, google_contacts_hash')

  if (error) return { state: 'unconfigured', detail: `Could not read the directory: ${error.message}` }

  const rows = (data ?? []) as {
    email: string | null
    phone: string | null
    status: string
    google_contacts_hash: string | null
  }[]

  const eligible = rows.filter(
    (r) => r.status !== 'archived' && Boolean(r.email?.trim() || r.phone?.trim())
  )
  const synced = eligible.filter((r) => r.google_contacts_hash).length
  const mailboxes = allMailboxes().length
  const skipped = rows.length - eligible.length

  const detail =
    `${synced} of ${eligible.length} contactable ${eligible.length === 1 ? 'party' : 'parties'} pushed to ` +
    `${mailboxes} mailbox${mailboxes === 1 ? '' : 'es'}.` +
    (skipped
      ? ` ${skipped} skipped — archived, or no email and no phone, so they would only clutter autocomplete.`
      : '')

  if (synced < eligible.length) {
    return {
      state: 'stale',
      detail: `${detail} The rest go out on the next nightly run (2:45am).`,
    }
  }
  return { state: 'ok', detail }
}


/**
 * Is the shared task sheet actually being rebuilt, and can anyone settle in it?
 *
 * Replaced probeGoogleTasks on 2026-10-11. That probe measured COVERAGE — how
 * many members had connected an account — which was the right question for a
 * per-person sync and is meaningless for one shared workbook. The questions now
 * are whether the workbook exists, whether the rebuild is still running, and
 * whether the people who have to tick a box can write to it.
 *
 * ⚠ IT WATCHES THE OUTPUT SIDE ON PURPOSE. The commitment loop reported "476
 * open" in green for sixteen days — correctly, extraction is why it was 476 —
 * while nothing had ever been settled by a human (§12, 10-09). The same shape
 * is available here: a sheet full of open tasks is exactly what a healthy
 * publish produces AND what a sheet nobody can tick produces. So a workbook
 * that has never had a single tick read out of it is called out rather than
 * counted as health. It is not an alarm — a new board legitimately has none —
 * which is why it reads as `partial` and says what it is waiting for.
 */
export async function probeTaskSheet(): Promise<{
  state: 'ok' | 'partial' | 'unconfigured' | 'stalled' | 'failed'
  detail: string
}> {
  if (!isGoogleConfigured()) {
    return { state: 'unconfigured', detail: 'Google Workspace is not configured.' }
  }

  const supabase = createAdminClient()
  const [state, openTasks] = await Promise.all([
    supabase
      .from('task_sheet_state')
      .select('spreadsheet_id, spreadsheet_url, last_synced_at, last_error, rows_published, settled_total')
      .maybeSingle(),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ])

  if (state.error) {
    return { state: 'failed', detail: `Could not read the task-sheet state: ${state.error.message}` }
  }

  const row = state.data as {
    spreadsheet_id: string
    spreadsheet_url: string | null
    last_synced_at: string | null
    last_error: string | null
    rows_published: number
    settled_total: number
  } | null

  if (!row) {
    return {
      state: 'unconfigured',
      detail:
        'The task sheet has never been built. The next run of /api/cron/task-sheet creates it; ' +
        'if it does not, check that the Google Sheets API is enabled on the Cloud project.',
    }
  }

  // The cadence lives in deploy/com.berwilson.cron-task-sheet.plist
  // (StartInterval). These two must move together: a threshold under the
  // interval calls a healthy sync stalled, one far over it hides a dead job.
  const SYNC_INTERVAL_MINUTES = 15
  // An hour rather than two missed runs. This box DarkWakes and sleeps through
  // the day, so a couple of skipped ticks is ordinary and 30 minutes would cry
  // wolf; an hour still names a dead job inside the hour.
  const STALE_AFTER_MINUTES = 60
  const ageMinutes = row.last_synced_at
    ? (Date.now() - new Date(row.last_synced_at).getTime()) / 60_000
    : Infinity

  // Infinity — built but never completed a run — must land here too. Excluding
  // it is how a never-once-working job reads as a clean bill of health.
  if (ageMinutes > STALE_AFTER_MINUTES) {
    return {
      state: 'stalled',
      detail:
        (Number.isFinite(ageMinutes)
          ? `The task sheet has not been rebuilt in ${Math.round(ageMinutes)} minutes`
          : 'The task sheet exists but no run has ever completed') +
        `. The job runs every ${SYNC_INTERVAL_MINUTES} minutes.` +
        (row.last_error ? ` Last error: ${row.last_error}` : ''),
    }
  }

  const open = openTasks.count ?? 0
  const detail =
    `${row.rows_published} row${row.rows_published === 1 ? '' : 's'} published ` +
    `(${open} open), rebuilt ${Math.round(ageMinutes)} minute${Math.round(ageMinutes) === 1 ? '' : 's'} ago. ` +
    `${row.settled_total} task${row.settled_total === 1 ? '' : 's'} settled from the sheet so far.`

  if (row.last_error) {
    return { state: 'partial', detail: `${detail} Last run reported: ${row.last_error}` }
  }

  // The output-side check. Open tasks and no tick ever read is the shape that
  // looks healthy and is not — see the docstring.
  if (row.settled_total === 0 && open > 0) {
    return {
      state: 'partial',
      detail:
        `${detail} Nothing has ever been ticked off in the sheet — if that is not simply ` +
        `because nobody has tried yet, check that moose@ and tuaone@ hold WRITER on the ` +
        `workbook (the Ber Intelligence root shares as reader, which is not enough).`,
    }
  }

  return { state: 'ok', detail }
}

/**
 * Are record documents actually reaching the Drive folder people are told to
 * look in?
 *
 * This is the check the whole publishing feature needed and did not have: it
 * shipped as a button, the button worked, and one project out of fifteen had
 * ever been pressed. Nothing anywhere said so.
 */
export async function probeDrivePublishing(): Promise<{
  state: 'ok' | 'stale' | 'unconfigured'
  detail: string
}> {
  if (!isGoogleConfigured()) {
    return { state: 'unconfigured', detail: 'Google Workspace is not configured.' }
  }

  const supabase = createAdminClient()

  const count = async (table: 'documents' | 'opportunity_documents', fk: string, published: boolean) => {
    const query = supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .not(fk, 'is', null)
    const { count: n } = await (published
      ? query.not('drive_published_id', 'is', null)
      : query.is('drive_published_id', null))
    return n ?? 0
  }

  const pairs: [('documents' | 'opportunity_documents'), string][] = [
    ['documents', 'project_id'],
    ['documents', 'steel_deal_id'],
    ['opportunity_documents', 'opportunity_id'],
  ]

  let pending = 0
  let published = 0
  for (const [table, fk] of pairs) {
    pending += await count(table, fk, false)
    published += await count(table, fk, true)
  }

  if (pending === 0) {
    return {
      state: 'ok',
      detail: `All ${published} record document${published === 1 ? '' : 's'} are published to Drive.`,
    }
  }
  return {
    state: 'stale',
    detail: `${published} published, ${pending} waiting. The rest go up on the next nightly run (3:45am), or publish one record now from its Documents tab.`,
  }
}

// Re-exported so the health page has one import site for every probe.
export { probeScopeCoverage }

/**
 * Is Meet transcript import able to do anything?
 *
 * The dead state here is quiet and easy to miss: if nobody records with
 * transcription switched on, Google never creates a "Meet Recordings" folder,
 * the importer finds nothing every run, and "the feature is off at Google" is
 * indistinguishable from "nobody had meetings this week". This says which.
 */
export async function probeMeetImport(): Promise<{
  state: 'ok' | 'empty' | 'unconfigured' | 'failed'
  detail: string
}> {
  if (!isGoogleConfigured()) {
    return {
      state: 'unconfigured',
      detail: 'Google Workspace is not configured, so no Drive can be read for Meet transcripts.',
    }
  }

  const supabase = createAdminClient()
  const { count: imported } = await supabase
    .from('email_intake_sessions')
    .select('id', { count: 'exact', head: true })
    .not('drive_file_id', 'is', null)

  const withFolder: string[] = []
  const withoutFolder: string[] = []
  try {
    for (const mailbox of MAILBOXES) {
      const artifacts = await listMeetTranscripts(mailbox, { limit: 1 })
      if (artifacts.noMeetFolder) withoutFolder.push(mailbox)
      else withFolder.push(mailbox)
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const fix = /insufficient|scope|403/i.test(raw)
      ? ' Re-consent with: node scripts/setup-google-oauth.mjs'
      : ''
    return { state: 'failed', detail: `${raw}${fix}` }
  }

  const tally = `${imported ?? 0} transcript${imported === 1 ? '' : 's'} imported so far.`

  if (!withFolder.length) {
    return {
      state: 'empty',
      detail:
        `No "Meet Recordings" folder in ${withoutFolder.join(' or ')} — Google only creates it once a call is recorded ` +
        'with transcription switched on (Workspace admin console → Apps → Google Meet, and the "Record"/"Transcribe" ' +
        `control in the meeting itself). Nothing can be imported until then. ${tally}`,
    }
  }

  const missing = withoutFolder.length ? ` No folder yet in ${withoutFolder.join(', ')}.` : ''
  return {
    state: 'ok',
    detail: `Reading Meet transcripts from ${withFolder.join(', ')}.${missing} ${tally}`,
  }
}

/**
 * Text messages — is the snapshot fresh, and are sessions reaching the corpus?
 *
 * ⚠ WATCH THE CLOCK, NOT THE COUNT. The failure mode here is doing nothing
 * quietly: if `bw-snapshot` loses Full Disk Access — which a macOS update can
 * do — the file it already left behind stays perfectly readable and simply
 * stops changing. Every run then succeeds, finds no new sessions, and reports a
 * quiet week, which is exactly what a genuinely quiet week looks like. §12: a
 * coverage count that has stopped growing is indistinguishable from a quiet
 * inbox, so measure AGE.
 *
 * And both halves are checked, because a green producer with a dead consumer
 * reads as health: the snapshot can be minutes old while no session has ever
 * been written, which means the classifier is selecting nothing.
 */
export async function probeIMessageSweep(): Promise<{
  state: 'ok' | 'empty' | 'unconfigured' | 'failed'
  detail: string
}> {
  const { snapshotDbPath } = await import('@/lib/imessage/read')
  const path = snapshotDbPath()

  let ageMs: number | null = null
  try {
    const { statSync } = await import('node:fs')
    ageMs = Date.now() - statSync(path).mtimeMs
  } catch {
    return {
      state: 'unconfigured',
      detail:
        `No Messages snapshot at ${path}. Build the helper and grant it Full Disk Access: ` +
        'zsh scripts/build-snapshot.sh, then System Settings → Privacy & Security → Full Disk Access → ~/.local/bin/bw-snapshot.',
    }
  }

  const supabase = createAdminClient()
  const { count: sessions } = await supabase
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .like('gmail_thread_id', 'imessage:%')

  const { data: newest } = await supabase
    .from('email_threads')
    .select('last_at')
    .like('gmail_thread_id', 'imessage:%')
    .order('last_at', { ascending: false })
    .limit(1)

  const hours = Math.round(ageMs / 3_600_000)
  const tally = `${sessions ?? 0} text session${sessions === 1 ? '' : 's'} in the corpus`
  const latest = newest?.[0]?.last_at
    ? `, newest conversation ${String(newest[0].last_at).slice(0, 10)}`
    : ''

  // The snapshot agent runs four times a day, so anything past ~8h is a miss.
  if (ageMs > 8 * 3_600_000) {
    return {
      state: 'failed',
      detail:
        `Snapshot is ${hours}h old — com.berwilson.snapshot is not running, or bw-snapshot has lost Full Disk Access ` +
        `(a macOS update can revoke it). Texts stopped arriving ${hours}h ago. ${tally}${latest}.`,
    }
  }

  if (!sessions) {
    return {
      state: 'empty',
      detail:
        `Snapshot is ${hours}h old and readable, but no text session has ever been written. ` +
        'Either no conversation clears the business filter, or the sweep has not run — check with the dry run: ' +
        'curl "localhost:3000/api/cron/imessage-sweep?dryRun=true".',
    }
  }

  return { state: 'ok', detail: `Snapshot ${hours}h old. ${tally}${latest}.` }
}

/**
 * Is the Drive audio intake folder being read?
 *
 * ⚠ THE FAILURE MODES HERE ARE NOT THE VOICE MEMO ONES, WHICH IS WHY THIS IS A
 * SEPARATE PROBE RATHER THAN A SECOND CALLER. A memo arrives through a snapshot,
 * so its probe watches a FILE's clock: the two silent faults are Voice Memos.app
 * being closed and `bw-snapshot` losing Full Disk Access. Nothing in this chain
 * has a snapshot or a local file — the faults are a folder id nobody set, a
 * folder the mailbox can no longer open (a revoked scope, a deleted folder, a
 * shared drive somebody left), and a backlog that is not draining because
 * whisper is failing on every file.
 *
 * ⚠ A BACKLOG IS THE SIGNAL, NOT A COUNT OF WHAT WAS READ. §12: a count that
 * has stopped growing is indistinguishable from a quiet week. Here there is
 * something better than a clock — the folder itself says what is owed, so
 * "files present that have no thread" is a direct measure of whether the
 * consuming half of the loop is running at all.
 */
export async function probeDriveAudio(): Promise<{
  state: 'ok' | 'empty' | 'unconfigured' | 'failed'
  detail: string
}> {
  const { driveAudioFolderId, readDriveAudio } = await import('@/lib/driveaudio/read')
  const { driveAudioThreadId } = await import('@/lib/driveaudio/to-thread')

  const folderId = driveAudioFolderId()
  if (!folderId) {
    return {
      state: 'unconfigured',
      detail:
        'No audio intake folder is nominated, so a recording exported to Drive is read by ' +
        'nothing. Create one with `node --experimental-strip-types --import ./deploy/register.mjs ' +
        '--env-file=.env.local scripts/setup-audio-intake.mts`, put the id in ' +
        'GOOGLE_AUDIO_INTAKE_FOLDER_ID, then rebuild and kickstart.',
    }
  }

  const read = await readDriveAudio()
  if (read.error) {
    return {
      state: 'failed',
      detail:
        `The intake folder (${folderId}) could not be read: ${read.error} A deleted folder, a ` +
        `revoked Drive scope and a shared drive the mailbox was removed from all look like this.`,
    }
  }

  const supabase = createAdminClient()
  const { count: ingested } = await supabase
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .like('gmail_thread_id', 'driveaudio:%')

  // What is in the folder but not in the corpus. Chunked for the same reason
  // the sweep chunks it: a filter rides in the query string (§12).
  let waiting = 0
  if (read.files.length > 0) {
    const ids = read.files.map((f) => driveAudioThreadId(f.fileId))
    const seen = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await supabase
        .from('email_threads')
        .select('fingerprint')
        .in('fingerprint', ids.slice(i, i + 200))
      for (const r of (data ?? []) as { fingerprint: string | null }[]) {
        if (r.fingerprint) seen.add(r.fingerprint)
      }
    }
    waiting = ids.filter((id) => !seen.has(id)).length
  }

  const tally =
    `${ingested ?? 0} recording${ingested === 1 ? '' : 's'} read from the folder, ` +
    `${read.files.length} file${read.files.length === 1 ? '' : 's'} in it now`

  // More than one run's ceiling still waiting means the sweep is not getting
  // through them — whisper missing, the box paging, or every file deferring.
  if (waiting > 6) {
    return {
      state: 'failed',
      detail:
        `${waiting} recording(s) are sitting in the intake folder unread. The sweep takes 6 per ` +
        `run, so a backlog this size is not a queue — check the log for a repeating reason: ` +
        `\`tail ~/Library/Logs/berwilson/cron-drive-audio-sweep.log\`, and ` +
        `\`curl -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/drive-audio-sweep?dry=1"\`. ${tally}.`,
    }
  }

  if (!ingested) {
    return {
      state: 'empty',
      detail:
        read.files.length === 0
          ? `The folder is readable and empty. Export a recording into it (or into a subfolder ` +
            `named after the deal) and it is read within the hour. ${tally}.`
          : `The folder is readable and holds ${read.files.length} file(s), but nothing has been ` +
            `read from it yet — the next run takes them. ${tally}.`,
    }
  }

  return {
    state: 'ok',
    detail:
      waiting > 0
        ? `${tally}, ${waiting} waiting for the next run (hourly in business hours).`
        : `${tally}, nothing waiting.`,
  }
}

/**
 * Voice memos — can an in-person meeting still reach the platform?
 *
 * ⚠ THREE THINGS HAVE TO BE TRUE AND NONE OF THEM REPORTS ITSELF. Voice Memos
 * must be RUNNING on the Studio for iCloud to sync anything down (the trap
 * Notes set on 10-12, when the local store sat eleven days behind the phone
 * with nothing saying so); `bw-snapshot` must still hold Full Disk Access,
 * which a macOS update can revoke; and the sweep must be reaching the
 * recordings. Every one of those failures leaves the previous snapshot sitting
 * there, perfectly readable, simply not changing — so each run succeeds, finds
 * nothing new, and reports a quiet week. §12: watch the CLOCK, not the count.
 *
 * `unconfigured` is a real and expected state here, distinct from broken: until
 * Voice Memos.app has been opened once on this Mac, the group container exists
 * and holds nothing at all.
 */
export async function probeVoiceMemos(): Promise<{
  state: 'ok' | 'empty' | 'unconfigured' | 'failed'
  detail: string
}> {
  const { voiceMemoSnapshotPath } = await import('@/lib/voicememos/read')
  const path = voiceMemoSnapshotPath()

  let ageMs: number | null = null
  try {
    const { statSync } = await import('node:fs')
    ageMs = Date.now() - statSync(path).mtimeMs
  } catch {
    return {
      state: 'unconfigured',
      detail:
        `No Voice Memos store at ${path}. In order: switch on iCloud → Voice Memos on the ` +
        `iPhone, open Voice Memos.app on the Studio and LEAVE IT RUNNING (it syncs only ` +
        `while open), then \`launchctl kickstart -k gui/$(id -u)/com.berwilson.snapshot\`. ` +
        `Until then an in-person meeting has no way in.`,
    }
  }

  const supabase = createAdminClient()
  const { count: recordings } = await supabase
    .from('email_threads')
    .select('id', { count: 'exact', head: true })
    .like('gmail_thread_id', 'voicememo:%')

  const { data: newest } = await supabase
    .from('email_threads')
    .select('last_at')
    .like('gmail_thread_id', 'voicememo:%')
    .order('last_at', { ascending: false })
    .limit(1)

  const hours = Math.round(ageMs / 3_600_000)
  const tally = `${recordings ?? 0} recording${recordings === 1 ? '' : 's'} in the corpus`
  const latest = newest?.[0]?.last_at
    ? `, newest ${String(newest[0].last_at).slice(0, 10)}`
    : ''

  // The snapshot agent runs four times a day, so anything past ~8h is a miss.
  if (ageMs > 8 * 3_600_000) {
    return {
      state: 'failed',
      detail:
        `The Voice Memos store here is ${hours}h old. Either com.berwilson.snapshot is not ` +
        `running, or bw-snapshot has lost Full Disk Access (a macOS update can revoke it), or ` +
        `Voice Memos.app is closed on the Studio — it syncs only while open. A meeting ` +
        `recorded since then has not arrived and nothing else would say so. ${tally}${latest}.`,
    }
  }

  if (!recordings) {
    return {
      state: 'empty',
      detail:
        `The store is ${hours}h old and readable, but no recording has ever been ingested. ` +
        `If you have recorded one, check what the sweep sees: ` +
        `curl -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/cron/voice-memo-sweep?dry=1".`,
    }
  }

  return {
    state: 'ok',
    detail:
      `Store ${hours}h old. ${tally}${latest}. Every memo is transcribed on this box and ` +
      `judged; a recording the summarizer calls private has its transcript, chunks and audio ` +
      `discarded and is never read again.`,
  }
}

/**
 * Business-card scanner — is the local OCR binary built on this host?
 *
 * It is a compiled artifact living outside the repo (~/.local/bin/bw-ocr), so a
 * fresh machine, a wiped ~/.local, or a Command Line Tools reinstall silently
 * removes the feature: the Scan Card button stays visible and fails only when
 * someone actually photographs a card. Cheap to check, so check it.
 */
export async function probeCardOcr(): Promise<{ state: 'ok' | 'missing'; detail: string }> {
  const { ocrAvailable, ocrBinPath } = await import('@/lib/ai/card-ocr')
  const bin = ocrBinPath()
  if (await ocrAvailable()) {
    return { state: 'ok', detail: `Recognizer present at ${bin}. Card text is read on this machine; no photo is stored.` }
  }
  return {
    state: 'missing',
    detail: `No OCR binary at ${bin}. Build it on this host with \`zsh scripts/build-ocr.sh\` (needs the macOS Command Line Tools). Until then, Scan Card on the Directory will fail.`,
  }
}

/**
 * Meeting transcription — is whisper.cpp actually usable on this host?
 *
 * Same shape as the card recognizer: the binary and the ~1.5GB ggml model live
 * outside the repo, so either can disappear while WHISPER_BIN/WHISPER_MODEL
 * still point at them. When that happens the Add-recording button keeps working,
 * the upload succeeds, and the failure only lands later as a meeting stuck at
 * transcription_status='error'. Check the files.
 */
export async function probeWhisper(): Promise<{ state: 'ok' | 'missing' | 'unconfigured'; detail: string }> {
  const { whisperEnabled, whisperAvailable, whisperPaths } = await import('@/lib/ai/whisper')
  if (!whisperEnabled()) {
    return {
      state: 'unconfigured',
      detail: 'WHISPER_BIN / WHISPER_MODEL are unset, so uploaded recordings are stored but never transcribed. Expected on a non-Studio host.',
    }
  }
  const { ok, missing } = await whisperAvailable()
  if (ok) {
    const { model } = whisperPaths()
    return { state: 'ok', detail: `Transcription ready (${model}). Recordings are transcribed on this machine; no audio leaves it.` }
  }
  return {
    state: 'missing',
    detail: `Configured but missing on disk: ${missing.join(', ')}. Re-download the model with \`cd ~/whisper.cpp/models && ./download-ggml-model.sh large-v3-turbo\`. Until then, uploading a recording will fail to transcribe.`,
  }
}

/**
 * Are documents actually reaching the team's own Drive folders?
 *
 * Filing is silent by construction: it is best-effort, it never fails the
 * import that called it, and a document that is never filed looks exactly like
 * a quiet week. This counts it out loud -- the same argument as the Drive
 * publishing and correspondence-index cards.
 *
 * Reports COVERAGE rather than pass/fail, because "not everything is filed" is
 * the correct steady state: a record with no linked folder has nowhere to file
 * to, and that is a linking decision a human has to make.
 */
export async function probeDriveFiling(): Promise<{
  state: 'ok' | 'partial' | 'none' | 'empty'
  detail: string
}> {
  const supabase = createAdminClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, status, drive_source_folder_id')
  const open = ((projects ?? []) as {
    id: string
    status: string | null
    drive_source_folder_id: string | null
  }[]).filter((r) => !['closed', 'lost'].includes(r.status ?? ''))
  const linked = open.filter((r) => r.drive_source_folder_id)

  if (linked.length === 0) {
    return {
      state: 'none',
      detail:
        `None of the ${open.length} open projects has a Drive folder linked, so no document can be filed ` +
        `into the team's own folders. Link one from a project's Documents tab.`,
    }
  }

  const linkedIds = linked.map((r) => r.id)
  const { count: filed } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .in('project_id', linkedIds)
    .not('drive_folder_path', 'is', null)
  // Counted in code rather than as a filter because "will never be filed" is a
  // property of the file, not a column: calendar invites arrive as attachments
  // and become documents, and they are deliberately skipped forever. Counting
  // them as pending would leave this check permanently reporting a backlog that
  // no nightly pass will ever clear -- the shape of a silent gap, inverted.
  const { data: unfiledRows } = await supabase
    .from('documents')
    .select('file_name, mime_type')
    .in('project_id', linkedIds)
    .is('drive_file_id', null)
    .is('superseded_at', null)
  const unfiled = ((unfiledRows ?? []) as { file_name: string; mime_type: string | null }[])
    .filter((d) => isFileable(d.file_name, d.mime_type)).length

  const { count: unsorted } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .in('project_id', linkedIds)
    .eq('drive_folder_path', '_Unsorted')

  const scope = `${linked.length} of ${open.length} open projects linked.`
  const sorted = `${filed ?? 0} document${filed === 1 ? '' : 's'} filed` +
    ((unsorted ?? 0) > 0 ? `, ${unsorted} waiting in _Unsorted` : '')

  if ((filed ?? 0) === 0 && unfiled === 0) {
    return { state: 'empty', detail: `${scope} No documents on those projects yet.` }
  }
  if (unfiled > 0) {
    return {
      state: 'partial',
      detail: `${scope} ${sorted}. ${unfiled} not filed yet — they go out on the nightly Drive pass.`,
    }
  }
  return { state: 'ok', detail: `${scope} ${sorted}.` }
}

/**
 * Is the lead mailbox actually staying clean?
 *
 * Directly measures the thing the hygiene pass exists to produce. Its failure
 * mode is otherwise silent: the phase is wrapped in a try/catch so a revoked
 * gmail.modify scope, or Gmail refusing the SPAM label, would stop the cleanup
 * without stopping the sweep — and the only symptom would be an inbox slowly
 * filling back up, which nobody notices until it is thousands deep again.
 *
 * One Gmail call. The inbox held 8,045 threads before the first backfill, of
 * which 7,613 predated the lead sweep's 90-day horizon entirely.
 */
export async function probeLeadInbox(): Promise<{
  state: 'ok' | 'warn' | 'unconfigured' | 'failed'
  detail: string
}> {
  if (!isGoogleConfigured()) {
    return { state: 'unconfigured', detail: 'Google Workspace is not configured.' }
  }
  if (process.env.LEAD_MAILBOX_HYGIENE === 'off') {
    return {
      state: 'unconfigured',
      detail: 'LEAD_MAILBOX_HYGIENE=off — the inbox is not being tidied. Unset it to resume.',
    }
  }

  const mailbox = LEAD_MAILBOXES[0]
  try {
    let count = 0
    let page: string | undefined
    // Paged rather than trusting resultSizeEstimate, which is an estimate and
    // was measured returning a flat 201 for two very different mailboxes.
    do {
      const d = await googleFetch<{ threads?: unknown[]; nextPageToken?: string }>(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}` +
          `/threads?maxResults=500&q=${encodeURIComponent('in:inbox')}` +
          (page ? `&pageToken=${page}` : ''),
        mailbox
      )
      count += d.threads?.length ?? 0
      page = d.nextPageToken
      // A runaway inbox is the thing being detected; do not page it forever.
      if (count > 5000) break
    } while (page)

    if (count > 1500) {
      return {
        state: 'warn',
        detail: `${mailbox} holds ${count > 5000 ? 'over 5,000' : count} inbox threads. The hygiene pass may have stopped — check the lead sweep log for [leads/hygiene].`,
      }
    }
    return { state: 'ok', detail: `${mailbox}: ${count} threads in the inbox.` }
  } catch (err) {
    return {
      state: 'failed',
      detail: `Could not read ${mailbox}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Pepper's 06:45 text — the channel she is read on, and the one nothing watched.
 *
 * ⚠ THIS IS THE EXACT FOOTING THE MORNING NOTE WAS ON UNTIL 2026-10-08, when
 * its check turned out to be reading `task_digest` — the retired Monday email —
 * so the live channel went unmonitored while the dead one reported healthy. The
 * text has had the same shape of row in `notification_log` since 10-13 and no
 * card at all, and it is the message that arrives first: `pepper-text/route.ts`
 * calls it "what gets read first" in its own header.
 *
 * A clock, not a count (§12). Four days, for the same reason the note's check
 * uses four: weekdays only, so a Monday reading is three days after Friday's
 * send with nothing wrong.
 */
export async function probePepperText(): Promise<{
  state: 'ok' | 'stale' | 'failed' | 'never'
  detail: string
}> {
  const supabase = createAdminClient()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [last, failed] = await Promise.all([
    supabase
      .from('notification_log')
      .select('created_at')
      .eq('kind', 'pepper_text')
      .eq('status', 'sent')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'pepper_text')
      .eq('status', 'failed')
      .gte('created_at', weekAgo),
  ])

  const failures = failed.count ?? 0
  if (failures > 0) {
    return {
      state: 'failed',
      detail:
        `${failures} text${failures === 1 ? '' : 's'} failed to send in the last 7 days. ` +
        'The transport is a hand-built Shortcut per recipient (macOS 27 removed ' +
        "Messages' AppleScript dictionary), so a failure is usually a renamed or " +
        'deleted Shortcut. Assert them with zsh deploy/pepper-text-check.sh — it does not send.',
    }
  }

  if (!last.data?.created_at) {
    return {
      state: 'never',
      detail:
        'No morning text has ever sent. PEPPER_TEXT_TARGETS must name each recipient ' +
        'as email=handle=shortcut, and the two Shortcuts must exist — see deploy/pepper-text-setup.md.',
    }
  }

  const hours = (Date.now() - new Date(last.data.created_at).getTime()) / 3_600_000
  if (hours > 96) {
    return {
      state: 'stale',
      detail:
        `The last text sent ${Math.round(hours / 24)} days ago. Weekdays at 06:45, ` +
        'ahead of the email note. Check com.berwilson.cron-pepper-text is loaded and ' +
        'that the Shortcuts still exist under those names.',
    }
  }
  return { state: 'ok', detail: 'Sending on schedule, ahead of the morning email.' }
}

/**
 * The autonomous curator — 06:20 weekdays, writing to the CRM unattended.
 *
 * ⚠ IT HAD NO CHECK OF ANY KIND. The one pass in the platform that changes
 * records with no human in the loop (whitelisted to 40 columns, §11) was the
 * one pass nothing watched, and its failure mode is the worst shape there is:
 * records quietly stop being updated, which from outside is indistinguishable
 * from "nothing changed in the mail". §12: a check on a pass whose failure is
 * doing nothing needs a clock.
 *
 * The clock is `curator_cursors.last_run_at`, which the pass stamps on every
 * record it considers — including the ones it skipped as unchanged, so a quiet
 * corpus still advances it.
 */
export async function probeCurator(): Promise<{
  state: 'ok' | 'stale' | 'errored' | 'never'
  detail: string
}> {
  const supabase = createAdminClient()

  const [last, errored, proposals] = await Promise.all([
    supabase
      .from('curator_cursors')
      .select('last_run_at')
      .order('last_run_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('curator_cursors')
      .select('id', { count: 'exact', head: true })
      .not('last_error', 'is', null),
    // Not a liveness signal — a standing one. A proposal is a question she is
    // waiting on an answer to, and until /decide renders them they accumulate
    // with no door, so the count belongs where somebody reads it.
    supabase
      .from('field_update_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])

  const pending = proposals.count ?? 0
  const pendingNote = pending > 0 ? ` ${pending} field question${pending === 1 ? '' : 's'} waiting on /decide.` : ''

  if (!last.data?.last_run_at) {
    return {
      state: 'never',
      detail:
        'The curator has never run. It walks every project and opportunity at 06:20 on ' +
        'weekdays and fills blanks from the correspondence already filed on each record. ' +
        'Check com.berwilson.cron-curator is loaded.',
    }
  }

  const failures = errored.count ?? 0
  if (failures > 0) {
    return {
      state: 'errored',
      detail:
        `${failures} record${failures === 1 ? '' : 's'} ended their last pass on an error. ` +
        `Run it by hand with ?dry=1 to see them: the cursor row carries last_error.${pendingNote}`,
    }
  }

  const hours = (Date.now() - new Date(last.data.last_run_at).getTime()) / 3_600_000
  if (hours > 96) {
    return {
      state: 'stale',
      detail:
        `No record has been considered in ${Math.round(hours / 24)} days. Weekdays at 06:20. ` +
        `A dead job here looks exactly like a quiet month in the mail, which is why this ` +
        `check is a clock rather than a count of what changed.${pendingNote}`,
    }
  }
  return {
    state: 'ok',
    detail: `Walking records on schedule.${pendingNote}`,
  }
}

/**
 * The chase pass — 05:30 weekdays, composing the follow-up for what we are owed.
 *
 * The clock is `chase_composed_at`, added 2026-10-15 for exactly this: the
 * column that existed (`chase_drafted_at`) is set only where a real Gmail draft
 * could be created, and only info@ holds a write scope, so on ~96% of the work
 * the pass left no timestamp at all and a dead cron was unobservable.
 *
 * ⚠ AND THE BACKLOG IS REPORTED BESIDE IT, NOT INSTEAD OF IT. The pass is
 * capped at 12 a run, so a growing eligible set is normal for a while and only
 * means something next to a clock that says the job is alive.
 */
export async function probeCommitmentChase(): Promise<{
  state: 'ok' | 'stale' | 'never'
  detail: string
}> {
  const db = sweepDb()

  const [last, unchased] = await Promise.all([
    db
      .from('commitments')
      .select('chase_composed_at')
      .not('chase_composed_at', 'is', null)
      .order('chase_composed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Owed TO us, still open, never chased. The pass's own eligibility adds two
    // age bars on top of this, so it is an upper bound on its queue.
    db
      .from('commitments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .eq('side', 'them')
      .is('chase_text', null),
  ])

  const queue = unchased.count ?? 0
  const queueNote = ` ${queue} open obligation${queue === 1 ? '' : 's'} owed to us carry no chase yet.`

  if (!last.data?.chase_composed_at) {
    return {
      state: 'never',
      detail:
        'No chase has ever been composed. The pass runs weekdays at 05:30 over ' +
        'obligations owed to us that are a day past due, or undated and 21 days silent. ' +
        `Check com.berwilson.cron-commitment-chase is loaded.${queueNote}`,
    }
  }

  const hours = (Date.now() - new Date(last.data.chase_composed_at).getTime()) / 3_600_000
  // Wider than the note's four days: the pass legitimately composes nothing on
  // a morning when every eligible row has already been chased once — the latch
  // is one chase per commitment, ever. Ten days of silence with a queue behind
  // it is the shape that means the job stopped.
  if (hours > 240 && queue > 0) {
    return {
      state: 'stale',
      detail:
        `No chase composed in ${Math.round(hours / 24)} days, with work waiting. ` +
        `Weekdays at 05:30, 12 a run.${queueNote}`,
    }
  }
  return {
    state: 'ok',
    detail:
      `Last chase composed ${Math.round(hours / 24)} day${Math.round(hours / 24) === 1 ? '' : 's'} ago. ` +
      `A quiet run is normal — one chase per obligation, ever.${queueNote}`,
  }
}

/** "3 hours ago" / "2 days ago". The page has its own copy for its own cards. */
function describeAge(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (!isFinite(hours)) return 'at an unknown time'
  if (hours < 1) return 'in the last hour'
  if (hours < 48) return `${Math.round(hours)} hours ago`
  return `${Math.round(hours / 24)} days ago`
}

/**
 * Pepper answering a question emailed to her.
 *
 * ⚠ WATCHED FROM THE DAY IT SHIPPED, which is the one lesson this page has
 * learned twice the hard way: the morning note went unmonitored until
 * 2026-10-08 because its check was reading the retired `task_digest`, and the
 * 06:45 text had no card at all until 10-15. A channel nobody watches fails
 * silently, and this one fails in the worst possible shape — a question
 * answered by nothing looks exactly like a question nobody asked.
 *
 * ⚠ AND IT IS DELIBERATELY NOT A CLOCK. Every other channel here is scheduled,
 * so silence means a dead job. This one only speaks when spoken to: a week with
 * no questions is the normal state of an inbox, not an outage. What CAN be
 * checked is that the machinery behind it is in place — the allowlist resolves,
 * and the sends it needs to recognise a reply are being recorded.
 */
export async function probePepperReply(): Promise<{
  state: 'ok' | 'unconfigured' | 'blind' | 'failed'
  detail: string
}> {
  const supabase = createAdminClient()

  const [callers, sentWithIds, answers, failures] = await Promise.all([
    import('@/lib/pepper/inbound').then((m) => m.pepperCallers()),
    // Notes sent in the last 7 days that carry a thread id. Without these she
    // cannot recognise a reply at all, however well everything else works.
    supabase
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'email')
      .eq('status', 'sent')
      .not('gmail_thread_id', 'is', null)
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    supabase
      .from('notification_log')
      .select('created_at')
      .eq('kind', 'pepper_answer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'pepper_answer')
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
  ])

  if (callers.error || callers.callers.length === 0) {
    return {
      state: 'unconfigured',
      detail:
        `No one is allowed to ask: the roster resolved to ${callers.callers.length} callers` +
        (callers.error ? ` (${callers.error})` : '') +
        '. The allowlist is built from active team_members with a linked contact record, ' +
        'excluding the info@ seat — so an empty list means the roster read failed, which ' +
        'fails CLOSED and answers nobody.',
    }
  }

  const withIds = sentWithIds.count ?? 0
  if (withIds === 0) {
    return {
      state: 'blind',
      detail:
        'No email Pepper sent in the last 7 days carries a Gmail thread id, so a reply to ' +
        'one cannot be recognised. Her sends record it as of 2026-10-15 — if this stays at ' +
        'zero after a morning note has gone out, `sendMail` is not returning ids ' +
        '(check that the send response body parses) and the inbound door is deaf.',
    }
  }

  const failed = failures.count ?? 0
  if (failed > 0) {
    return {
      state: 'failed',
      detail:
        `${failed} repl${failed === 1 ? 'y' : 'ies'} failed to send in the last 7 days. ` +
        'The reply goes out from the mailbox the question arrived in, which needs gmail.send ' +
        'on that mailbox — re-consent it with node scripts/setup-google-oauth.mjs --only <address>.',
    }
  }

  const everAnswered = answers.data?.created_at
  return {
    state: 'ok',
    detail:
      `${callers.callers.length} ${callers.callers.length === 1 ? 'person' : 'people'} may ask; ` +
      `${withIds} of her sends this week can be replied to. ` +
      (everAnswered
        ? `Last answered ${describeAge(everAnswered)}.`
        : 'No question asked yet — reply to any of her emails to try it. Silence here is an empty inbox, not an outage.'),
  }
}

/**
 * Are Pepper's texts actually being delivered?
 *
 * ⚠ THE RULE §12 WROTE ABOUT THIS CHANNEL IS "ASSERT DELIVERY, NOT
 * CONFIGURATION", and until 2026-10-21 nothing did. The hand-built Shortcut
 * transport failed silently for seven days while every other part of the
 * morning pass reported success, and the carrier gateway that replaced it
 * returns no receipt — so the only check that existed was Richard looking at
 * his phone, which is not a check the platform can run.
 *
 * `reportTextDelivery` is the assertion: a carrier bounce in `info@` is proof
 * of failure, and its absence across a week of sends is evidence of delivery.
 * The two are reported as different things, because they are.
 */
export async function probeTextDelivery(): Promise<{
  state: 'ok' | 'empty' | 'warn' | 'failed'
  detail: string
}> {
  try {
    const { reportTextDelivery } = await import('@/lib/notify/text-delivery')
    const reports = await reportTextDelivery()
    if (reports.length === 0) {
      return { state: 'empty', detail: 'No text targets configured (PEPPER_TEXT_TARGETS).' }
    }
    const bounced = reports.filter((r) => r.verdict === 'bounced')
    if (bounced.length > 0) {
      return {
        state: 'failed',
        detail: `The carrier is REJECTING texts to ${bounced
          .map((r) => r.handle)
          .join(', ')} — ${bounced[0].bounce}`,
      }
    }
    const unconfigured = reports.filter((r) => r.verdict === 'not_configured')
    if (unconfigured.length > 0) {
      return {
        state: 'warn',
        detail: `${unconfigured.length} of ${reports.length} targets have no carrier gateway and fall back to the Shortcut transport, which has never delivered. Set PEPPER_TEXT_GATEWAY_DOMAIN.`,
      }
    }
    const silent = reports.filter((r) => r.sent === 0)
    if (silent.length === reports.length) {
      // ⚠ A COUNT THAT HAS STOPPED GROWING IS INDISTINGUISHABLE FROM A QUIET
      // WEEK (§12), so this is a warn that names the ambiguity rather than an ok.
      return {
        state: 'warn',
        detail: 'No texts sent in the last 7 days — the channel is untested, not proven broken.',
      }
    }
    const sent = reports.reduce((n, r) => n + r.sent, 0)
    const pending = reports.filter((r) => r.verdict === 'pending' && r.sent > 0).length
    return {
      state: 'ok',
      detail:
        `${sent} texts in 7 days to ${reports.length} handle(s) over the carrier gateway, ` +
        `none rejected${pending > 0 ? ` (${pending} still inside the bounce window)` : ''}. ` +
        'Evidence of delivery — a gateway returns no receipt, so it is not proof.',
    }
  } catch (err) {
    return {
      state: 'failed',
      detail: `Could not check text delivery: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
