/**
 * The one way an autonomous pass changes a record.
 *
 * ⚠ EVERY UNATTENDED WRITE IN THE PLATFORM GOES THROUGH HERE. Richard removed
 * the approval gate on 2026-10-12; what replaces it is not trust, it is three
 * properties this function guarantees and no caller can opt out of:
 *
 *   ATTRIBUTABLE — the write carries Pepper's actor, so `log_activity()` records
 *     who did it and `field_changes` records the before value. A hard DELETE is
 *     recoverable from the log (§4) and so is any field she rewrites.
 *   BOUNDED — only fields in the registry, and `canWrite` decides each one. A
 *     model cannot name a column and have it written.
 *   LEGIBLE — the return value is the morning note's raw material. A change
 *     nobody is told about is the failure mode this design must not have, which
 *     is why `written` is returned per field with its before value, not counted.
 *
 * ⚠ IT READS BEFORE IT WRITES, ALWAYS. §12: a pass that reports what it did
 * must read first or it claims work it did not do — the separation pass
 * announced "org chart marked departed" having changed nothing. `written` here
 * is only ever fields whose stored value actually differed.
 */

import { canWrite, fieldSpec, isBlank } from './fields'
import {
  PEPPER_ACTOR,
  provDb,
  provDbAs,
  type FieldProvenanceRow,
  type SourceKind,
  type WrittenBy,
} from './db'

export interface FieldUpdate {
  field: string
  value: unknown
  /** ⚠ The sentence she read it in. Carried to the proposal card and the log. */
  evidence?: string | null
  confidence?: number | null
  sourceKind: SourceKind
  sourceRef?: string | null
  /** When the SOURCE is from. Not when this ran. */
  asOf?: string | null
  /**
   * Fill a blank, but never replace a value — whatever the field's tier.
   *
   * ⚠ THIS EXISTS BECAUSE THE FIRST DRY RUN WAS DESTRUCTIVE, AND THE RULE IT
   * ENCODES IS WORTH MORE THAN THE FLAG. Measured 2026-10-12 across the live
   * portfolio: folding thread summaries onto deal records with newest-wins
   * turned `215 S Front St, Steelton, Dauphin County, PA` into `Steelton`,
   * turned Riverdale's and Weirton's own addresses into `Steelton, Riverdale,
   * Weirton` (one thread covers all three Cleveland-Cliffs sites and is linked
   * to each), and reclassified four projects' sectors from a human's
   * considered `infrastructure`/`government` to a per-thread guess.
   *
   * THE ASYMMETRY IS THE POINT: evidence that DESCRIBES the subject of a field
   * may overwrite it; evidence that merely MENTIONS the subject may only fill
   * it. A person in a thread's `people[]` is described — their title comes off
   * their own signature block, so newest wins is right. A deal's location in a
   * thread about three deals is incidental, and no amount of recency makes it
   * authoritative. Tier answers "whose value is this"; this answers "does this
   * source actually know".
   */
  fillOnly?: boolean
}

export interface AppliedField {
  field: string
  label: string
  from: string | null
  to: string | null
  reason: string
}

export interface ApplyResult {
  written: AppliedField[]
  proposed: AppliedField[]
  skipped: { field: string; reason: string }[]
  /** Stated, never swallowed into an empty result (§12). */
  error: string | null
}

const EMPTY: ApplyResult = { written: [], proposed: [], skipped: [], error: null }

/**
 * Apply what she learned to one record.
 *
 * `table` and every `field` must appear in the registry or they are skipped
 * with a reason — this never throws on an unknown field, because a model
 * inventing a column name is an expected input, not an exception.
 */
export async function applyFieldUpdates(args: {
  table: string
  recordId: string
  recordLabel?: string | null
  updates: FieldUpdate[]
  /** Plan only: decide everything, write nothing. Used by the dry run. */
  dryRun?: boolean
}): Promise<ApplyResult> {
  const { table, recordId, recordLabel = null, updates, dryRun = false } = args
  if (updates.length === 0) return { ...EMPTY }

  // Only fields the registry knows, deduped to the LAST mention — a pass that
  // reads two sources may propose the same field twice, and the later source is
  // the one `asOf` ordering has already put last.
  const wanted = new Map<string, FieldUpdate>()
  const skipped: { field: string; reason: string }[] = []
  for (const u of updates) {
    if (!fieldSpec(table, u.field)) {
      skipped.push({ field: u.field, reason: `${table}.${u.field} is not writable` })
      continue
    }
    wanted.set(u.field, u)
  }
  if (wanted.size === 0) return { ...EMPTY, skipped }

  const fields = [...wanted.keys()]

  // ── Read the current row and the provenance for exactly these fields ───────
  const [rowRes, provRes] = await Promise.all([
    provDb().from(table).select(['id', ...fields].join(',')).eq('id', recordId).maybeSingle(),
    provDb()
      .from('record_field_provenance')
      .select('*')
      .eq('table_name', table)
      .eq('record_id', recordId)
      .in('field_key', fields),
  ])

  if (rowRes.error) return { ...EMPTY, skipped, error: `read ${table}: ${rowRes.error.message}` }
  if (!rowRes.data) return { ...EMPTY, skipped, error: `${table} ${recordId} not found` }
  // ⚠ Check error on every select. §12: a zero from a broken query and a zero
  // from an empty table are the same number on screen — and here a failed
  // provenance read would look like "no provenance", which `canWrite` reads as
  // human and would turn every write into a proposal. Silent, and wrong.
  if (provRes.error) {
    return { ...EMPTY, skipped, error: `read provenance: ${provRes.error.message}` }
  }

  // Through `unknown`: the untyped client cannot infer a select list built at
  // runtime, so it widens the row to a string-error union. The cast is the
  // documented escape for a dynamic select (§4 forbids `as never`, not this).
  const current = rowRes.data as unknown as Record<string, unknown>
  const provenance = new Map<string, WrittenBy>(
    ((provRes.data ?? []) as FieldProvenanceRow[]).map((p) => [p.field_key, p.written_by])
  )

  // ── Decide ────────────────────────────────────────────────────────────────
  const toWrite: Record<string, unknown> = {}
  const written: AppliedField[] = []
  const proposed: AppliedField[] = []

  for (const field of fields) {
    const u = wanted.get(field)!
    const spec = fieldSpec(table, field)!
    let decision = canWrite({
      table,
      field,
      currentValue: current[field],
      proposedValue: u.value,
      writtenBy: provenance.get(field) ?? null,
    })
    // Applied AFTER canWrite so the enum and no-op checks still run first, and
    // so a fill-only update to a populated field is reported as skipped rather
    // than queued as a question nobody asked for.
    if (u.fillOnly && decision.action !== 'skip' && !isBlank(current[field])) {
      decision = {
        action: 'skip',
        reason: 'fill-only: the record already has a value and this source only mentions it',
      }
    }
    const entry: AppliedField = {
      field,
      label: spec.label,
      from: asText(current[field]),
      to: asText(u.value),
      reason: decision.reason,
    }
    if (decision.action === 'write') {
      // ⚠ ONLY the fields that changed go in the payload. §12: a field the
      // caller never mentioned must be OMITTED, not nulled — an explicit NULL
      // does not fall back to the column DEFAULT, it violates NOT NULL.
      toWrite[field] = u.value
      written.push(entry)
    } else if (decision.action === 'propose') {
      proposed.push(entry)
    } else {
      skipped.push({ field, reason: decision.reason })
    }
  }

  if (dryRun) return { written, proposed, skipped, error: null }

  // ── Write, as Pepper ──────────────────────────────────────────────────────
  if (Object.keys(toWrite).length > 0) {
    const { error } = await provDbAs(PEPPER_ACTOR)
      .from(table)
      .update(toWrite)
      .eq('id', recordId)
    if (error) {
      return { written: [], proposed, skipped, error: `write ${table}: ${error.message}` }
    }

    // Provenance follows the write, never precedes it: a provenance row for a
    // value that failed to land would tell the NEXT run it owns a field it has
    // never written.
    const rows = written.map((w) => {
      const u = wanted.get(w.field)!
      return {
        table_name: table,
        record_id: recordId,
        field_key: w.field,
        written_by: 'pepper' as const,
        source_kind: u.sourceKind,
        source_ref: u.sourceRef ?? null,
        evidence: u.evidence ?? null,
        confidence: u.confidence ?? null,
        as_of: u.asOf ?? new Date().toISOString(),
        // ⚠ THE UNDO. Recorded here rather than relied upon from activity_log,
        // because the first live run showed 17 writes producing ONE audit row:
        // `opportunities` and `parties` carry no log_activity trigger, and
        // `projects` is outside the twenty tables that get a column diff. See
        // the migration header.
        previous_value: w.from,
        updated_at: new Date().toISOString(),
      }
    })
    const { error: provErr } = await provDbAs(PEPPER_ACTOR)
      .from('record_field_provenance')
      .upsert(rows, { onConflict: 'table_name,record_id,field_key' })
    if (provErr) {
      // The data write already succeeded, so this is reported rather than
      // treated as a failure — but it must be reported, because a written
      // field with no provenance row reads as human on the next pass and
      // quietly becomes un-updatable.
      return {
        written,
        proposed,
        skipped,
        error: `provenance not recorded (values DID write): ${provErr.message}`,
      }
    }
  }

  // ── Ask, for the guarded ones ─────────────────────────────────────────────
  if (proposed.length > 0) {
    const rows = proposed.map((p) => {
      const u = wanted.get(p.field)!
      return {
        table_name: table,
        record_id: recordId,
        field_key: p.field,
        record_label: recordLabel,
        current_value: p.from,
        proposed_value: p.to,
        source_kind: u.sourceKind,
        source_ref: u.sourceRef ?? null,
        evidence: u.evidence ?? null,
        confidence: u.confidence ?? null,
        status: 'pending' as const,
        decided_at: null,
        decided_by: null,
        updated_at: new Date().toISOString(),
      }
    })
    // Re-asking the same question UPDATES it rather than stacking a second
    // card. Not a partial index, so it is a legal ON CONFLICT target (§12).
    const { error } = await provDbAs(PEPPER_ACTOR)
      .from('field_update_proposals')
      .upsert(rows, { onConflict: 'table_name,record_id,field_key' })
    if (error) {
      return { written, proposed: [], skipped, error: `propose: ${error.message}` }
    }
  }

  return { written, proposed, skipped, error: null }
}

/**
 * Record that a HUMAN wrote a field, so she will not overwrite it later.
 *
 * ⚠ THIS IS THE OTHER HALF AND IT IS EASY TO FORGET. Without it, a figure
 * Richard types today has no provenance row — which `canWrite` reads as
 * "unknown, treat as human", so it is protected anyway. That is why the default
 * is what it is: this function makes the protection EXPLICIT and survivable if
 * the default is ever relaxed, rather than being the thing that creates it.
 */
export async function recordHumanWrite(args: {
  table: string
  recordId: string
  fields: string[]
  actor: { id: string; email?: string | null }
}): Promise<{ error: string | null }> {
  const fields = args.fields.filter((f) => fieldSpec(args.table, f))
  if (fields.length === 0) return { error: null }
  const now = new Date().toISOString()
  const { error } = await provDbAs(args.actor)
    .from('record_field_provenance')
    .upsert(
      fields.map((field) => ({
        table_name: args.table,
        record_id: args.recordId,
        field_key: field,
        written_by: 'human' as const,
        source_kind: 'form' as const,
        source_ref: args.actor.email ?? args.actor.id,
        as_of: now,
        updated_at: now,
      })),
      { onConflict: 'table_name,record_id,field_key' }
    )
  return { error: error ? error.message : null }
}

/** How a value of any column type reads on a card and in a log line. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
