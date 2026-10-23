/**
 * What Pepper changed, and what she is asking about.
 *
 * ⚠ THE GUARDED TIER WROTE INTO A VOID, AND THE MORNING NOTE NEVER MENTIONED
 * ANY OF IT. Three separate headers — `cron/curator/route.ts`,
 * `provenance/fields.ts` and `provenance/write.ts` — all argue that what makes
 * unattended writing safe is that every change is REPORTED, and the route's own
 * comment says the run "RETURNS what it changed, which the morning note reads
 * out". It did not: `grep -rin 'curat|provenance' src/lib/pepper/` was empty,
 * and `field_update_proposals` had no reader anywhere in the codebase outside
 * its own writer. So a guarded field — money, ownership, a legally effective
 * date, the things the registry protects precisely because being wrong costs
 * something — raised a question that accumulated as a pending row with no
 * screen, no note line and no door.
 *
 * Richard's 10-12 direction traded the approval gate for legibility. This is
 * the legible half.
 */

import { provDb } from './db'
import { fieldSpec } from './fields'

export interface CuratedChange {
  table: string
  recordId: string
  /** The record's own name, resolved for the reader. */
  recordLabel: string
  /** The field as a human reads it, from the registry — never the column name. */
  fieldLabel: string
  from: string | null
  to: string | null
  evidence: string | null
  at: string | null
}

export interface OpenProposal {
  id: string
  table: string
  recordId: string
  recordLabel: string
  fieldLabel: string
  current: string | null
  proposed: string | null
  evidence: string | null
  at: string | null
}

/** Which table a record label comes from. Only the tables the registry writes. */
const LABEL_COLUMN: Record<string, string> = {
  projects: 'name',
  opportunities: 'name',
  parties: 'full_name',
  milestones: 'label',
}

/**
 * Resolve record names, one batched read per table.
 *
 * ⚠ CHUNKED. §12: `.in()` with 1000 uuids is a 37KB GET and Kong refuses it
 * with `URI too long` — and a refused read here would render every change
 * against a blank record name, which reads as a failed render rather than as
 * an error.
 */
const ID_CHUNK = 200

async function resolveLabels(
  byTable: Map<string, Set<string>>
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const [table, ids] of byTable) {
    const column = LABEL_COLUMN[table]
    if (!column) continue
    const list = [...ids]
    for (let i = 0; i < list.length; i += ID_CHUNK) {
      const { data } = await provDb()
        .from(table)
        .select(`id, ${column}`)
        .in('id', list.slice(i, i + ID_CHUNK))
      // Cast through `unknown`: the select string is built at runtime, so the
      // client's literal-type parser cannot read it and infers a ParserError.
      for (const row of ((data ?? []) as unknown) as Record<string, unknown>[]) {
        const id = String(row.id)
        const label = row[column]
        if (typeof label === 'string' && label) out.set(`${table}:${id}`, label)
      }
    }
  }
  return out
}

/** The field as a human reads it. Falls back to the column, never to blank. */
function labelFor(table: string, field: string): string {
  return fieldSpec(table, field)?.label ?? field
}

/**
 * Everything Pepper wrote since a moment, newest first.
 *
 * Read off `record_field_provenance` rather than `activity_log`, because
 * `opportunities` and `parties` carry no audit trigger — 17 live writes on
 * 10-12 left exactly ONE activity row, which is why `previous_value` lives on
 * the provenance row in the first place.
 */
export async function readPepperChanges(
  sinceIso: string,
  limit = 40
): Promise<{ changes: CuratedChange[]; error: string | null }> {
  const { data, error } = await provDb()
    .from('record_field_provenance')
    .select('table_name, record_id, field_key, previous_value, evidence, as_of, updated_at')
    .eq('written_by', 'pepper')
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) return { changes: [], error: error.message }

  const rows = (data ?? []) as {
    table_name: string
    record_id: string
    field_key: string
    previous_value: string | null
    evidence: string | null
    as_of: string | null
    updated_at: string | null
  }[]
  if (rows.length === 0) return { changes: [], error: null }

  // The provenance row carries what the value WAS, not what it is — the record
  // itself is the only place the new value lives, so it is read back per table.
  const byTable = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set())
    byTable.get(r.table_name)!.add(r.record_id)
  }
  const labels = await resolveLabels(byTable)
  const current = await resolveCurrentValues(rows)

  return {
    changes: rows.map((r) => ({
      table: r.table_name,
      recordId: r.record_id,
      recordLabel: labels.get(`${r.table_name}:${r.record_id}`) ?? '(record not found)',
      fieldLabel: labelFor(r.table_name, r.field_key),
      from: r.previous_value,
      to: current.get(`${r.table_name}:${r.record_id}:${r.field_key}`) ?? null,
      evidence: r.evidence,
      at: r.updated_at ?? r.as_of,
    })),
    error: null,
  }
}

/** The value as it stands now, for each (record, field) that changed. */
async function resolveCurrentValues(
  rows: { table_name: string; record_id: string; field_key: string }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  // Grouped by table AND by the set of fields wanted, so one read per table
  // rather than one per row.
  const byTable = new Map<string, { ids: Set<string>; fields: Set<string> }>()
  for (const r of rows) {
    let entry = byTable.get(r.table_name)
    if (!entry) {
      entry = { ids: new Set(), fields: new Set() }
      byTable.set(r.table_name, entry)
    }
    entry.ids.add(r.record_id)
    entry.fields.add(r.field_key)
  }

  for (const [table, { ids, fields }] of byTable) {
    const list = [...ids]
    const select = ['id', ...fields].join(', ')
    for (let i = 0; i < list.length; i += ID_CHUNK) {
      const { data } = await provDb()
        .from(table)
        .select(select)
        .in('id', list.slice(i, i + ID_CHUNK))
      for (const row of ((data ?? []) as unknown) as Record<string, unknown>[]) {
        const id = String(row.id)
        for (const field of fields) {
          const v = row[field]
          if (v === null || v === undefined) continue
          out.set(`${table}:${id}:${field}`, String(v))
        }
      }
    }
  }
  return out
}

/**
 * The questions waiting on a human — a guarded field she will not overwrite.
 *
 * ⚠ ONE CARD PER QUESTION, NOT ONE PER RUN. The writer upserts on
 * (table, record, field), so re-asking updates the card rather than stacking a
 * new one. That is what makes this list short enough to put in a note.
 */
export async function readOpenProposals(
  limit = 25
): Promise<{ proposals: OpenProposal[]; total: number; error: string | null }> {
  const [list, count] = await Promise.all([
    provDb()
      .from('field_update_proposals')
      .select('id, table_name, record_id, field_key, record_label, current_value, proposed_value, evidence, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(limit),
    provDb()
      .from('field_update_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])

  if (list.error) return { proposals: [], total: 0, error: list.error.message }

  const rows = (list.data ?? []) as {
    id: string
    table_name: string
    record_id: string
    field_key: string
    record_label: string | null
    current_value: string | null
    proposed_value: string | null
    evidence: string | null
    created_at: string | null
  }[]

  return {
    proposals: rows.map((r) => ({
      id: r.id,
      table: r.table_name,
      recordId: r.record_id,
      recordLabel: r.record_label ?? '(unnamed record)',
      fieldLabel: labelFor(r.table_name, r.field_key),
      current: r.current_value,
      proposed: r.proposed_value,
      evidence: r.evidence,
      at: r.created_at,
    })),
    // ⚠ THE TRUE TOTAL, NOT `rows.length`. §12: a subject line reading "15" over
    // a ledger of 19 is a small lie told every morning — the same applies to a
    // capped list that presents itself as the whole queue.
    total: count.count ?? rows.length,
    error: null,
  }
}
