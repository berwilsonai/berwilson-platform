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
  PRIMARY_MAILBOX,
  type GoogleProbe,
} from '@/lib/integrations/google-workspace'
import { listMeetTranscripts } from '@/lib/integrations/google-drive'
import { isChatConfigured } from '@/lib/notify/chat'
import { createAdminClient } from '@/lib/supabase/admin'

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
    if (newest === 0) return { state: 'missing', detail: 'Backup directory exists but is empty.', dir }

    const ageHours = (Date.now() - newest) / 3_600_000
    if (ageHours > 30) {
      return {
        state: 'stale',
        detail: `Newest backup file is ${Math.round(ageHours / 24)}d old — the nightly backup has stopped. Check ~/Library/Logs/berwilson/backup.err.log on the Studio.`,
        newestAgeHours: ageHours,
        dir,
      }
    }
    return {
      state: 'ok',
      detail: `Newest backup ${ageHours < 1 ? 'under an hour' : `${Math.round(ageHours)}h`} old.`,
      newestAgeHours: ageHours,
      dir,
    }
  } catch {
    return {
      state: 'missing',
      detail: `Backup directory not found at ${dir}. Expected on the Studio (this warning is normal on a dev machine).`,
      dir,
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
  const folderId = process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID?.trim()
  if (!folderId) {
    return {
      state: 'unconfigured',
      detail:
        'Set GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID to a Drive folder id to index capability statements, past performance and credentials into the company knowledge base. Lead fit scores are graded against whatever is in there.',
    }
  }

  const mailbox = PRIMARY_MAILBOX
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
    const data = await googleFetch<{ files?: { name: string }[] }>(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(name)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      mailbox
    )
    const count = data.files?.length ?? 0
    if (count === 0) {
      return {
        state: 'empty',
        detail: `Folder is readable by ${mailbox} but contains no files, so the nightly sync has nothing to index. Add documents and they will be indexed on the next run (3:15am), or trigger it sooner.`,
      }
    }
    return { state: 'ok', detail: `${count} file${count === 1 ? '' : 's'} in the knowledge folder, readable by ${mailbox}.` }
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
