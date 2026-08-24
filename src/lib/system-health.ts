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
import { probeGoogleConnection, type GoogleProbe } from '@/lib/integrations/google-workspace'

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
