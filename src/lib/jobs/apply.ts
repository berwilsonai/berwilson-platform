/**
 * Applying a job's proposed operations — the only place a job's work reaches
 * the database, and it only runs on a human's press.
 *
 * ⚠ NOTHING HERE TOUCHES POSTGRES DIRECTLY WHERE A WRITE PATH ALREADY EXISTS.
 * `update_field` goes through `applyFieldUpdates`, which carries the column
 * whitelist, the guarded tier and `previous_value`; `add_note` goes through
 * `logEntry`, which is the one composer for all three note targets. §12 twice
 * over: never fork a shared pass, and a shared renderer wired to one surface is
 * worse than no shared renderer. Writing a second note composer here is exactly
 * the fork `log-entry.ts` was written to prevent.
 *
 * ⚠ CONTAINMENT IS CHECKED HERE AS A DEFAULT, NOT PASSED IN BY THE CALLER.
 * §12: a security filter belongs at the choke point as a default, because
 * forgetting to opt in costs a few results and forgetting to opt out costs the
 * secret — and the default is what covers the verb added next year. A protected
 * project is refused outright: a job is a bulk pass, and `confidential` is
 * containment rather than access, so no step-up unlocks it.
 *
 * Every operation reports its own outcome. A batch where one row fails must not
 * fail the other 231 — and the failures are RETURNED rather than thrown, so the
 * reviewer sees which ones did not land and why (§12: a refusal reported as an
 * absence is how a caller concludes there was nothing to do).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { applyFieldUpdates } from '@/lib/provenance/write'
import { logEntry } from '@/lib/records/log-entry'
import { hiddenProjectIds } from '@/lib/security/confidential'
import { matchDirectory } from '@/lib/contacts/directory-match'
import { describeOperation, toFieldUpdate, type JobOperation } from './operations'

export interface OperationOutcome {
  index: number
  kind: JobOperation['kind']
  description: string
  status: 'applied' | 'proposed' | 'skipped' | 'failed'
  /** Always present for anything but `applied` — never a bare failure. */
  detail: string | null
  /** The row it created or changed, where there is one. */
  recordId?: string | null
}

export interface ApplyOperationsResult {
  outcomes: OperationOutcome[]
  applied: number
  proposed: number
  skipped: number
  failed: number
}

/** A human-readable label for a record we only know by id. */
const shortId = (id: string) => id.slice(0, 8)

/**
 * ⚠ The ROW cap and the URL cap are two limits one constant cannot serve. A
 * filter rides in the query string, so `.in()` with 1000 uuids is a 37KB GET
 * and Kong answers `URI too long` (§12). Ids are chunked well under that.
 */
const ID_CHUNK = 200

export async function applyJobOperations(args: {
  db: SupabaseClient<Database>
  operations: JobOperation[]
  /**
   * Indices the human ticked. ⚠ REQUIRED, not defaulted to "all" — a missing
   * selection must mean nothing happens rather than everything happening.
   */
  selected: number[]
  /** Stamped as the note author / contact provenance. */
  actorLabel: string
  jobId: string
}): Promise<ApplyOperationsResult> {
  const { db, operations, selected, actorLabel, jobId } = args
  const pick = new Set(selected)
  const outcomes: OperationOutcome[] = []

  // One read for the whole batch. `hiddenProjectIds()` with no viewer is the
  // containment set — every protected project, for everyone.
  const hidden = await hiddenProjectIds(null)

  for (let i = 0; i < operations.length; i++) {
    if (!pick.has(i)) continue
    const op = operations[i]
    const base = { index: i, kind: op.kind, description: describeOperation(op) }

    try {
      const outcome = await applyOne(db, op, { actorLabel, jobId, hidden })
      outcomes.push({ ...base, ...outcome })
    } catch (err) {
      outcomes.push({
        ...base,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    outcomes,
    applied: outcomes.filter((o) => o.status === 'applied').length,
    proposed: outcomes.filter((o) => o.status === 'proposed').length,
    skipped: outcomes.filter((o) => o.status === 'skipped').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  }
}

interface ApplyCtx {
  actorLabel: string
  jobId: string
  hidden: Set<string>
}

type OneResult = Pick<OperationOutcome, 'status' | 'detail' | 'recordId'>

async function applyOne(
  db: SupabaseClient<Database>,
  op: JobOperation,
  ctx: ApplyCtx
): Promise<OneResult> {
  switch (op.kind) {
    // ── A field on an existing record ───────────────────────────────────────
    case 'update_field': {
      if (op.table === 'projects' && ctx.hidden.has(op.record_id)) {
        return { status: 'skipped', detail: 'that record is protected — a bulk pass does not write to it' }
      }
      const result = await applyFieldUpdates({
        table: op.table,
        recordId: op.record_id,
        recordLabel: op.record_label ?? null,
        updates: [toFieldUpdate(op)],
      })
      if (result.error) return { status: 'failed', detail: result.error, recordId: op.record_id }
      if (result.written.length) {
        const w = result.written[0]
        return { status: 'applied', detail: `${w.from ?? '(blank)'} → ${w.to ?? '(blank)'}`, recordId: op.record_id }
      }
      if (result.proposed.length) {
        return {
          status: 'proposed',
          detail: `held for your decision — ${result.proposed[0].reason}`,
          recordId: op.record_id,
        }
      }
      const why = result.skipped[0]?.reason ?? 'the value was already there'
      return { status: 'skipped', detail: why, recordId: op.record_id }
    }

    // ── A new contact ───────────────────────────────────────────────────────
    case 'create_contact': {
      // ⚠ Checked AT THE WRITE, not only when the job proposed it: a job may
      // have been reviewed days after it ran, and the matcher's answer is a
      // fact about the directory NOW. Ambiguity means no match, and a refusal
      // is reported as a refusal rather than as "nothing on file" — reading
      // those as the same thing is what manufactured duplicate contacts (§12).
      const match = await matchDirectory(op.email ?? null, op.full_name, op.company ?? null)
      if (match.ambiguous) {
        return {
          status: 'skipped',
          detail: `already ambiguous in the directory — could be ${match.candidates.map((c) => c.full_name).join(' or ')}`,
        }
      }
      if (match.existing_party_id) {
        return {
          status: 'skipped',
          detail: `already in the directory as ${match.existing_party_name}`,
          recordId: match.existing_party_id,
        }
      }
      const { data, error } = await db
        .from('parties')
        .insert({
          full_name: op.full_name,
          title: op.title,
          company: op.company,
          email: op.email,
          phone: op.phone,
          relationship_notes: op.notes,
          is_organization: op.is_organization ?? false,
          status: 'active',
          // The job tag is the undo handle — these select together and the
          // existing bulk archive reverses the whole run in one press.
          tags: [...new Set([...(op.tags ?? []), 'from-a-job'])],
        })
        .select('id')
        .single()
      if (error) return { status: 'failed', detail: error.message }
      return { status: 'applied', detail: null, recordId: data.id }
    }

    // ── A task ──────────────────────────────────────────────────────────────
    case 'create_task': {
      if (op.project_id && ctx.hidden.has(op.project_id)) {
        return { status: 'skipped', detail: 'that project is protected — a bulk pass does not write to it' }
      }
      const { data, error } = await db
        .from('tasks')
        .insert({
          title: op.title,
          what: op.what,
          why: op.why,
          assignee_id: op.assignee_id,
          project_id: op.project_id,
          opportunity_id: op.opportunity_id,
          due_date: op.due_date,
          status: 'open',
        })
        .select('id')
        .single()
      if (error) return { status: 'failed', detail: error.message }
      return { status: 'applied', detail: null, recordId: data.id }
    }

    // ── A note on a record ──────────────────────────────────────────────────
    case 'add_note': {
      if (op.target === 'project' && ctx.hidden.has(op.record_id)) {
        return { status: 'skipped', detail: 'that project is protected — a bulk pass does not write to it' }
      }
      const target =
        op.target === 'party'
          ? ({ kind: 'contact', id: op.record_id } as const)
          : ({ kind: op.target, id: op.record_id } as const)
      const result = await logEntry(db, target, {
        rawContent: op.body,
        summary: null,
        author: ctx.actorLabel,
      })
      return { status: 'applied', detail: `logged on ${result.table}`, recordId: result.id }
    }

    // ── Bulk tags, the reversible handle ────────────────────────────────────
    case 'tag_records': {
      // `parties` is the only table in the schema with a `tags` column, which
      // is why the vocabulary offers only it — see TAGGABLE.
      // ⚠ PostgREST truncates at 1000 rows and an `.in()` of 1000 uuids is a
      // 37KB GET that Kong refuses outright, so ids are chunked (§12).
      let changed = 0
      let seen = 0
      for (let i = 0; i < op.record_ids.length; i += ID_CHUNK) {
        const chunk = op.record_ids.slice(i, i + ID_CHUNK)
        const { data: rows, error: readErr } = await db
          .from('parties').select('id, tags').in('id', chunk)
        if (readErr) return { status: 'failed', detail: readErr.message }
        if (!rows) continue
        seen += rows.length
        // Read-modify-write per row: the add/remove is a set operation on a
        // text[] that the client cannot express in one call.
        for (const row of rows) {
          const next = new Set(row.tags ?? [])
          for (const t of op.add ?? []) next.add(t)
          for (const t of op.remove ?? []) next.delete(t)
          const before = (row.tags ?? []).slice().sort().join(',')
          if (before === [...next].sort().join(',')) continue
          const { error } = await db.from('parties').update({ tags: [...next] }).eq('id', row.id)
          if (error) return { status: 'failed', detail: `${shortId(row.id)}: ${error.message}` }
          changed++
        }
      }
      if (seen === 0) return { status: 'skipped', detail: 'none of those contacts exist' }
      const missing = op.record_ids.length - seen
      const detail = [
        `${changed} of ${seen} changed`,
        missing > 0 ? `${missing} not found` : '',
      ].filter(Boolean).join('; ')
      return { status: changed > 0 ? 'applied' : 'skipped', detail }
    }
  }
}
