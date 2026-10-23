import { createAdminClient } from '@/lib/supabase/admin'
import { notifyTeam } from '@/lib/notifications'
import { jaccard, phraseTokens } from '@/lib/utils/similarity'
import { DEV_NOTE_SELECT, type DevNoteRow } from './queries'
import { devNoteKind, DEV_NOTE_KIND_LABELS, type DevNoteKind, type DevNotePriority } from '@/lib/utils/dev-notes'
import type { TablesInsert } from '@/lib/supabase/types'

/**
 * Filing a Developer Note — the ONE write path, shared by the two doors.
 *
 * ⚠ EXTRACTED FROM THE ROUTE, NOT COPIED ALONGSIDE IT. The in-app dock posts to
 * `/api/dev-notes`; Ber AI files through the `file_dev_note` agent tool, and §12
 * forbids an agent tool fetching the app's own HTTP routes. Two call sites for
 * one insert is precisely the fork this repo keeps finding days later as two
 * sibling modules neither of which looks like a copy, so the insert, the bounds,
 * the duplicate check and the announcement all live here and the route is a
 * thin caller.
 *
 * The announcement is inside this function deliberately: if the two doors
 * differ in whether anyone is TOLD, the quieter one is a silent queue — the
 * failure this table has already suffered once (see the route's own comment).
 */

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Words too generic to carry signal in a note TITLE.
 *
 * Declared here rather than in `@/lib/utils/similarity`, which says in its own
 * docblock that a tokenizer tuned to one corpus belongs next to the thing it
 * judges. `phraseTokens` is deliberately left alone: CommitmentsLedger's 0.8
 * bar was measured against its exact behaviour, and changing it would move a
 * threshold in a module that is not being worked on.
 *
 * MEASURED, not guessed: stripping these widened the gap between the one real
 * duplicate pair and the nearest unrelated pair from 0.133 to 0.153, and raised
 * the duplicate's own score from 0.300 to 0.375.
 */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'on', 'in', 'for', 'from', 'at', 'by', 'with',
  'is', 'are', 'be', 'it', 'its', 'this', 'that', 'my', 'our', 'me', 'i', 'you', 'your',
  'can', 'could', 'would', 'should', 'if', 'add', 'let', 'make', 'want', 'need', 'get',
  'give', 'put', 'show', 'use', 'new', 'please', 'every', 'all',
])

/** Signal-carrying words of a note title. */
export function titleTokens(title: string): Set<string> {
  const out = new Set<string>()
  for (const t of phraseTokens(title)) if (!TITLE_STOPWORDS.has(t)) out.add(t)
  return out
}

/**
 * At or above this title similarity, an open note MIGHT be the same ask — so
 * nothing is filed and the candidates are handed back instead.
 *
 * ⚠ 0.8 WAS THE FIRST ANSWER AND THE FIRST LIVE RUN DISPROVED IT. It was
 * borrowed from CommitmentsLedger, where 0.8 was measured — but that bar judges
 * obligation text quoted out of mail, and this judges a TITLE THE MODEL WROTE.
 * Asked the identical question in two conversations, the model titled it
 * "Weekly Slack notification of steel quotes" and "Scheduled weekly steel
 * pipeline digest to Slack": the same ask, scoring 0.375. At 0.8 the gate never
 * fired and a second row was filed. §12 — a fuzzy threshold is measured against
 * the real corpus, never chosen, and a borrowed one is still a chosen one.
 *
 * MEASURED over that pair plus six plausible unrelated titles: the duplicate
 * scores 0.375 and the closest unrelated pair 0.222, so any bar in (0.222,
 * 0.375] catches it and nothing else. 0.3 sits in the middle of that window.
 *
 * ⚠ ONE POSITIVE IS STRONG EVIDENCE ABOUT WHAT TO DROP AND WORTHLESS ABOUT
 * WHAT TO KEEP (§12), so the design does not rest on the number being right.
 * A hit is INFORMATIVE AND RECOVERABLE — the candidates come back, nothing is
 * withheld, and a caller who means it passes `allowDuplicate`. Erring loose
 * costs one extra round; erring tight costs the duplicate row this exists to
 * prevent. Re-measure once there are rows.
 */
export const DUPLICATE_BAR = 0.3

export interface FileDevNoteInput {
  kind: string
  title: string
  body?: string | null
  pagePath?: string | null
  userAgent?: string | null
  /**
   * Triage, and therefore a human act. The dock passes this only for an admin;
   * the agent never passes it at all. Everyone's bug is urgent, and a priority
   * field anyone can set stops being a triage field.
   */
  priority?: DevNotePriority
  /** The reporter is the SESSION or the asking user, never free text. */
  reporterId: string | null
  reporterName: string
  reporterEmail?: string | null
  /** File even when an open note says nearly the same thing. */
  allowDuplicate?: boolean
}

export type FileDevNoteResult =
  | { ok: true; note: DevNoteRow }
  | { ok: false; reason: 'duplicate'; candidates: { note: DevNoteRow; similarity: number }[] }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'error'; message: string }

/**
 * Open notes that say nearly the same thing as `title`, most similar first.
 *
 * Only `open` and `in_progress` are considered. A `done` note means the thing
 * was built, and a `wont_do` note means it was declined — a fresh ask about
 * either is a fresh ask, not a repeat, and must not be swallowed.
 */
export async function findSimilarOpenNotes(
  title: string,
  supabase: AdminClient,
  kind?: DevNoteKind
): Promise<{ note: DevNoteRow; similarity: number }[]> {
  let query = supabase
    .from('dev_notes')
    .select(DEV_NOTE_SELECT)
    .in('status', ['open', 'in_progress'])
  if (kind) query = query.eq('kind', kind)

  const { data, error } = await query
  // 42P01 = migration not applied. No duplicate check is the safe failure here:
  // filing a second note costs a merge, refusing to file costs the ask.
  if (error || !data) return []

  const asked = titleTokens(title)
  return (data as unknown as DevNoteRow[])
    .map((note) => ({ note, similarity: jaccard(asked, titleTokens(note.title)) }))
    .filter((c) => c.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
}

/** File a report. Returns the row, or says why it did not. */
export async function fileDevNote(
  input: FileDevNoteInput,
  supabase: AdminClient
): Promise<FileDevNoteResult> {
  const title = input.title.trim()
  if (!title) return { ok: false, reason: 'invalid', message: 'A short summary is required' }

  const kind = devNoteKind(input.kind)

  if (!input.allowDuplicate) {
    const similar = await findSimilarOpenNotes(title, supabase, kind)
    // Every candidate over the bar, not just the top one: at a loose bar more
    // than one open note can be in the running, and handing back only the best
    // would hide the rest from the one reader who can tell them apart.
    const candidates = similar.filter((c) => c.similarity >= DUPLICATE_BAR).slice(0, 5)
    if (candidates.length > 0) return { ok: false, reason: 'duplicate', candidates }
  }

  const row: TablesInsert<'dev_notes'> = {
    kind,
    title: title.slice(0, 300),
    body: input.body && input.body.trim() ? input.body.trim().slice(0, 8000) : null,
    // Context from where the reporter was standing. Both can come from a
    // browser, so both are bounded here rather than at the door.
    page_path: input.pagePath ? input.pagePath.slice(0, 500) || null : null,
    user_agent: input.userAgent ? input.userAgent.slice(0, 500) || null : null,
    reporter_id: input.reporterId,
    reporter_name: input.reporterName,
    priority: input.priority ?? 'normal',
    status: 'open',
  }

  const { data, error } = await supabase
    .from('dev_notes')
    .insert(row)
    .select(DEV_NOTE_SELECT)
    .single()

  if (error) {
    console.error('Create dev note failed:', error)
    return { ok: false, reason: 'error', message: error.message }
  }

  const note = data as unknown as DevNoteRow

  // Best-effort in the strongest sense: it must never fail the report. ⚠ And
  // the CALLER must not rely on it to tell the reporter anything — notifyTeam
  // returns 0 in silence when Chat is not configured (§12: a channel whose
  // setup is not asserted is a channel that is off, and nothing says so).
  try {
    await notifyTeam([
      {
        kind: 'dev_note',
        title: `${DEV_NOTE_KIND_LABELS[kind]} reported: ${row.title}`,
        body: row.body ? row.body.slice(0, 280) : row.page_path ? `On ${row.page_path}` : null,
        href: `/dev-notes?note=${note.id}`,
        actorName: row.reporter_name,
        actorEmail: input.reporterEmail ?? null,
      },
    ])
  } catch (err) {
    console.error('[dev-notes] notify failed:', err instanceof Error ? err.message : String(err))
  }

  return { ok: true, note }
}
