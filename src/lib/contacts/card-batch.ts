/**
 * A stack of business cards, read one at a time, reviewed once.
 *
 * The single scan (ScanCardButton → /api/contacts/scan-card) holds the browser
 * open for the minute or two a card takes. That is right for one card at the
 * moment of meeting someone and wrong for twelve cards off a conference table:
 * twelve times that wait, in series, with the phone screen asleep for most of
 * it.
 *
 * So a batch does what every other slow intake here does. It stages one
 * `email_intake_sessions` row (`intake_kind = 'cards'`), returns immediately,
 * and works through the stack in the background, writing the row back after
 * EVERY card. Three consequences, all of them the point:
 *   - progress is real ("4 of 12 read"), not a spinner;
 *   - `updated_at` moves each time, so the stale-`running` guard cannot trip
 *     on a long batch that is in fact healthy;
 *   - a batch interrupted by a deploy still hands over the cards it finished,
 *     and the rest can be resumed — the recognized TEXT is stored, so resuming
 *     costs no re-photography.
 *
 * Cards are processed strictly in series because LM Studio serves one request
 * at a time (§12); overlapping them would only queue them somewhere less
 * visible. Company research is cached across the stack, which is what actually
 * makes a batch cheaper than the same cards scanned one by one — three people
 * from one firm is one lookup.
 *
 * NOTHING here writes a contact. It stages; a human confirms. Same invariant as
 * the mail pipeline, for the same reason: OCR misreads, and a fit assessment is
 * a judgement somebody signs.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { buildCardDraft, type CardScanDraft, type ResearchCache } from '@/lib/contacts/card-intake'
import type { Json, TablesUpdate } from '@/lib/supabase/types'

/** The most cards one batch will read — roughly a conference's worth. */
export const MAX_CARDS_PER_BATCH = 30

export type CardItemState = 'queued' | 'reading' | 'ready' | 'failed'

export interface CardBatchItem {
  /** Stable key for the review UI; not a database id. */
  ref: string
  /** The photo's filename, so a row can be tied back to the picture taken. */
  file_name: string | null
  raw_text: string
  state: CardItemState
  draft: CardScanDraft | null
  error: string | null
}

export interface CardBatchDraft {
  items: CardBatchItem[]
  /** Set only when the whole run fell over, matching the other intake kinds. */
  error?: string
  stats: {
    total: number
    ready: number
    failed: number
    /** Companies looked up once and reused — the batch's own saving. */
    research_reused: number
  }
}

export function emptyCardBatch(
  cards: Array<{ raw_text: string; file_name?: string | null }>
): CardBatchDraft {
  return {
    items: cards.map((c, i) => ({
      ref: `card-${i + 1}`,
      file_name: c.file_name?.trim() || null,
      raw_text: c.raw_text,
      state: 'queued',
      draft: null,
      error: null,
    })),
    stats: { total: cards.length, ready: 0, failed: 0, research_reused: 0 },
  }
}

/** Tolerant read — extraction_result is jsonb and predates the generated types. */
export function readCardBatch(raw: unknown): CardBatchDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<CardBatchDraft>
  if (!Array.isArray(o.items)) return null
  return {
    items: o.items,
    error: typeof o.error === 'string' ? o.error : undefined,
    stats: o.stats ?? { total: o.items.length, ready: 0, failed: 0, research_reused: 0 },
  }
}

function recount(draft: CardBatchDraft): CardBatchDraft {
  return {
    ...draft,
    stats: {
      ...draft.stats,
      total: draft.items.length,
      ready: draft.items.filter((i) => i.state === 'ready').length,
      failed: draft.items.filter((i) => i.state === 'failed').length,
    },
  }
}

/** A label that says what the stack was without anyone having to name it. */
export function describeBatch(draft: CardBatchDraft): string {
  const named = draft.items
    .map((i) => i.draft?.full_name ?? i.draft?.company)
    .filter((n): n is string => Boolean(n))
  if (named.length === 0) return `${draft.items.length} business card${draft.items.length === 1 ? '' : 's'}`
  if (named.length === 1) return named[0]
  return `${named[0]} + ${draft.items.length - 1} more`
}

/**
 * Work through every card still queued, writing progress back after each one.
 *
 * Never throws for a single bad card — that row is marked `failed` with its
 * message and the stack carries on, because eleven good contacts should not be
 * lost to one unreadable photo. Only a failure to reach the database ends the
 * run, and that is recorded on the session too.
 */
export async function processCardBatch(sessionId: string, userId: string): Promise<void> {
  const admin = createAdminClient()

  const { data: session } = await admin
    .from('email_intake_sessions')
    .select('extraction_result')
    .eq('id', sessionId)
    .single()

  let draft = readCardBatch(session?.extraction_result)
  if (!draft) {
    console.error('[card-batch] no batch draft on session', sessionId)
    return
  }

  const cache: ResearchCache = new Map()
  const companiesSeen = new Set<string>()
  let reused = 0

  const save = async (status?: 'pending' | 'failed') => {
    const patch: TablesUpdate<'email_intake_sessions'> = {
      extraction_result: recount(draft!) as unknown as Json,
    }
    if (status) patch.status = status
    const { error } = await admin.from('email_intake_sessions').update(patch).eq('id', sessionId)
    if (error) throw new Error(error.message)
  }

  try {
    for (let i = 0; i < draft.items.length; i++) {
      const item = draft.items[i]
      if (item.state === 'ready') continue

      draft.items[i] = { ...item, state: 'reading', error: null }
      await save()

      try {
        const built = await buildCardDraft(item.raw_text, userId, { researchCache: cache })
        // A firm already looked up for an earlier card in this stack is one the
        // batch did not pay for twice — the whole reason to scan them together.
        if (built.company) {
          const key = built.company.toLowerCase()
          if (companiesSeen.has(key)) reused++
          else companiesSeen.add(key)
        }
        draft.items[i] = { ...draft.items[i], state: 'ready', draft: built, error: null }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not read this card.'
        console.error(`[card-batch] card ${item.ref} failed:`, message)
        draft.items[i] = { ...draft.items[i], state: 'failed', draft: null, error: message }
      }
      draft = { ...draft, stats: { ...draft.stats, research_reused: reused } }
      await save()
    }

    await save('pending')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The batch failed unexpectedly.'
    console.error('[card-batch] run failed:', err)
    draft.error = message
    // Best effort: if the database is what broke, this will not land either, and
    // the stale-`running` guard is what the reader ends up seeing.
    await admin
      .from('email_intake_sessions')
      .update({ status: 'failed', extraction_result: recount(draft) as unknown as Json })
      .eq('id', sessionId)
      .then(undefined, () => {})
  }
}
