/**
 * The child registry — one declaration per table that hangs off a project or an
 * opportunity, and the single place the access check for one of them lives.
 *
 * WHY A SPEC AND NOT TWELVE ROUTE FILES
 *
 * Measured 2026-10-19: of the 200 route handlers in this app, 61 touch exactly
 * one table with exactly one write verb, and 22 of those carry no record-level
 * access check at all. The six tables below were twelve such files, and they
 * had drifted in four different directions:
 *
 *   - `milestones/[id]` resolved the row's parent and called canAccessRecord.
 *     `dd-items/[id]`, `financing/[id]`, `compliance-items/[id]`,
 *     `project-players/[id]` and `entity-projects/[id]` asked nothing — any
 *     authenticated session could PATCH or DELETE one of those rows by id,
 *     including on a project marked `confidential`, which is the one thing
 *     canAccessRecord exists to refuse. (Latent rather than live: all three auth
 *     users are executives and no project is protected today.)
 *   - `financing/[id]` built its update as `body.x ?? null` for every column, so
 *     any partial PATCH would have blanked the rest of the row. It survived
 *     because its single caller sends the whole form (§12 — a field the caller
 *     never mentioned must be OMITTED, not nulled).
 *   - `entity-projects/[id]` and `project-players/[id]` wrote through
 *     createAdminClient(), so a human's edit was attributed to "system" in
 *     activity_log (§12).
 *   - `dd-items` validated `severity` against the enum at the edge — added after
 *     a live 22P02 reported as a 500 — while `compliance_items.status`, also a
 *     Postgres enum, went unchecked.
 *
 * The docblock on canAccessRecord already called this: "Checking it in each of
 * them is seven chances to miss one, and the eighth route added next year would
 * miss it by default." Six of seven had missed it. So the check moves to the
 * choke point and becomes the DEFAULT rather than something each route
 * remembers — §12, and the same shape as src/lib/governance/registers.ts, which
 * has run twelve registers through one route pair since 2026-09-30.
 *
 * ⚠ THE CHILD NAME IS RESOLVED THROUGH A FIXED MAP, never interpolated into a
 * table name. A name absent from CHILDREN 404s before any client is built, so
 * /api/records/<child> cannot be pointed at auth.users or activity_log.
 *
 * ⚠ AND THE NAME IS PART OF A SECURITY BOUNDARY A PREFIX MATCH CAN SEE. The
 * role gate's `matchesPrefix` is a prefix match and is NOT method-aware (§12),
 * so `project_manager` is allowlisted `/api/records/milestones` specifically —
 * NOT `/api/records`, which would hand them diligence, financing, players and
 * entity links in one line. Every path below is distinguishable at the prefix.
 */

import type { FieldKind, FieldSpec } from '@/lib/registry/fields'
import { COMPLIANCE_STATUSES, DD_STATUSES, SEVERITIES } from '@/lib/utils/constants'

/**
 * How a row names the record it belongs to.
 *
 * `record` — exactly one of project_id / opportunity_id, the shared-children
 *   convention (§4) and the table's own check constraint.
 * `record-optional` — at most one. A compliance item with neither is a
 *   company-level obligation, which is a legitimate state for that table and
 *   that table only.
 */
export type ParentShape = 'record' | 'record-optional'

/**
 * A timestamp this registry stamps itself when a value in the body flips.
 *
 * Server-side on purpose, and the column is deliberately absent from `fields`:
 * a completion time the client supplies is not evidence of the thing it exists
 * to evidence. Same reasoning as the offboarding checklist in the governance
 * route.
 */
export interface StampSpec {
  /** The body key that drives it. */
  from: string
  /** The value that means "done". Omitted = the key is a boolean. */
  done?: string
  /** The timestamp column written, and cleared again when it flips back. */
  into: string
}

export interface ChildSpec extends FieldSpec {
  table: string
  /** Used in the messages a human reads. */
  label: string
  parent: ParentShape
  /** Values written on a create when the body does not carry them. */
  defaults?: Record<string, unknown>
  /** PostgREST select list for the row sent back — an embed where the UI needs one. */
  select?: string
  stamp?: StampSpec
  /** Touch `updated_at` on a PATCH. Only where the table has the column. */
  touchUpdatedAt?: boolean
  /**
   * What a 23505 means in words, for the tables carrying a unique index a
   * reader can hit by mis-clicking. Absent = the row cannot collide.
   */
  conflict?: string
  /**
   * Whether DELETE is offered. Four of these six had a delete route and two did
   * not; the registry keeps that surface identical rather than quietly granting
   * two new destructive verbs nothing asks for (§11 — no pre-building).
   */
  deletable?: boolean
}

const TEXT: FieldKind = 'text'

export const CHILDREN: Record<string, ChildSpec> = {
  milestones: {
    table: 'milestones',
    label: 'milestone',
    parent: 'record',
    required: ['stage', 'label'],
    // `completed` is not a column — it drives the stamp below.
    stamp: { from: 'completed', into: 'completed_at' },
    fields: {
      // `stage` is plain text since 2026-09-23, never the project_stage enum: a
      // project milestone carries a project_stage value and a deal milestone an
      // opportunity pipeline value, and one table holds both (§4).
      stage: TEXT,
      label: TEXT,
      target_date: 'date',
      notes: TEXT,
      sort_order: 'int',
    },
  },

  'dd-items': {
    table: 'dd_items',
    label: 'diligence item',
    parent: 'record',
    required: ['category', 'item'],
    defaults: { severity: 'info', status: 'open' },
    stamp: { from: 'status', done: 'resolved', into: 'resolved_at' },
    enums: {
      // `severity` is a Postgres ENUM, so an unrecognised value is a 22P02 and a
      // NULL row set — a client mistake that used to surface as a 500 with raw
      // Postgres text. Observed live 2026-09-23 with severity "high", which is
      // not in the vocabulary. Checked here against the list the UI offers.
      severity: SEVERITIES,
      status: DD_STATUSES,
    },
    fields: {
      category: TEXT,
      item: TEXT,
      severity: TEXT,
      status: TEXT,
      assigned_to: 'uuid',
      notes: TEXT,
    },
    deletable: true,
  },

  financing: {
    table: 'financing_structures',
    label: 'financing structure',
    parent: 'record',
    required: [],
    touchUpdatedAt: true,
    fields: {
      structure_type: TEXT,
      senior_debt: 'money',
      mezzanine: 'money',
      equity_amount: 'money',
      equity_pct: 'money',
      ltv: 'money',
      interest_rate: 'money',
      lender: TEXT,
      pe_partner: TEXT,
      waterfall_notes: TEXT,
      draw_schedule: 'json',
      notes: TEXT,
    },
  },

  'compliance-items': {
    table: 'compliance_items',
    label: 'compliance item',
    // At most one scope: a compliance item with neither is a company-level
    // obligation, unlike a diligence item.
    parent: 'record-optional',
    required: ['framework', 'requirement'],
    defaults: { status: 'not_started' },
    touchUpdatedAt: true,
    // `status` is a Postgres ENUM here too, and was never checked at the edge.
    enums: { status: COMPLIANCE_STATUSES },
    fields: {
      framework: TEXT,
      requirement: TEXT,
      status: TEXT,
      due_date: 'date',
      responsible_party: 'uuid',
      evidence_doc_id: 'uuid',
      notes: TEXT,
    },
    deletable: true,
  },

  'project-players': {
    table: 'project_players',
    label: 'player',
    parent: 'record',
    required: ['party_id', 'role'],
    defaults: { is_primary: false },
    fields: {
      party_id: 'uuid',
      // The prose and the category, deliberately both (§4, 2026-10-21).
      // `role` is what the reader sees and what the model wrote — "Broker — 4%
      // fee" keeps its 4%. `role_key` is the registry key that makes the row
      // filterable. An unrecognised role still lands, merely uncategorised.
      role: TEXT,
      role_key: TEXT,
      is_primary: 'bool',
      notes: TEXT,
    },
    conflict: 'That person is already on this record in that role.',
    deletable: true,
  },

  'entity-projects': {
    table: 'entity_projects',
    label: 'entity link',
    parent: 'record',
    required: ['entity_id', 'relationship'],
    // The tab renders the linked entity straight from the write's response.
    select: '*, entity:entities(*)',
    fields: {
      entity_id: 'uuid',
      relationship: TEXT,
      equity_pct: 'money',
      notes: TEXT,
    },
    conflict:
      'This entity already has this relationship on the record. Use a different relationship type.',
    deletable: true,
  },
}

export type ChildName = keyof typeof CHILDREN

export function getChild(name: string): ChildSpec | null {
  return Object.prototype.hasOwnProperty.call(CHILDREN, name) ? CHILDREN[name] : null
}

/** Every path this registry answers on — read by the convention test. */
export const CHILD_PATHS = Object.keys(CHILDREN).map((name) => `/api/records/${name}`)

/**
 * Apply a spec's stamp to an outgoing row, given the request body.
 *
 * Returns nothing — it mutates `value`, the same way the governance route
 * stamps an offboarding step. Exported so the collection and row handlers share
 * one copy and a test can reach it without a request.
 */
export function applyStamp(
  spec: ChildSpec,
  body: Record<string, unknown>,
  value: Record<string, unknown>
): void {
  const stamp = spec.stamp
  if (!stamp || !(stamp.from in body)) return
  const raw = body[stamp.from]
  const done =
    stamp.done === undefined
      ? raw === true || raw === 'true' || raw === 1 || raw === '1'
      : raw === stamp.done
  value[stamp.into] = done ? new Date().toISOString() : null
}
