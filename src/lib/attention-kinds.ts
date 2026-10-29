/**
 * The attention registry, and nothing that touches a database.
 *
 * ⚠ ITS OWN MODULE BECAUSE A CLIENT COMPONENT READS IT. `attention.ts` imports
 * the service-role Supabase client and the leads client; importing the registry
 * from there would drag all of that into the browser bundle. §12 states the
 * mirror of this rule (a helper shared with a server page must not live in a
 * `'use client'` file) and the same reasoning runs the other way.
 */

/**
 * What a reader can DO to a row of this kind, without leaving the list.
 *
 * ⚠ ONLY WHERE THE VERB IS HONEST, AND NULL RENDERS NO BUTTON RATHER THAN A
 * DEAD ONE. Four of the ten kinds carry a row that can be deleted — a task, a
 * lead, a diligence item, a compliance item — and each deletes through the
 * route that already owns it, so the record-level guard, the enum checks and
 * the `activity_log` attribution are the ones that surface already has. The
 * other six have no such verb: a milestone and a cross-project dependency are
 * real records a triage screen has no business destroying, `stale_waiting` and
 * `stale_decision` are entries inside an `updates` jsonb array with no row of
 * their own at all, and an investor going cold is DERIVED from a record nobody
 * would delete to quieten a list. Those six get Dismiss, which every kind gets.
 */
export interface AttentionSource {
  /** The route that owns this row. DELETE here; its own guard applies. */
  endpoint: (rowId: string) => string
  /** What the confirmation calls the thing, in the reader's words. */
  noun: string
}

/**
 * THE REGISTRY OF ATTENTION KINDS. One row per thing that can need you.
 *
 * ⚠ EVERYTHING KEYED BY KIND DERIVES FROM HERE — the category union, the
 * summary's field names, the counts, and the filter chips on /attention. It
 * used to be three hand-written lists: a union of ten strings, eleven lines
 * building the summary, and (had the UI existed) a third in the component. §12
 * records exactly this shape twice over — a hand-written enumeration beside a
 * registry drifts, and `/decide` shipped a kind that got a count and no chip
 * because of it. A new kind added here appears everywhere or nowhere.
 *
 * ⚠ THERE IS DELIBERATELY NO `counted` FLAG HERE. What the sidebar badge sums
 * is a separate and narrower question, and `COUNTED_ATTENTION_KINDS` below
 * already answers it — in the badge's own vocabulary, which is NOT this one:
 * the badge's `overdue_milestone` is this registry's `approaching_milestone`
 * read at a tighter threshold, and `expiring_compliance` here reads
 * `compliance_items` (a project child) while `expiring_certification` reads
 * `certifications` (a company record). Two near-identical names over two
 * different tables, kept apart on purpose and never summed.
 *
 * ⚠ WHAT CHANGED ON 10-29: every quantity the badge counts now HAS a kind here.
 * It did not before — `certifications` was counted and unrepresented — and the
 * consequence was not theoretical. The dashboard grew its own eight-query
 * attention list partly to show the certs this engine could not produce, and
 * that second list then drifted far enough to re-admit inbound leads three days
 * after the note below removed them.
 *
 * `label` is what a reader sees. `tone` comes from src/lib/ui/tone.ts, so the
 * chips cannot invent a colour.
 */
export const ATTENTION_KINDS = [
  {
    category: 'overdue_action',        summaryKey: 'overdue_actions',        label: 'Overdue tasks',        tone: 'critical',
    idPrefixes: ['task-'],             rowTable: 'tasks',
    deletable: { endpoint: (id: string) => `/api/tasks/${id}`, noun: 'task' },
  },
  {
    category: 'critical_dd',           summaryKey: 'critical_dd',            label: 'Critical diligence',   tone: 'critical',
    idPrefixes: ['dd-'],               rowTable: 'dd_items',
    deletable: { endpoint: (id: string) => `/api/records/dd-items/${id}`, noun: 'diligence item' },
  },
  {
    category: 'approaching_milestone', summaryKey: 'approaching_milestones', label: 'Milestones',           tone: 'caution',
    idPrefixes: ['milestone-'],        rowTable: 'milestones',
    // Deliberately not deletable. `CHILDREN.milestones` in
    // src/lib/records/children.ts withholds DELETE too, for the same reason:
    // a dated milestone is the record of a commitment, and the registry does
    // not grant a destructive verb nothing asked for (§11).
    deletable: null,
  },
  {
    category: 'expiring_compliance',   summaryKey: 'expiring_compliance',    label: 'Compliance',           tone: 'caution',
    idPrefixes: ['comp-'],             rowTable: 'compliance_items',
    deletable: { endpoint: (id: string) => `/api/records/compliance-items/${id}`, noun: 'compliance item' },
  },
  {
    /*
      ⚠ ADDED 2026-10-29, AND IT CLOSES A GAP THE DOCBLOCK BELOW USED TO
      DESCRIBE AS DELIBERATE. `countAttention()` has always head-counted
      `certifications` as one of its four quantities, while this registry had
      no kind reading that table — so the badge counted a quantity the engine
      could not produce an item for, and the only surface that ever SHOWED an
      expiring cert was the dashboard's own parallel rail. The rail is gone
      (10-29) and the engine is the one producer, so the kind has to exist here
      or the number in the chrome names rows no list can render.

      ⚠ STILL NOT THE SAME THING AS `expiring_compliance`, AND NEVER SUMMED
      WITH IT. That kind reads `compliance_items`, a project child. This one
      reads `certifications`, a COMPANY record with no project at all — which
      is also why nothing dismisses or withholds it: there is no project_id to
      contain it by.
    */
    category: 'expiring_certification', summaryKey: 'expiring_certifications', label: 'Certifications', tone: 'critical',
    idPrefixes: ['cert-'],             rowTable: 'certifications', deletable: null,
  },
  {
    category: 'stale_waiting',         summaryKey: 'stale_waiting',          label: 'Waiting on someone',   tone: 'caution',
    // ⚠ NO ROW AND THEREFORE NO UUID. The key is
    // `waiting-<update uuid>-<text slice>`: one entry inside an `updates`
    // jsonb array, which is why `rowTable` is null and `attentionRowId()`
    // refuses it rather than handing a caller a mangled id.
    idPrefixes: ['waiting-'],          rowTable: null, deletable: null,
  },
  {
    category: 'stale_decision',        summaryKey: 'stale_decisions',        label: 'Decisions adrift',     tone: 'info',
    idPrefixes: ['decision-'],         rowTable: null, deletable: null,
  },
  {
    category: 'dependency_risk',       summaryKey: 'dependency_risks',       label: 'Dependency risk',      tone: 'critical',
    // A DELETE route exists (`/api/dependencies/[id]`) and is still not offered
    // here: removing a link changes the dependency graph that the project
    // detail page and the timeline both read, which is not what "get this off
    // my screen" means.
    idPrefixes: ['dep-'],              rowTable: 'project_dependencies', deletable: null,
  },
  {
    category: 'investor_followup',     summaryKey: 'investor_followups',     label: 'Investor follow-ups',  tone: 'info',
    // ⚠ TWO PREFIXES, ONE KIND — an overdue next step and an investor going
    // cold are both this category. A single-prefix assumption would have left
    // half of them unparseable, which is why this field is a list.
    idPrefixes: ['investor-next-', 'investor-cold-'], rowTable: 'investors', deletable: null,
  },
  {
    category: 'dino_payment',          summaryKey: 'dino_payments',          label: 'Dino payments',        tone: 'info',
    idPrefixes: ['dino-payment-'],     rowTable: 'dino_payments', deletable: null,
  },
] as const

/*
 * ⚠ `lead_review` WAS REMOVED FROM THIS REGISTRY ON 2026-10-21 AND MUST NOT
 * COME BACK WITHOUT A REASON THAT IS NOT "leads are urgent".
 *
 * It was raised as a question on 10-17 — "/attention now has quick actions; use
 * them for a week, then say whether inbound leads belong there at all" — because
 * 8 of the 10 items on the screen were inbound leads, which are also the Decide
 * queue's entire business. Richard's answer on 10-21 was to fix it.
 *
 * The architectural line is the one this module's own header draws: ATTENTION is
 * work falling through the cracks, DECIDE is inbound work awaiting a call, and
 * the two are never summed. A bid invitation is inbound work awaiting a call by
 * definition — /decide already ranks leads by deadline through `decideWeight`,
 * already shows the bid date on the row, and already carries Accept and Delete.
 * Listing them here as well was one quantity on two screens under two different
 * filters, which is the §12 failure this file exists to prevent.
 *
 * ⚠ AND THE MIDDLE OPTION IS WORSE, WHICH IS WHY IT WAS NOT TAKEN: keeping only
 * leads whose bid closes within three days would have put a THIRD threshold on
 * the same rows (/decide ranks every lead, /attention filtered at 14 days, a
 * tighter gate would make three), so the two screens would disagree about which
 * bids matter and a reader would trust neither.
 */

export type AttentionCategory = (typeof ATTENTION_KINDS)[number]['category']
type AttentionSummaryKey = (typeof ATTENTION_KINDS)[number]['summaryKey']

export function attentionKind(category: AttentionCategory) {
  const k = ATTENTION_KINDS.find((x) => x.category === category)
  if (!k) throw new Error(`Unknown attention category: ${category}`)
  return k
}

/** Derived from the registry: a new kind cannot get a count and no field. */
export type AttentionSummary = { total: number } & Record<AttentionSummaryKey, number>

/**
 * Where an item sends the reader.
 *
 * ⚠ ONLY DESTINATIONS THAT EXIST, AND AN HONEST FALLBACK. Several of these
 * records have no page of their own — a compliance item is a child rendered
 * inside a register, a stale decision lives in an update's jsonb — so the link
 * goes to the nearest page that can actually answer the question rather than to
 * a URL assembled from a table name, which would be a second routing table
 * drifting beside the real one (§12, same call as `/decide`).
 *
 * `projectId` is null for the kinds that are not project children at all
 * (investor, Dino, lead), which is why every arm has to tolerate it.
 */
export function attentionHref(category: AttentionCategory, projectId: string | null): string {
  const onProject = (tab: string) => (projectId ? `/projects/${projectId}/${tab}` : '/projects')
  switch (category) {
    case 'overdue_action':
      return '/tasks'
    case 'critical_dd':
      return onProject('diligence')
    case 'approaching_milestone':
      return onProject('milestones')
    case 'stale_waiting':
    case 'stale_decision':
      return onProject('updates')
    case 'dependency_risk':
      return projectId ? `/projects/${projectId}` : '/projects'
    // Compliance items hang off a project but are read in the company register,
    // which is the only screen that lists them with their due dates.
    case 'expiring_compliance':
      return '/company/compliance'
    // A certification is on the company profile, which is the only screen that
    // shows its issuing body and expiry together.
    case 'expiring_certification':
      return '/company'
    case 'investor_followup':
      return '/investors'
    case 'dino_payment':
      return '/dino'
  }
}

/** Urgency bands. Colour is reserved for what is still actionable (§12). */
export function urgencyBand(urgency: number): 'now' | 'soon' | 'watch' {
  if (urgency >= 75) return 'now'
  if (urgency >= 50) return 'soon'
  return 'watch'
}


/* ── Acting on a row, from the registry ──────────────────────────────────── */

/** How long a dismissal lasts. Richard's call (10-20): two weeks. */
export const ATTENTION_DISMISS_DAYS = 14

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Which kind an item key belongs to, read off its prefix.
 *
 * ⚠ A PREFIX DISCRIMINATOR IS A REGISTRY WITH NO TYPE BEHIND IT (§12). The
 * recording work hit this three switches deep: an unrecognised prefix fell
 * through to a default arm and a whole filing step was skipped in silence. So
 * the prefixes live in the registry above, this is the only thing that reads
 * them, and `attention-kinds.test.ts` asserts every id `computeAttention()`
 * actually produces matches its own category's list — the assertion, not a
 * second hand-written switch.
 *
 * Longest prefix first, so `investor-next-` can never be mistaken for a shorter
 * sibling if one is ever added.
 */
export function attentionCategoryForKey(itemKey: string): AttentionCategory | null {
  let best: { category: AttentionCategory; length: number } | null = null
  for (const kind of ATTENTION_KINDS) {
    for (const prefix of kind.idPrefixes) {
      if (!itemKey.startsWith(prefix)) continue
      if (!best || prefix.length > best.length) {
        best = { category: kind.category, length: prefix.length }
      }
    }
  }
  return best?.category ?? null
}

/**
 * The source row's uuid behind an item key, or null where there is not one.
 *
 * ⚠ IT REFUSES RATHER THAN GUESSES, AND THAT IS THE WHOLE JOB. Two kinds build
 * their key as `<prefix><update uuid>-<text slice>` because the item is an
 * entry inside an `updates` jsonb array with no row of its own: stripping the
 * prefix there yields `<uuid>-Sign the MNDA`, which is not an id and must never
 * be sent to a DELETE. Those kinds declare `rowTable: null`, and anything that
 * is not a bare uuid after the prefix is refused — so a caller cannot reach a
 * route with a mangled id, and `null` means "this kind has no row", which is
 * exactly the question every caller is asking.
 */
export function attentionRowId(itemKey: string): { category: AttentionCategory; table: string; rowId: string } | null {
  const category = attentionCategoryForKey(itemKey)
  if (!category) return null
  const kind = attentionKind(category)
  if (!kind.rowTable) return null
  for (const prefix of kind.idPrefixes) {
    if (!itemKey.startsWith(prefix)) continue
    const rest = itemKey.slice(prefix.length)
    if (!UUID.test(rest)) return null
    return { category, table: kind.rowTable, rowId: rest }
  }
  return null
}

/** The delete route for a kind, or null where deleting is not the honest verb. */
export function attentionDeleteTarget(
  category: AttentionCategory,
  itemKey: string
): { url: string; noun: string } | null {
  const kind = attentionKind(category)
  if (!kind.deletable) return null
  const row = attentionRowId(itemKey)
  if (!row || row.category !== category) return null
  return { url: kind.deletable.endpoint(row.rowId), noun: kind.deletable.noun }
}
