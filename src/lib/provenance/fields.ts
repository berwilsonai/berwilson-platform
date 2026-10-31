import { STAGES, STATUSES } from '@/lib/utils/constants'
import { OPPORTUNITY_ACTIVITY } from '@/lib/utils/opportunities'
/**
 * Which fields an autonomous pass may write, and which it must ask about.
 *
 * ⚠ THIS FILE IS A SECURITY BOUNDARY, NOT A CONVENIENCE. Richard's direction
 * (2026-10-12) is that Pepper updates the CRM without approval — "overwrite
 * anything except something that was human entered and looks like it could be
 * important (partner split percentages and things like that). Those ones just
 * alert that just asks if you can update it."
 *
 * Two things follow, and they are different:
 *
 *   1. A field not named here AT ALL is not writable by her. The curator can
 *      only touch what this registry lists, the same way the governance
 *      registers can only edit their whitelisted columns (§4). A model that
 *      decides for itself which column to update is one typo away from writing
 *      `confidential = false`.
 *
 *   2. Of the fields she can touch, `guarded` ones are protected WHEN A HUMAN
 *      TYPED THEM — she proposes instead of writing. `open` ones she owns:
 *      newest evidence wins, logged and reported each morning.
 *
 * WHAT MAKES A FIELD GUARDED. Not "is it important" — everything on a deal is
 * important. The test that survived contact with the data is: WOULD BEING WRONG
 * HERE COST MONEY OR A LEGAL POSITION, AND WOULD ANYONE NOTICE? That is money,
 * ownership, legally-effective dates, and the judgement calls a human makes by
 * weighing things no email states. Prose, places, contact details and
 * next-steps fail that test: being wrong is visible on sight and costs a reread.
 *
 * ⚠ AND THE ASYMMETRY IS DELIBERATE. A guarded field she CANNOT fill when it is
 * blank would make her useless on a new deal, so blank is always writable
 * whatever the tier — the guard is against REPLACING a person's judgement, not
 * against doing the work. `canWrite` below is where that lives.
 */

/** How much a wrong value costs. See the header for the test. */
export type FieldTier = 'guarded' | 'open'

export interface FieldSpec {
  tier: FieldTier
  /** Shown on the proposal card, so the question reads as a question. */
  label: string
  /**
   * The only values this column accepts, where it is a Postgres enum or a
   * CHECK-backed union.
   *
   * ⚠ NOT DECORATION. §12: a `.eq()`/`.neq()` value that is not in the enum
   * fails the WHOLE query with 22P02 and a NULL row set rather than failing
   * the row — the same is true of a write. One plausible-but-wrong sector from
   * a model would therefore discard every other field on that record's update,
   * silently, and the pass would report having written nothing.
   */
  allowedValues?: readonly string[]
}

/** Live members of `project_sector`, read off the database 2026-10-12. */
export const PROJECT_SECTORS = [
  'government', 'infrastructure', 'real_estate', 'prefab', 'institutional', 'technology', 'health',
] as const

/**
 * ⚠ RE-EXPORTED FROM THE VOCABULARY, NOT RETYPED (10-30).
 *
 * These were two literal `as const` arrays — a third and fourth copy of the
 * stage and status enumerations, in a module whose entire job is to stop an
 * unattended pass writing a value the enum does not hold. They were wrong the
 * moment the enums changed, and `allowedValues` would then have REFUSED every
 * legitimate value while accepting none: the curator would have reported
 * nothing to do, forever, with no error (§12 — a gate nobody can see).
 *
 * `scripts/verify-provenance-registry.mts` checks every entry here against
 * `information_schema` and every enum guard against the live enum members,
 * which is the other half of the same guarantee — verified green on 10-30 for
 * `deal_stage` on BOTH tables.
 *
 * Aliased consts rather than `export … from`, so the two names this module has
 * always published keep working for their callers while the values come from
 * the one registry.
 */
export const PROJECT_STAGES = STAGES
export const PROJECT_STATUSES = STATUSES

/**
 * The whitelist, per table.
 *
 * ⚠ KEPT NARROW ON PURPOSE. Every column added here is one an unattended pass
 * can change at 4am. The ones deliberately ABSENT are worth naming, because
 * their absence is the decision:
 *   - `projects.confidential` — containment. Never machine-written, in either
 *     direction; §12 holds that containment and access must not share a path.
 *   - `projects.estimated_value` / `opportunities.estimated_value` — a deal's
 *     headline figure. A number in an email is a CLAIM about the deal, often
 *     one party's ask, and an unattended pass cannot tell that from a settled
 *     price. ⚠ The three computed `economics_*` columns used to be named here
 *     for the same reason; they were dropped with the calculator on
 *     2026-10-23, which leaves `estimated_value` as the only value column —
 *     so it has to be the one named, or the decision reads as forgotten.
 *
 * ⚠ `project_spv_participants` WAS NAMED HERE — the partner splits, guarded so
 * a blank one could be PROPOSED off an operating agreement. It went with the
 * Vehicles module on 2026-10-23. Nothing replaced it: there is no table of
 * who-holds-what any more, so the curator has nothing to propose a split into.
 */
export const WRITABLE_FIELDS: Record<string, Record<string, FieldSpec>> = {
  projects: {
    description: { tier: 'open', label: 'Description' },
    location: { tier: 'open', label: 'Location' },
    client_entity: { tier: 'open', label: 'Client' },
    win_strategy: { tier: 'open', label: 'Win strategy' },
    solicitation_number: { tier: 'open', label: 'Solicitation number' },
    // ⚠ A REAL POSTGRES ENUM. §12: a value that is not in the enum fails the
    // WHOLE query with 22P02 and a NULL row set, not just the row — so the
    // allowed members live beside the field and `allowedValues` is checked
    // before any write. A model's plausible-sounding "energy" would otherwise
    // take down the update for every other field on the record.
    sector: { tier: 'open', label: 'Sector', allowedValues: PROJECT_SECTORS },
    stage: { tier: 'guarded', label: 'Stage', allowedValues: STAGES },
    status: { tier: 'guarded', label: 'Status', allowedValues: STATUSES },
    win_probability: { tier: 'guarded', label: 'Win probability' },
    bid_due_date: { tier: 'guarded', label: 'Bid due date' },
    estimated_value: { tier: 'guarded', label: 'Estimated value' },
  },
  opportunities: {
    description: { tier: 'open', label: 'Description' },
    location: { tier: 'open', label: 'Location' },
    objective: { tier: 'open', label: 'Objective' },
    thesis: { tier: 'open', label: 'Thesis' },
    target_name: { tier: 'open', label: 'Target' },
    counterparty: { tier: 'open', label: 'Counterparty' },
    // Singular on this table and plural nowhere — checked against the live
    // schema, because the first draft of this registry named four columns
    // that do not exist (`client_name`, `next_steps`, `parties.bio`,
    // `milestones.title`). scripts/verify-provenance-registry.mts now asserts
    // every entry here against information_schema so it cannot drift again.
    next_step: { tier: 'open', label: 'Next step' },
    sector: { tier: 'open', label: 'Sector' },
    // ⚠ TWO COLUMNS SINCE 10-30, and `stage` is the one that moves the deal.
    // `opportunities.status` carried the nine-stage pipeline and now carries
    // active|on_hold behind a CHECK, so a pass writing a pipeline value into
    // it is refused outright (`23514`) — taking the whole update with it.
    stage: { tier: 'guarded', label: 'Stage', allowedValues: STAGES },
    status: { tier: 'guarded', label: 'Status', allowedValues: OPPORTUNITY_ACTIVITY },
    priority: { tier: 'guarded', label: 'Priority' },
    probability: { tier: 'guarded', label: 'Probability' },
    estimated_value: { tier: 'guarded', label: 'Estimated value' },
    target_close_date: { tier: 'guarded', label: 'Target close date' },
    deal_structure: { tier: 'guarded', label: 'Deal structure' },
    ownership_stake: { tier: 'guarded', label: 'Ownership stake' },
  },
  parties: {
    // A rolodex is the clearest case for full autonomy: a title read out of a
    // signature block beats the blank that is there now, and being wrong is
    // obvious to the one person who opens the card.
    title: { tier: 'open', label: 'Title' },
    company: { tier: 'open', label: 'Company' },
    email: { tier: 'open', label: 'Email' },
    phone: { tier: 'open', label: 'Phone' },
    linkedin_url: { tier: 'open', label: 'LinkedIn' },
    relationship_notes: { tier: 'open', label: 'Notes' },
  },
  milestones: {
    label: { tier: 'open', label: 'Milestone' },
    notes: { tier: 'open', label: 'Notes' },
    // A milestone date that moved is the most common thing an email says and
    // the most consequential to get wrong — Steelton's PSA closing moving
    // 17 Oct → 1 Nov is the live example.
    target_date: { tier: 'guarded', label: 'Target date' },
    completed_at: { tier: 'guarded', label: 'Completed' },
  },
}

/** The spec for a field, or null when the curator may not touch it at all. */
export function fieldSpec(table: string, field: string): FieldSpec | null {
  return WRITABLE_FIELDS[table]?.[field] ?? null
}

/**
 * Is this value effectively absent?
 *
 * ⚠ `''` IS BLANK AND 0 IS NOT. §12 records the mirror of this on request
 * bodies: absent means "nobody said", where `''` means "the reader cleared it"
 * — but for the purpose of "may she fill this in", a cleared string and an
 * unset one are the same empty box. A zero, a `false` and a zero-length ARRAY
 * are values somebody chose and are never treated as blank.
 */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

export interface WriteDecision {
  /** Write it, or raise a proposal, or do nothing at all. */
  action: 'write' | 'propose' | 'skip'
  reason: string
}

/**
 * The one rule. Everything autonomous goes through this.
 *
 * Order matters and each branch is a decision Richard made:
 *   - not in the registry        → skip  (she may not touch it)
 *   - unchanged                  → skip  (never log a no-op as work)
 *   - blank                      → write (filling is not overwriting, §12)
 *   - open tier                  → write (newest evidence wins)
 *   - guarded + she wrote it     → write (her own value, her own to revise)
 *   - guarded + a human wrote it → propose
 *   - guarded + nobody knows     → propose (absence reads as human; see the
 *                                  migration header for why that is the safe
 *                                  default and not a pedantry)
 */
export function canWrite(args: {
  table: string
  field: string
  currentValue: unknown
  proposedValue: unknown
  /** From record_field_provenance; null when there is no row for this field. */
  writtenBy: 'human' | 'pepper' | null
}): WriteDecision {
  const spec = fieldSpec(args.table, args.field)
  if (!spec) return { action: 'skip', reason: `${args.table}.${args.field} is not writable` }

  if (sameValue(args.currentValue, args.proposedValue)) {
    return { action: 'skip', reason: 'unchanged' }
  }
  if (isBlank(args.proposedValue)) {
    // She never blanks a field. Clearing a value is a human act — there is no
    // sentence in an email that means "this record should say nothing here".
    return { action: 'skip', reason: 'refusing to clear a value' }
  }
  // ⚠ CHECKED BEFORE THE BLANK BRANCH, so filling an empty enum column cannot
  // sneak an invalid member past the guard either.
  if (spec.allowedValues && !spec.allowedValues.includes(String(args.proposedValue))) {
    return {
      action: 'skip',
      reason: `"${String(args.proposedValue)}" is not a permitted ${args.field} (${spec.allowedValues.join(', ')})`,
    }
  }
  if (isBlank(args.currentValue)) {
    return { action: 'write', reason: 'field was blank' }
  }
  if (spec.tier === 'open') {
    return { action: 'write', reason: 'open field, newest evidence wins' }
  }
  if (args.writtenBy === 'pepper') {
    return { action: 'write', reason: 'guarded, but she wrote the current value' }
  }
  return {
    action: 'propose',
    reason:
      args.writtenBy === 'human'
        ? 'guarded and human-entered'
        : 'guarded with unknown provenance, treated as human',
  }
}

/**
 * Value equality across the shapes a jsonb/text/numeric/date column returns.
 *
 * Dates are the reason this is not `===`: Postgres hands back `2026-11-01` for
 * a date column and `2026-11-01T00:00:00+00:00` for a timestamptz, and a
 * curator comparing the first against the second rewrites the same date every
 * single night and reports it as work (§12: a pass that reports what it did
 * must read before it writes, or it claims work it did not do).
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) {
    return isBlank(a) && isBlank(b)
  }
  const as = String(a).trim()
  const bs = String(b).trim()
  if (as === bs) return true
  const ad = dateOnly(as)
  const bd = dateOnly(bs)
  if (ad && bd) return ad === bd
  // Numeric columns round-trip as strings with varying precision: '4.69' and
  // '4.690' are the same acreage and must not count as a change.
  const an = Number(as)
  const bn = Number(bs)
  if (Number.isFinite(an) && Number.isFinite(bn)) return an === bn
  return as.toLowerCase() === bs.toLowerCase()
}

function dateOnly(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]|$)/.exec(value)
  return m ? m[1] : null
}
