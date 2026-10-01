/**
 * The register specs — one declaration per governance table, and the
 * normalisation that every write goes through.
 *
 * WHY A SPEC AND NOT TWELVE ROUTE FILES
 *
 * These registers are the same shape: an admin lists rows, adds a row, edits a
 * row, occasionally removes one. Twelve hand-written route pairs is twenty-four
 * files in which the admin guard, the field whitelist and the date parsing
 * drift apart — and §12's rule is explicit that forking a shared pass per table
 * is what silently loses work. One pass with a target parameter instead.
 *
 * ⚠ THE FIELD WHITELIST IS A SECURITY BOUNDARY, NOT A CONVENIENCE. The route
 * resolves a register NAME to a spec here and will touch no table that is not
 * named below, and no column that is not in `fields`. Nothing reaches PostgREST
 * from a request body un-whitelisted — in particular `id`, `created_at`,
 * `author` and the generated `status` column are deliberately absent, so a
 * crafted body cannot restamp an HR note's author or forge a status.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FieldKind =
  | 'text'
  | 'date'
  | 'bool'
  /** Nullable bool — null means "nobody has decided", which differs from false. */
  | 'tribool'
  | 'int'
  | 'money'
  | 'uuid'
  | 'textarray'

export interface SnapshotSpec {
  /** The FK column the reader picked. */
  from: string
  /** Table it points at. */
  table: string
  /** Column holding the display name. */
  column: string
  /** Column on THIS table the name is copied into. */
  into: string
}

export interface RegisterSpec {
  table: string
  /** Used in error messages a human reads. */
  label: string
  fields: Record<string, FieldKind>
  /** Columns that must be present and non-null on a create. */
  required: string[]
  /** Columns constrained to a fixed set, checked before the database sees them. */
  enums?: Record<string, readonly string[]>
  /** Stamp the viewer's name into `author`. Never taken from the client. */
  stampAuthor?: boolean
  orderBy: { column: string; ascending: boolean }
  /**
   * Copy a related record's name onto this row at write time.
   *
   * Every org_node_id in these tables is `on delete set null` or `restrict`, so
   * without the snapshot the corporate record loses the NAME of the entity a
   * resolution bound the moment someone tidies the chart. The org chart is a
   * board people drag boxes around on; this is a register.
   */
  snapshots?: SnapshotSpec[]
}

// ─── Specs ───────────────────────────────────────────────────────────────────

export const REGISTERS: Record<string, RegisterSpec> = {
  resolutions: {
    table: 'resolutions',
    label: 'resolution',
    required: ['title', 'adopted_on'],
    orderBy: { column: 'adopted_on', ascending: false },
    enums: {
      kind: ['resolution', 'written_consent', 'ratification', 'minute_action'],
      adopting_body: ['board', 'members', 'managers', 'shareholders', 'officer', 'committee'],
      signature_status: ['unsigned', 'circulating', 'signed', 'superseded'],
    },
    snapshots: [{ from: 'org_node_id', table: 'org_nodes', column: 'name', into: 'org_node_name' }],
    fields: {
      org_node_id: 'uuid',
      reference: 'text',
      title: 'text',
      kind: 'text',
      adopting_body: 'text',
      adopted_on: 'date',
      effective_on: 'date',
      meeting_id: 'uuid',
      votes_for: 'int',
      votes_against: 'int',
      votes_abstain: 'int',
      recusals: 'textarray',
      text_body: 'text',
      signature_status: 'text',
      signed_on: 'date',
      document_id: 'uuid',
      superseded_by_resolution_id: 'uuid',
      note: 'text',
    },
  },

  appointments: {
    table: 'org_roles',
    label: 'appointment',
    required: ['person_name', 'title', 'effective_from'],
    // Current holders first, then history — a register is read from the top.
    orderBy: { column: 'effective_from', ascending: false },
    enums: {
      appointed_by: ['board', 'members', 'managers', 'shareholders', 'officer', 'committee', 'operating_agreement'],
      end_reason: ['resigned', 'removed', 'term_expired', 'role_changed', 'separation', 'entity_dissolved', 'other'],
    },
    snapshots: [{ from: 'org_node_id', table: 'org_nodes', column: 'name', into: 'org_node_name' }],
    fields: {
      personnel_id: 'uuid',
      party_id: 'uuid',
      org_person_id: 'uuid',
      person_name: 'text',
      org_node_id: 'uuid',
      title: 'text',
      appointed_by: 'text',
      appointing_resolution_id: 'uuid',
      is_officer: 'bool',
      is_director: 'bool',
      is_manager: 'bool',
      can_sign_contracts: 'bool',
      signing_limit: 'money',
      bank_signatory: 'bool',
      can_bind_surety: 'bool',
      authority_note: 'text',
      effective_from: 'date',
      effective_to: 'date',
      end_reason: 'text',
      ending_resolution_id: 'uuid',
      note: 'text',
    },
  },

  ownership: {
    table: 'ownership_interests',
    label: 'ownership interest',
    required: ['org_node_id', 'holder_name', 'effective_from'],
    orderBy: { column: 'effective_from', ascending: false },
    enums: {
      class: [
        'membership_units',
        'series_interest',
        'common',
        'preferred',
        'profits_interest',
        'option',
        'warrant',
        'convertible_note',
        'other',
      ],
    },
    snapshots: [{ from: 'org_node_id', table: 'org_nodes', column: 'name', into: 'org_node_name' }],
    fields: {
      org_node_id: 'uuid',
      holder_name: 'text',
      holder_party_id: 'uuid',
      holder_entity_id: 'uuid',
      holder_node_id: 'uuid',
      investor_id: 'uuid',
      class: 'text',
      units: 'money',
      percent: 'money',
      capital_contributed: 'money',
      effective_from: 'date',
      effective_to: 'date',
      acquired_from_id: 'uuid',
      consideration: 'money',
      authorizing_resolution_id: 'uuid',
      certificate_number: 'text',
      note: 'text',
    },
  },

  obligations: {
    table: 'entity_obligations',
    label: 'obligation',
    required: ['kind'],
    // "What is due next" is the only question this table is asked.
    orderBy: { column: 'next_due_on', ascending: true },
    enums: {
      category: ['filing', 'licence', 'registration', 'tax', 'insurance', 'bond', 'certification', 'other'],
      period: ['annual', 'biennial', 'quarterly', 'monthly', 'one_time', 'as_needed'],
      status: ['open', 'filed', 'lapsed', 'not_applicable', 'waived'],
    },
    snapshots: [{ from: 'org_node_id', table: 'org_nodes', column: 'name', into: 'org_node_name' }],
    fields: {
      org_node_id: 'uuid',
      category: 'text',
      kind: 'text',
      jurisdiction: 'text',
      authority: 'text',
      identifier: 'text',
      period: 'text',
      last_filed_on: 'date',
      next_due_on: 'date',
      status: 'text',
      owner_team_member_id: 'uuid',
      cost: 'money',
      document_id: 'uuid',
      note: 'text',
    },
  },

  conflicts: {
    table: 'conflict_disclosures',
    label: 'disclosure',
    required: ['person_name', 'disclosed_on'],
    orderBy: { column: 'disclosed_on', ascending: false },
    enums: { kind: ['annual', 'transaction', 'update'] },
    fields: {
      personnel_id: 'uuid',
      party_id: 'uuid',
      person_name: 'text',
      kind: 'text',
      period: 'text',
      disclosed_on: 'date',
      has_conflicts: 'bool',
      description: 'text',
      related_party_id: 'uuid',
      related_entity_id: 'uuid',
      related_name: 'text',
      org_node_id: 'uuid',
      project_id: 'uuid',
      recused: 'bool',
      resolution_id: 'uuid',
      reviewed_by: 'text',
      reviewed_on: 'date',
      document_id: 'uuid',
    },
  },

  'related-party': {
    table: 'related_party_transactions',
    label: 'related-party transaction',
    required: ['title', 'counterparty_name', 'relationship'],
    orderBy: { column: 'started_on', ascending: false },
    enums: {
      approved_by: ['board', 'members', 'disinterested_directors', 'officer', 'pending', 'not_approved'],
      status: ['active', 'closed', 'under_review'],
    },
    snapshots: [{ from: 'org_node_id', table: 'org_nodes', column: 'name', into: 'org_node_name' }],
    fields: {
      title: 'text',
      org_node_id: 'uuid',
      counterparty_name: 'text',
      counterparty_party_id: 'uuid',
      counterparty_entity_id: 'uuid',
      relationship: 'text',
      nature: 'text',
      project_id: 'uuid',
      amount: 'money',
      period: 'text',
      started_on: 'date',
      ended_on: 'date',
      arms_length_basis: 'text',
      approved_by: 'text',
      resolution_id: 'uuid',
      disclosed_in: 'text',
      status: 'text',
      document_id: 'uuid',
      note: 'text',
    },
  },

  policies: {
    table: 'policies',
    label: 'policy',
    required: ['name', 'version'],
    orderBy: { column: 'name', ascending: true },
    enums: {
      category: ['conduct', 'safety', 'hr', 'finance', 'it_security', 'procurement', 'governance', 'quality', 'other'],
      acknowledgement_cadence: ['once', 'annual', 'on_change'],
    },
    fields: {
      name: 'text',
      version: 'text',
      category: 'text',
      summary: 'text',
      effective_from: 'date',
      retired_on: 'date',
      requires_acknowledgement: 'bool',
      acknowledgement_cadence: 'text',
      adopted_by_resolution_id: 'uuid',
      document_id: 'uuid',
    },
  },

  acknowledgements: {
    table: 'policy_acknowledgements',
    label: 'acknowledgement',
    required: ['policy_id', 'person_name', 'acknowledged_on'],
    orderBy: { column: 'acknowledged_on', ascending: false },
    enums: { method: ['platform', 'signed', 'email', 'training', 'other'] },
    fields: {
      policy_id: 'uuid',
      personnel_id: 'uuid',
      team_member_id: 'uuid',
      person_name: 'text',
      acknowledged_on: 'date',
      method: 'text',
      document_id: 'uuid',
      note: 'text',
    },
  },

  agreements: {
    table: 'personnel_agreements',
    label: 'agreement',
    required: ['personnel_id', 'kind'],
    orderBy: { column: 'signed_on', ascending: false },
    enums: {
      kind: [
        'offer_letter',
        'employment_agreement',
        'contractor_agreement',
        'nda',
        'non_solicit',
        'non_compete',
        'ip_assignment',
        'arbitration',
        'handbook_ack',
        'separation_agreement',
        'release',
        'other',
      ],
    },
    fields: {
      personnel_id: 'uuid',
      kind: 'text',
      version: 'text',
      signed_on: 'date',
      effective_from: 'date',
      expires_on: 'date',
      consideration: 'money',
      document_id: 'uuid',
      note: 'text',
    },
  },

  notes: {
    table: 'personnel_notes',
    label: 'note',
    required: ['personnel_id', 'kind', 'body'],
    orderBy: { column: 'created_at', ascending: false },
    // `author` is absent from `fields` on purpose and stamped below instead.
    stampAuthor: true,
    fields: {
      personnel_id: 'uuid',
      kind: 'text',
      body: 'text',
      effective_on: 'date',
      document_id: 'uuid',
      confidential: 'bool',
    },
  },

  offboarding: {
    table: 'personnel_offboarding',
    label: 'offboarding step',
    required: ['personnel_id', 'label'],
    orderBy: { column: 'sort_order', ascending: true },
    enums: { category: ['access', 'property', 'payroll', 'authority', 'external', 'other'] },
    fields: {
      personnel_id: 'uuid',
      label: 'text',
      category: 'text',
      required: 'bool',
      sort_order: 'int',
      completed_at: 'text',
      completed_by: 'text',
      note: 'text',
    },
  },

  'note-kinds': {
    table: 'personnel_note_kinds',
    label: 'note kind',
    required: ['key', 'label'],
    orderBy: { column: 'sort_order', ascending: true },
    fields: {
      key: 'text',
      label: 'text',
      description: 'text',
      tone: 'text',
      sensitive: 'bool',
      requires_document: 'bool',
      sort_order: 'int',
      active: 'bool',
    },
  },
}

export type RegisterName = keyof typeof REGISTERS

export function getRegister(name: string): RegisterSpec | null {
  return Object.prototype.hasOwnProperty.call(REGISTERS, name) ? REGISTERS[name] : null
}

// ─── Normalisation ───────────────────────────────────────────────────────────

export type NormalizeResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

function coerce(
  kind: FieldKind,
  raw: unknown,
  column: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }

  switch (kind) {
    case 'text': {
      if (typeof raw !== 'string') return { ok: false, error: `${column} must be text` }
      const trimmed = raw.trim()
      // '' means "cleared", not "empty string" — a blank text column should read
      // as absent everywhere, and `is null` is the only filter that finds it.
      return { ok: true, value: trimmed.length ? trimmed : null }
    }
    case 'date': {
      if (typeof raw !== 'string') return { ok: false, error: `${column} must be a date` }
      const trimmed = raw.trim()
      if (!trimmed) return { ok: true, value: null }
      if (!DATE_RE.test(trimmed)) return { ok: false, error: `${column} must be a date (YYYY-MM-DD)` }
      return { ok: true, value: trimmed }
    }
    case 'bool':
      return { ok: true, value: raw === true || raw === 'true' || raw === 1 || raw === '1' }
    case 'tribool': {
      if (raw === '' ) return { ok: true, value: null }
      return { ok: true, value: raw === true || raw === 'true' || raw === 1 || raw === '1' }
    }
    case 'int':
    case 'money': {
      if (typeof raw === 'string' && raw.trim() === '') return { ok: true, value: null }
      // Strip the separators a person types into a money field. A reader who
      // writes "1,250,000" means a number, and rejecting it teaches them to
      // distrust the form rather than to type differently.
      const cleaned = typeof raw === 'string' ? raw.replace(/[$,\s]/g, '') : raw
      const n = Number(cleaned)
      if (!Number.isFinite(n)) return { ok: false, error: `${column} must be a number` }
      return { ok: true, value: kind === 'int' ? Math.trunc(n) : n }
    }
    case 'uuid': {
      if (typeof raw !== 'string') return { ok: false, error: `${column} must be an id` }
      const trimmed = raw.trim()
      if (!trimmed) return { ok: true, value: null }
      if (!UUID_RE.test(trimmed)) return { ok: false, error: `${column} is not a valid id` }
      return { ok: true, value: trimmed }
    }
    case 'textarray': {
      if (!Array.isArray(raw)) return { ok: false, error: `${column} must be a list` }
      return {
        ok: true,
        value: raw
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
      }
    }
  }
}

/**
 * Turn a request body into a row for `spec.table`, or an error a person can act
 * on.
 *
 * `partial` is the PATCH case: only the keys present are touched, and nothing
 * is required. On a create every `spec.required` column must arrive non-null —
 * which is where "4 staged intake sessions cannot be accepted until a name is
 * typed" comes from on the other side of the app, and is better than a 500.
 */
export function normalizeRegisterPayload(
  spec: RegisterSpec,
  body: Record<string, unknown>,
  opts: { partial?: boolean; author?: string | null } = {}
): NormalizeResult {
  const value: Record<string, unknown> = {}

  for (const [column, kind] of Object.entries(spec.fields)) {
    if (!(column in body)) continue
    const result = coerce(kind, body[column], column)
    if (!result.ok) return { ok: false, error: result.error }

    const allowed = spec.enums?.[column]
    if (allowed && result.value !== null && !allowed.includes(String(result.value))) {
      return { ok: false, error: `${column} must be one of: ${allowed.join(', ')}` }
    }
    value[column] = result.value
  }

  if (!opts.partial) {
    for (const column of spec.required) {
      if (value[column] === undefined || value[column] === null || value[column] === '') {
        return { ok: false, error: `${column.replace(/_/g, ' ')} is required` }
      }
    }
    if (spec.stampAuthor) value.author = opts.author ?? null
  }

  if (Object.keys(value).length === 0) {
    return { ok: false, error: 'Nothing to save' }
  }
  return { ok: true, value }
}

/**
 * Say in words what a Postgres constraint refused, rather than handing a reader
 * an error code.
 *
 * The named constraints here are the ones a person will actually hit, and each
 * message names the FIX rather than the rule. `restrict_violation` is the
 * personnel delete guard, whose RAISE already carries a sentence worth reading —
 * so it is passed through untouched.
 */
export function explainDbError(message: string, code?: string): string {
  if (code === '2BP01' || code === '23503') {
    if (/personnel_note_kinds/.test(message)) {
      return 'That note kind still has notes filed under it, so it cannot be deleted. Mark it inactive instead — the history keeps its label.'
    }
    if (/ownership_interests/.test(message)) {
      return 'That entity holds ownership of record and cannot be removed. Close the ownership interests first, which keeps them in the register.'
    }
    return 'Something else references this record, so it cannot be removed.'
  }
  if (code === '23514' || /violates check constraint/.test(message)) {
    if (/personnel_separation_complete/.test(message)) {
      return 'A separation needs both a date and a type — one without the other is half a record.'
    }
    if (/personnel_hold_reason/.test(message)) {
      return 'A legal hold needs a reason. A hold nobody can explain cannot be lifted with confidence either.'
    }
    if (/resolutions_consent_has_no_meeting/.test(message)) {
      return 'A written consent is an action taken WITHOUT a meeting, so it cannot cite one. Record it as a resolution if it was adopted at a meeting.'
    }
    if (/resolutions_signed_has_date/.test(message)) {
      return 'Mark a resolution signed only with the date it was signed.'
    }
    if (/org_roles_end_reason/.test(message)) {
      return 'An end reason needs an end date.'
    }
    if (/org_roles_date_order|ownership_date_order|personnel_separation_order|personnel_agreements_dates/.test(message)) {
      return 'The end date is before the start date.'
    }
    if (/conflict_disclosures_described/.test(message)) {
      return 'A disclosure that reports a conflict needs to say what it is.'
    }
    if (/ownership_percent_range/.test(message)) {
      return 'A percentage has to be between 0 and 100.'
    }
    return 'That combination of values is not allowed.'
  }
  if (code === '23505' || /duplicate key/.test(message)) {
    if (/uq_resolutions_reference/.test(message)) {
      return 'Another resolution for that entity already uses this reference number.'
    }
    if (/uq_conflict_annual/.test(message)) {
      return 'This person already has an annual disclosure on file for that period. Edit it, or record an update instead.'
    }
    if (/uq_personnel_open_party/.test(message)) {
      return 'That contact already has an open engagement. Close it before opening another.'
    }
    if (/policies_name_version_key/.test(message)) {
      return 'That policy already exists at that version.'
    }
    if (/personnel_offboarding_personnel_id_label_key/.test(message)) {
      return 'That step is already on this checklist.'
    }
    if (/uq_policy_ack/.test(message)) {
      return 'That acknowledgement is already recorded for the same person and date.'
    }
    if (/personnel_note_kinds_key_key/.test(message)) {
      return 'There is already a note kind with that key.'
    }
    return 'A record with those details already exists.'
  }
  return message
}
