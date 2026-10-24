/**
 * WHAT A JOB IS ALLOWED TO CHANGE.
 *
 * ⚠ THIS FILE IS A SECURITY BOUNDARY, NOT A CONVENIENCE — the same standing as
 * `src/lib/provenance/fields.ts` and the governance registers' field whitelist.
 *
 * A job may READ and REASON without limit: its output is a report, and a wrong
 * report costs a re-read. What it may WRITE is this list and nothing else,
 * because the dangerous output of a capable model is not a wrong answer, it is
 * a PLAUSIBLE EDIT — one that looks right in review, lands on 200 rows, and is
 * noticed six weeks later. So the model never emits SQL, never emits a column
 * name the registry does not know, and never writes anything at all: it
 * PROPOSES operations, a human presses apply, and the apply routes through the
 * write paths that already carry the whitelists, the guarded tier and
 * `previous_value`.
 *
 * THERE IS NO DELETE VERB, deliberately. Nothing a job proposes can destroy a
 * row. `tag_records` is the reversible bulk handle instead — the same shape as
 * `auto-contact`, which is how 59 of Pepper's contacts can be undone in one
 * press (§13).
 *
 * ADDING A VERB IS THE WAY THIS GETS MORE CAPABLE, and it is meant to be a
 * considered act: a verb needs a validator that can refuse, a human-readable
 * line for the review row, and an executor that goes through an existing write
 * path rather than touching Postgres itself.
 */

import type { FieldUpdate } from '@/lib/provenance/write'
import { fieldSpec } from '@/lib/provenance/fields'

/** The most operations one job may propose. A runaway guard, not a budget. */
export const MAX_OPERATIONS = 500

/** Tables a job may create a note against. */
export const NOTE_TARGETS = ['party', 'project', 'opportunity'] as const
export type NoteTarget = (typeof NOTE_TARGETS)[number]

/**
 * Tables a job may tag.
 *
 * ⚠ ONLY `parties`. This read `['parties', 'projects', 'opportunities']` until
 * `tsc` refused the executor: those two carry no `tags` column, and a check
 * across the whole schema confirms `parties` is the ONLY table in the database
 * that has one. The vocabulary cannot offer a verb the schema cannot perform —
 * a proposal that validates and then fails at the write is the §12 shape where
 * a refusal reads as an absence.
 */
export const TAGGABLE = ['parties'] as const
export type Taggable = (typeof TAGGABLE)[number]

export type JobOperation =
  | {
      kind: 'update_field'
      table: string
      record_id: string
      record_label?: string | null
      field: string
      value: unknown
      evidence?: string | null
      /**
       * Fill a blank but never replace a value. ⚠ Defaults to TRUE and the
       * model must argue it down, which is the opposite of a record-scoped
       * pass: a job reads a corpus it was pointed at, and §12's rule is that
       * the broad source fills while the narrow source decides.
       */
      fill_only?: boolean
    }
  | {
      kind: 'create_contact'
      full_name: string
      title?: string | null
      company?: string | null
      email?: string | null
      phone?: string | null
      notes?: string | null
      tags?: string[]
      is_organization?: boolean
    }
  | {
      kind: 'create_task'
      title: string
      what?: string | null
      why?: string | null
      assignee_id?: string | null
      project_id?: string | null
      opportunity_id?: string | null
      due_date?: string | null
    }
  | {
      kind: 'add_note'
      target: NoteTarget
      record_id: string
      body: string
    }
  | {
      kind: 'tag_records'
      table: Taggable
      record_ids: string[]
      add?: string[]
      remove?: string[]
    }

export type JobOperationKind = JobOperation['kind']

export const OPERATION_KINDS: JobOperationKind[] = [
  'update_field', 'create_contact', 'create_task', 'add_note', 'tag_records',
]

/** A proposal that failed validation, carrying WHY so the reviewer can see it. */
export interface RejectedOperation {
  raw: unknown
  reason: string
}

export interface ValidatedOperations {
  operations: JobOperation[]
  rejected: RejectedOperation[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** A tag is a slug a human can read in a chip and type into a filter. */
const TAG = /^[a-z0-9][a-z0-9-]{0,48}$/

function str(v: unknown, max = 500): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= max ? s : null
}

function optStr(v: unknown, max = 2000): string | null {
  if (v === null || v === undefined) return null
  return str(v, max)
}

/**
 * Check one proposed operation, returning it narrowed or a reason it was
 * refused. A model inventing a column name or a kind is an EXPECTED input, not
 * an exception — so this never throws, and a refusal is reported as a refusal
 * rather than as an absence (§12).
 */
export function validateOperation(raw: unknown): JobOperation | string {
  if (!raw || typeof raw !== 'object') return 'not an object'
  const o = raw as Record<string, unknown>
  const kind = str(o.kind, 40)
  if (!kind) return 'no kind'
  if (!(OPERATION_KINDS as string[]).includes(kind)) {
    return `"${kind}" is not an operation this platform performs — the vocabulary is ${OPERATION_KINDS.join(', ')}`
  }

  switch (kind as JobOperationKind) {
    case 'update_field': {
      const table = str(o.table, 64)
      const field = str(o.field, 64)
      const recordId = str(o.record_id, 64)
      if (!table || !field) return 'update_field needs a table and a field'
      if (!recordId || !UUID.test(recordId)) return 'update_field needs record_id as a uuid'
      // ⚠ The registry decides, not the model. An unlisted column is refused
      // here rather than at the write, so the reviewer sees WHY it will not run.
      if (!fieldSpec(table, field)) return `${table}.${field} is not a field any automated pass may write`
      if (o.value === undefined) return 'update_field needs a value'
      return {
        kind: 'update_field',
        table, field, record_id: recordId,
        record_label: optStr(o.record_label, 200),
        value: o.value,
        evidence: optStr(o.evidence, 2000),
        fill_only: o.fill_only === false ? false : true,
      }
    }

    case 'create_contact': {
      const fullName = str(o.full_name, 160)
      if (!fullName) return 'create_contact needs a full_name'
      const tags = Array.isArray(o.tags)
        ? o.tags.map((t) => str(t, 50)).filter((t): t is string => !!t)
        : []
      const badTag = tags.find((t) => !TAG.test(t))
      if (badTag) return `"${badTag}" is not a usable tag — lowercase letters, digits and hyphens`
      const email = optStr(o.email, 200)
      if (email && !email.includes('@')) return `"${email}" is not an email address`
      return {
        kind: 'create_contact',
        full_name: fullName,
        title: optStr(o.title, 160),
        company: optStr(o.company, 200),
        email,
        phone: optStr(o.phone, 60),
        notes: optStr(o.notes, 20_000),
        tags,
        is_organization: o.is_organization === true,
      }
    }

    case 'create_task': {
      const title = str(o.title, 300)
      if (!title) return 'create_task needs a title'
      const due = optStr(o.due_date, 20)
      if (due && !ISO_DATE.test(due)) return `due_date must be YYYY-MM-DD, got "${due}"`
      for (const key of ['project_id', 'opportunity_id', 'assignee_id'] as const) {
        const v = optStr(o[key], 64)
        if (v && !UUID.test(v)) return `${key} must be a uuid`
      }
      if (optStr(o.project_id, 64) && optStr(o.opportunity_id, 64)) {
        return 'a task hangs off a project OR an opportunity, never both'
      }
      return {
        kind: 'create_task',
        title,
        what: optStr(o.what, 4000),
        why: optStr(o.why, 4000),
        assignee_id: optStr(o.assignee_id, 64),
        project_id: optStr(o.project_id, 64),
        opportunity_id: optStr(o.opportunity_id, 64),
        due_date: due,
      }
    }

    case 'add_note': {
      const target = str(o.target, 30)
      if (!target || !(NOTE_TARGETS as readonly string[]).includes(target)) {
        return `add_note target must be one of ${NOTE_TARGETS.join(', ')}`
      }
      const recordId = str(o.record_id, 64)
      if (!recordId || !UUID.test(recordId)) return 'add_note needs record_id as a uuid'
      const body = str(o.body, 40_000)
      if (!body) return 'add_note needs a body'
      return { kind: 'add_note', target: target as NoteTarget, record_id: recordId, body }
    }

    case 'tag_records': {
      const table = str(o.table, 40)
      if (!table || !(TAGGABLE as readonly string[]).includes(table)) {
        return `tag_records table must be one of ${TAGGABLE.join(', ')}`
      }
      const ids = Array.isArray(o.record_ids) ? o.record_ids.map((i) => str(i, 64)) : []
      const valid = ids.filter((i): i is string => !!i && UUID.test(i))
      if (valid.length === 0) return 'tag_records needs at least one record_id as a uuid'
      const parse = (v: unknown) =>
        Array.isArray(v) ? v.map((t) => str(t, 50)).filter((t): t is string => !!t) : []
      const add = parse(o.add)
      const remove = parse(o.remove)
      if (add.length === 0 && remove.length === 0) return 'tag_records needs tags to add or remove'
      const bad = [...add, ...remove].find((t) => !TAG.test(t))
      if (bad) return `"${bad}" is not a usable tag — lowercase letters, digits and hyphens`
      return { kind: 'tag_records', table: table as Taggable, record_ids: valid, add, remove }
    }
  }
}

/** Validate a whole batch, keeping the refusals so the reviewer sees them. */
export function validateOperations(raw: unknown): ValidatedOperations {
  const list = Array.isArray(raw) ? raw : []
  const operations: JobOperation[] = []
  const rejected: RejectedOperation[] = []
  for (const item of list.slice(0, MAX_OPERATIONS)) {
    const result = validateOperation(item)
    if (typeof result === 'string') rejected.push({ raw: item, reason: result })
    else operations.push(result)
  }
  if (list.length > MAX_OPERATIONS) {
    rejected.push({
      raw: null,
      reason: `${list.length} operations proposed; ${MAX_OPERATIONS} is the most one job may carry. The rest were dropped — narrow the job.`,
    })
  }
  return { operations, rejected }
}

/** One line a human can read on the review row, without opening anything. */
export function describeOperation(op: JobOperation): string {
  switch (op.kind) {
    case 'update_field': {
      const where = op.record_label ?? `${op.table} ${op.record_id.slice(0, 8)}`
      const spec = fieldSpec(op.table, op.field)
      const verb = op.fill_only ? 'Fill' : 'Set'
      return `${verb} ${spec?.label ?? op.field} on ${where} → ${JSON.stringify(op.value)}`
    }
    case 'create_contact': {
      const at = op.company ? ` at ${op.company}` : ''
      return `Add contact ${op.full_name}${op.title ? `, ${op.title}` : ''}${at}`
    }
    case 'create_task':
      return `Create task "${op.title}"${op.due_date ? ` due ${op.due_date}` : ''}`
    case 'add_note':
      return `Note on ${op.target} ${op.record_id.slice(0, 8)} — ${op.body.slice(0, 80)}${op.body.length > 80 ? '…' : ''}`
    case 'tag_records': {
      const bits = [
        op.add?.length ? `+${op.add.join(' +')}` : '',
        op.remove?.length ? `-${op.remove.join(' -')}` : '',
      ].filter(Boolean).join(' ')
      return `Tag ${op.record_ids.length} ${op.table} ${bits}`
    }
  }
}

/** Shape an `update_field` operation into the provenance layer's own input. */
export function toFieldUpdate(op: Extract<JobOperation, { kind: 'update_field' }>): FieldUpdate {
  return {
    field: op.field,
    value: op.value,
    evidence: op.evidence ?? null,
    // A job's source is the instruction a human gave plus what it read; the
    // apply itself is a human press, which is what `written_by` records.
    sourceKind: 'form',
    fillOnly: op.fill_only !== false,
  }
}
