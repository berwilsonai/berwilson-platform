/**
 * Dismissing an attention item — the mark, and the two readers that respect it.
 *
 * ⚠ WHY A ROW AND NOT A PIECE OF COMPONENT STATE. `computeAttention()` rebuilds
 * all ten kinds from live records on every call, so there is nothing to tick: a
 * dismissal held in React state dies on the next navigation, one in the URL dies
 * when the link is not shared, and one in `localStorage` would be the only copy
 * the page can see (§12) AND invisible to the three readers that matter most —
 * the dashboard rail, the sidebar badge and Pepper's 06:50 note, which is where
 * these items are actually read. §12's harder version of the same rule: an
 * automatic pass and the undo for it are a LOOP unless the undo leaves a mark
 * the pass respects. The mark is `attention_dismissals`; see the migration.
 *
 * ⚠ AND IT IS APPLIED AT THE CHOKE POINT, NOT BY EACH CALLER. §12: a filter
 * belongs at the choke point as a DEFAULT, not as a parameter every caller
 * passes — forgetting to opt in is how `/attention`, the rail, the badge, the
 * agent tool and the morning note would come to disagree about one list. So
 * `computeAttention()` filters beside its `dropHidden()` call and
 * `countAttention()` filters in SQL, and nothing else has to know.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { ATTENTION_DISMISS_DAYS, attentionRowId, type AttentionCategory } from '@/lib/attention-kinds'

export interface AttentionDismissal {
  item_key: string
  category: string
  title: string
  project_name: string | null
  project_id: string | null
  dismissed_until: string
  dismissed_by: string | null
  created_at: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** The date a dismissal made now should lapse on. */
export function dismissUntil(days: number = ATTENTION_DISMISS_DAYS): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Every dismissal still in force, newest first.
 *
 * ⚠ `gte` ON TODAY, NOT `gt`. A dismissal taken out today with
 * `dismissed_until = today` would otherwise never suppress anything — the row
 * would be written and the item would stay on screen, which reads as the button
 * being broken. The commitments snooze uses `gt` because its dates are always
 * in the future; this one is handed a day count that could be 0.
 *
 * Fails OPEN on a read error and says so: a transient Postgres hiccup should
 * show you too much work rather than silently hide it.
 */
export async function activeDismissals(): Promise<AttentionDismissal[]> {
  const { data, error } = await createAdminClient()
    .from('attention_dismissals')
    .select('item_key, category, title, project_name, project_id, dismissed_until, dismissed_by, created_at')
    .gte('dismissed_until', today())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[attention] could not read dismissals, showing everything:', error.message)
    return []
  }
  return (data ?? []) as unknown as AttentionDismissal[]
}

/**
 * The dismissed row ids per source table, for a reader that cannot filter rows.
 *
 * ⚠ A COUNT IS AN AGGREGATE AND A ROW-FILTER HAS NO EQUIVALENT ON ONE (§12).
 * `countAttention()` is four `head: true` counts and never receives a row, so
 * there is nothing for a `.filter()` in JavaScript to run against — the badge
 * would keep counting a dismissed overdue task while the list it badges no
 * longer showed it, which is the exact shape of the bug that put 1, 99+ and 197
 * on one screen. The ids have to go into SQL, so they are collected here.
 *
 * Keys with no row behind them (`waiting-…`, `decision-…`) are dropped by
 * `attentionRowId()` rather than guessed at.
 */
export function dismissedRowIds(dismissals: AttentionDismissal[]): Map<string, string[]> {
  const byTable = new Map<string, string[]>()
  for (const d of dismissals) {
    const row = attentionRowId(d.item_key)
    if (!row) continue
    const ids = byTable.get(row.table)
    if (ids) ids.push(row.rowId)
    else byTable.set(row.table, [row.rowId])
  }
  return byTable
}

/**
 * Exclude a table's dismissed rows from a head count, in SQL.
 *
 * ⚠ THE URL CAP, NOT THE ROW CAP (§12). A filter rides in the query string, so
 * a thousand uuids is a 37KB GET that Kong refuses with `URI too long`. Two
 * people dismissing items will never approach that, but a count that silently
 * stopped filtering would be invisible — so past the cap this returns the query
 * UNFILTERED and says so in the log, which reads the badge high rather than
 * wrong. `id` is a primary key and never null, so a plain `not.in` is right
 * here and the `or(is.null,…)` dance that nullable pointers need does not apply.
 */
const MAX_FILTER_IDS = 200

export function excludeDismissed<T extends { not: (col: string, op: string, value: string) => T }>(
  query: T,
  byTable: Map<string, string[]>,
  table: string
): T {
  const ids = byTable.get(table)
  if (!ids || ids.length === 0) return query
  if (ids.length > MAX_FILTER_IDS) {
    console.warn(`[attention] ${ids.length} dismissed ${table} rows exceeds the URL cap; badge not filtered`)
    return query
  }
  return query.not('id', 'in', `(${ids.join(',')})`)
}

/**
 * Push an item out of sight for a while.
 *
 * An upsert on `item_key`, so dismissing the same row twice EXTENDS the quiet
 * rather than failing on the unique index or stacking duplicate rows.
 *
 * The title and project name are a SNAPSHOT, never authoritative: by the time
 * anyone reads this row the live item is gone from the engine's output — that is
 * what the dismissal does — so the Dismissed view has nothing else to render.
 */
export async function dismissAttentionItem(input: {
  itemKey: string
  category: AttentionCategory
  title: string
  projectName: string | null
  projectId: string | null
  days?: number
  actor: string | null
}): Promise<{ dismissedUntil: string }> {
  const dismissedUntil = dismissUntil(input.days)
  const { error } = await createAdminClient()
    .from('attention_dismissals')
    .upsert(
      {
        item_key: input.itemKey,
        category: input.category,
        title: input.title.slice(0, 500),
        project_name: input.projectName,
        project_id: input.projectId,
        dismissed_until: dismissedUntil,
        dismissed_by: input.actor,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'item_key' }
    )
  if (error) throw new Error(error.message)
  return { dismissedUntil }
}

/**
 * Put it back — the undo, and the only way one exists.
 *
 * Deleting the mark is the restore: the engine recomputes the item from its
 * live source on the next read, so nothing has to be reconstructed and nothing
 * can come back stale. Idempotent, because the Undo toast and the Restore
 * button on the Dismissed view can both reach the same key.
 */
export async function restoreAttentionItem(itemKey: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('attention_dismissals')
    .delete()
    .eq('item_key', itemKey)
  if (error) throw new Error(error.message)
}
