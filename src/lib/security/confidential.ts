/**
 * Confidential projects — containment, and the step-up sessions that open them.
 *
 * TWO DIFFERENT QUESTIONS, and conflating them is how this kind of feature
 * leaks:
 *
 *   "Is this project confidential?"      → confidentialProjectIds()
 *   "May THIS VIEWER see it right now?"  → hiddenProjectIds(authUserId)
 *
 * Containment (the first) is absolute and applies to everyone including both
 * admins: a confidential project never reaches a cross-portfolio list, a
 * portfolio-wide retrieval, a brief that gets emailed, a Drive file that gets
 * shared, or Pepper's morning note. None of those can be stepped up, because
 * an email has already left the lock behind by the time anyone reads it.
 *
 * Access (the second) is per-user and short-lived: clearing a TOTP challenge
 * writes a step_up_sessions row, and the project's own pages open for as long
 * as it lives.
 *
 * ⚠ THIS MODULE MUST NOT IMPORT next/headers. Crons (the brief, Pepper's note,
 * the digests, drive-publish) are the single most important callers — an email
 * is the one surface a lock cannot reach after the fact — and they run with no
 * request and no cookies. The viewer-aware wrappers live in ./request.ts, which
 * is the only file that resolves a signed-in user.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * How long a cleared TOTP keeps a project open. ABSOLUTE, never sliding — a
 * sliding window means a tab left open on a desk stays unlocked all day, which
 * is the exact threat step-up exists to answer.
 */
export const STEP_UP_TTL_MS = 30 * 60 * 1000

/**
 * Untyped service-role client for step_up_sessions.
 *
 * `npm run gen-types` is a disabled stub (CLAUDE.md §4), so the generated
 * Database type has never seen this table. Rather than scatter `as never`
 * casts, this follows the sweepDb() convention: one deliberately untyped
 * client, with the row shape carried by the interface below.
 */
function securityDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export interface StepUpSessionRow {
  id: string
  auth_user_id: string
  project_id: string
  factor_id: string | null
  expires_at: string
  created_at: string | null
  ip: string | null
  user_agent: string | null
}

/**
 * Every project flagged confidential.
 *
 * Deliberately NOT memoised. The set is small (an indexed partial-index read
 * over a 14-row table), it is read a handful of times per request at worst, and
 * a cache here means a project marked confidential at 10:00 is still answering
 * portfolio questions at 10:05. Correctness beats a saved query.
 *
 * FAILS CLOSED. A transient database error returns null, and every caller
 * treats null as "assume everything is confidential" rather than "nothing is" —
 * the opposite choice turns one bad read into a full disclosure.
 */
export async function confidentialProjectIds(): Promise<string[] | null> {
  const { data, error } = await createAdminClient()
    .from('projects')
    .select('id')
    .eq('confidential', true)
  if (error) {
    console.error('[confidential] could not read the confidential set:', error.message)
    return null
  }
  return (data ?? []).map((r) => r.id)
}

/** Is this one project confidential? Fails closed (true) on a read error. */
export async function isConfidentialProject(projectId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('projects')
    .select('confidential')
    .eq('id', projectId)
    .maybeSingle()
  if (error) {
    console.error('[confidential] could not read project', projectId, error.message)
    return true
  }
  return data?.confidential === true
}

/** Project ids this user currently holds a live step-up for. */
export async function liveStepUpProjectIds(authUserId: string): Promise<string[]> {
  const { data, error } = await securityDb()
    .from('step_up_sessions')
    .select('project_id')
    .eq('auth_user_id', authUserId)
    .gt('expires_at', new Date().toISOString())
  if (error) {
    console.error('[confidential] could not read step-up sessions:', error.message)
    return []
  }
  return (data ?? []).map((r) => (r as { project_id: string }).project_id)
}

/**
 * THE function every reader should call: project ids to hide from this caller.
 *
 * `authUserId` null — which is what every cron and background job passes —
 * means no step-up is possible, so the answer is every confidential project.
 * That is the correct default and the reason the parameter is explicit rather
 * than resolved inside: a job that forgets to pass a user gets the SAFE
 * behaviour, not the open one.
 */
export async function hiddenProjectIds(authUserId?: string | null): Promise<Set<string>> {
  const confidential = await confidentialProjectIds()
  if (confidential === null) return allProjectIds()
  if (confidential.length === 0) return new Set()
  if (!authUserId) return new Set(confidential)
  const unlocked = new Set(await liveStepUpProjectIds(authUserId))
  return new Set(confidential.filter((id) => !unlocked.has(id)))
}

/**
 * Every project id — the fail-closed answer when the confidential set could
 * not be read. A real enumeration rather than a sentinel: a Set that lies about
 * its own `size` is a trap for the next reader who writes `if (hidden.size)`.
 *
 * If THIS read fails too, the database is not answering at all — and whatever
 * list the caller was about to filter came from the same database and is empty
 * for the same reason, so there is nothing left to withhold.
 */
async function allProjectIds(): Promise<Set<string>> {
  const { data, error } = await createAdminClient().from('projects').select('id')
  if (error) {
    console.error('[confidential] database unreachable while failing closed:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.id))
}

/** Does this user hold a live step-up for this project? */
export async function hasStepUp(authUserId: string, projectId: string): Promise<boolean> {
  const { data, error } = await securityDb()
    .from('step_up_sessions')
    .select('id')
    .eq('auth_user_id', authUserId)
    .eq('project_id', projectId)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
  if (error) {
    console.error('[confidential] step-up lookup failed:', error.message)
    return false
  }
  return (data ?? []).length > 0
}

export interface RecordStepUpInput {
  authUserId: string
  projectId: string
  factorId?: string | null
  ip?: string | null
  userAgent?: string | null
}

/** Open a project for STEP_UP_TTL_MS. Called only after a verified TOTP. */
export async function recordStepUp(input: RecordStepUpInput): Promise<string | null> {
  const expiresAt = new Date(Date.now() + STEP_UP_TTL_MS).toISOString()
  const { data, error } = await securityDb()
    .from('step_up_sessions')
    .insert({
      auth_user_id: input.authUserId,
      project_id: input.projectId,
      factor_id: input.factorId ?? null,
      expires_at: expiresAt,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single()
  if (error) {
    console.error('[confidential] could not record step-up:', error.message)
    return null
  }
  return (data as { id: string }).id
}

/**
 * Close sessions. No arguments closes every open session on the platform,
 * which is the whole reason this is a table and not a cookie.
 */
export async function clearStepUps(opts?: {
  authUserId?: string
  projectId?: string
}): Promise<number> {
  let q = securityDb().from('step_up_sessions').delete()
  if (opts?.authUserId) q = q.eq('auth_user_id', opts.authUserId)
  if (opts?.projectId) q = q.eq('project_id', opts.projectId)
  // A delete with no filter is rejected by PostgREST unless something is
  // matched, so bound it on a column every row has.
  if (!opts?.authUserId && !opts?.projectId) q = q.not('id', 'is', null)
  const { data, error } = await q.select('id')
  if (error) {
    console.error('[confidential] could not clear step-ups:', error.message)
    return 0
  }
  return (data ?? []).length
}

/**
 * Drop rows belonging to a hidden project.
 *
 * In memory on purpose. A PostgREST `not.in` needs a bracketed list built by
 * hand, is a syntax error when the list is empty, and §12 is a catalogue of
 * filters that silently matched nothing. These lists are small; a `.filter()`
 * cannot misparse a comma.
 */
export function dropHidden<T>(
  rows: readonly T[],
  projectIdOf: (row: T) => string | null | undefined,
  hidden: Set<string>
): T[] {
  if (hidden.size === 0) return [...rows]
  return rows.filter((row) => {
    const id = projectIdOf(row)
    return !id || !hidden.has(id)
  })
}

/**
 * A bracketed id list for a PostgREST `.not('id', 'in', …)`, or null when
 * there is nothing to exclude (the caller must then skip the filter — an empty
 * `in ()` is a syntax error, not a no-op).
 *
 * Only for selects too large to filter in memory. Ids are uuids straight out of
 * the database, so there is nothing here a comma can break (§12) — but keep it
 * that way: never pass a user-supplied string through this.
 */
export function notInList(ids: Iterable<string>): string | null {
  const list = [...ids]
  if (list.length === 0) return null
  return `(${list.join(',')})`
}

/**
 * Recursively remove anything belonging to a hidden project from a value that
 * is about to be handed to the model.
 *
 * The agent has 42 tools and a dozen separate reads of `projects`, in a dozen
 * result shapes. Filtering each one by hand is twelve chances to miss one, and a
 * missed one is a protected project quoted into a chat transcript that persists
 * to agent_messages — with nothing reporting it. So the filter runs once, over
 * the RESULT, keyed on the thing every one of those shapes has in common: a
 * column whose name ends in `project_id`, or the project's own `id`.
 *
 * Returns the scrubbed value and a count of what was dropped, because the count
 * has to reach the model. An agent that answers "Ber Wilson has 13 projects"
 * from a list silently trimmed from 14 is confidently wrong, which is worse than
 * one that says some are protected.
 */
export function scrubHiddenProjects<T>(
  value: T,
  hidden: Set<string>
): { value: T; removed: number } {
  if (hidden.size === 0) return { value, removed: 0 }
  let removed = 0

  const refersToHidden = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
      if (typeof raw !== 'string') continue
      if (key === 'id' || key === 'project_id' || key.endsWith('_project_id')) {
        if (hidden.has(raw)) return true
      }
    }
    return false
  }

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const kept: unknown[] = []
      for (const item of node) {
        if (refersToHidden(item)) {
          removed++
          continue
        }
        kept.push(walk(item))
      }
      return kept
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
        // A nested OBJECT that refers to a hidden project becomes null rather
        // than disappearing: dropping the key would leave the parent looking
        // complete with a field the model then treats as absent.
        if (refersToHidden(raw)) {
          removed++
          out[key] = null
          continue
        }
        out[key] = walk(raw)
      }
      return out
    }
    return node
  }

  return { value: walk(value) as T, removed }
}
