/**
 * Every vehicle Ber Wilson is in, across every deal.
 *
 * ⚠ WHY A CROSS-PORTFOLIO READ EXISTS AT ALL. `loadProjectSpvs` answers "what
 * is this deal held in", which is the right question from inside a project and
 * the wrong one at fifty of them. Nothing answered "every vehicle we are in" or
 * "how much capital is committed across all of them" — the two questions a
 * portfolio of fifty deals is actually steered by — and a half-entered cap
 * table surfaced only to whoever happened to open that one project's tab.
 *
 * ⚠ CONTAINMENT IS APPLIED HERE, NOT BY THE CALLER. A confidential project
 * leaves every cross-portfolio surface, and this is one (CLAUDE.md §8, §12 — a
 * security filter belongs at the choke point as a default, not as a parameter
 * every caller passes). `hiddenProjectIds` takes the viewer explicitly so a
 * cron that forgets to pass one gets the SAFE answer; the vehicles of a hidden
 * project are dropped whole, and the COUNT of what was dropped is reported so
 * a total over 50 deals never silently covers 44.
 */

import { hiddenProjectIds } from '@/lib/security/confidential'
import { summarizePipeline, type VehiclePipeline } from './ownership'
import { RECORD_BASE_PATH, type RecordKind } from '@/lib/records/scope'
import { num, spvDb, type ProjectSpvRow, type SpvParticipantRow } from './db'
import { toParticipant, toProjectSpv } from './queries'
import type { ProjectSpv } from './types'

export type { VehiclePipeline }

const PAGE = 1000

/** A vehicle plus the deal it belongs to. */
export interface PortfolioVehicle {
  spv: ProjectSpv
  deal: {
    kind: RecordKind
    id: string
    name: string
    /** The deal's own page. `/projects/<id>` or `/opportunities/<id>`. */
    href: string
  }
  /** The raise pipeline against this vehicle — NEVER summed with the ledger. */
  pipeline: VehiclePipeline
}

interface InvestmentRow {
  id: string
  spv_id: string | null
  investor_id: string
  stage: string
  amount_indicated: string | number | null
  amount_committed: string | number | null
  amount_funded: string | number | null
}

/**
 * Every vehicle on every deal this viewer may see.
 *
 * Sorted newest-deal-first is deliberately NOT the order: a portfolio index is
 * read by deal, so vehicles are grouped by their deal's name and then by the
 * sort order within it.
 */
export async function loadPortfolioVehicles(
  authUserId?: string | null
): Promise<{ vehicles: PortfolioVehicle[]; hiddenDeals: number }> {
  const db = spvDb()

  const { data: spvRows, error } = await db
    .from('project_spvs')
    .select('*')
    .order('sort_order', { ascending: true })
    .limit(PAGE)
  // ⚠ THROWS. An empty array would read as "Ber Wilson is in no vehicles" while
  // reporting nothing anywhere, which is the failure this codebase has hit most
  // often (§12 — a zero from a broken query and a zero from an empty table are
  // the same number on screen).
  if (error) throw new Error(`Could not load project_spvs: ${error.message}`)

  const rows = (spvRows ?? []) as ProjectSpvRow[]
  if (rows.length === 0) return { vehicles: [], hiddenDeals: 0 }

  const hidden = await hiddenProjectIds(authUserId ?? null)
  const visible = rows.filter((r) => !(r.project_id && hidden.has(r.project_id)))
  const hiddenDeals = new Set(
    rows.filter((r) => r.project_id && hidden.has(r.project_id)).map((r) => r.project_id!)
  ).size
  if (visible.length === 0) return { vehicles: [], hiddenDeals }

  const projectIds = [...new Set(visible.map((r) => r.project_id).filter(isId))]
  const opportunityIds = [...new Set(visible.map((r) => r.opportunity_id).filter(isId))]
  const spvIds = visible.map((r) => r.id)

  const [participants, projects, opportunities, investments] = await Promise.all([
    select<SpvParticipantRow>(
      db
        .from('project_spv_participants')
        .select('*')
        .in('spv_id', spvIds)
        .order('sort_order', { ascending: true })
        .limit(PAGE),
      'project_spv_participants'
    ),
    projectIds.length > 0
      ? select<{ id: string; name: string }>(
          db.from('projects').select('id,name').in('id', projectIds).limit(PAGE),
          'projects'
        )
      : Promise.resolve([]),
    opportunityIds.length > 0
      ? select<{ id: string; name: string }>(
          db.from('opportunities').select('id,name').in('id', opportunityIds).limit(PAGE),
          'opportunities'
        )
      : Promise.resolve([]),
    select<InvestmentRow>(
      db
        .from('investments')
        .select('id,spv_id,investor_id,stage,amount_indicated,amount_committed,amount_funded')
        .in('spv_id', spvIds)
        .limit(PAGE),
      'investments'
    ),
  ])

  const bySpv = new Map<string, SpvParticipantRow[]>()
  for (const row of participants) push(bySpv, row.spv_id, row)
  const investmentsBySpv = new Map<string, InvestmentRow[]>()
  for (const row of investments) if (row.spv_id) push(investmentsBySpv, row.spv_id, row)

  const dealNames = new Map<string, string>()
  for (const p of projects) dealNames.set(p.id, p.name)
  for (const o of opportunities) dealNames.set(o.id, o.name)

  const vehicles: PortfolioVehicle[] = visible.map((row) => {
    const parts = (bySpv.get(row.id) ?? []).map(toParticipant)
    const kind: RecordKind = row.project_id ? 'project' : 'opportunity'
    const dealId = row.project_id ?? row.opportunity_id ?? ''
    return {
      spv: toProjectSpv(row, parts),
      deal: {
        kind,
        id: dealId,
        // A deal whose name could not be read is named as unknown rather than
        // blank: a bare gap reads as a failed render (§12).
        name: dealNames.get(dealId) ?? 'Unnamed deal',
        href: `${RECORD_BASE_PATH[kind]}/${dealId}`,
      },
      pipeline: summarizePipeline(toCommitments(investmentsBySpv.get(row.id) ?? []), parts),
    }
  })

  vehicles.sort(
    (a, b) =>
      a.deal.name.localeCompare(b.deal.name) || a.spv.sortOrder - b.spv.sortOrder
  )
  return { vehicles, hiddenDeals }
}

/** One line per vehicle for a picker: "Delta LandCo — Delta Industrial Campus". */
export interface VehicleOption {
  id: string
  label: string
  dealName: string
}

export interface VehicleRef {
  label: string
  dealName: string
  dealHref: string
}

/**
 * Both shapes a screen needs, from ONE read.
 *
 * ⚠ THE INVESTOR PAGE NEEDS THE PICKER AND THE ROW LABELS AT ONCE, and calling
 * `listVehicleOptions` and `resolveVehicleRefs` beside each other ran the whole
 * five-query portfolio read twice for one page. A caller that wants both asks
 * once; the two wrappers below stay for callers that genuinely want one.
 */
export async function loadVehicleDirectory(
  spvIds: readonly string[],
  authUserId?: string | null
): Promise<{ options: VehicleOption[]; refs: Map<string, VehicleRef> }> {
  const { vehicles } = await loadPortfolioVehicles(authUserId)
  const wanted = new Set(spvIds.filter(isId))

  const options: VehicleOption[] = []
  const refs = new Map<string, VehicleRef>()
  for (const v of vehicles) {
    options.push({ id: v.spv.id, label: v.spv.label, dealName: v.deal.name })
    if (wanted.has(v.spv.id)) {
      refs.set(v.spv.id, {
        label: v.spv.label,
        dealName: v.deal.name,
        dealHref: v.deal.href,
      })
    }
  }
  return { options, refs }
}

/**
 * Vehicles a commitment can be pointed at.
 *
 * ⚠ CONTAINMENT APPLIES TO A PICKER TOO. A dropdown listing "Myton Data Center
 * LLC — <confidential deal>" discloses the deal to anyone who opens the form,
 * which is the whole thing `confidential` exists to prevent.
 */
export async function listVehicleOptions(
  authUserId?: string | null
): Promise<VehicleOption[]> {
  return (await loadVehicleDirectory([], authUserId)).options
}

/**
 * Display detail for vehicles named by id — the investor page's rows.
 *
 * A separate read rather than a PostgREST embed because `project_spvs` is
 * deliberately absent from the generated types (§4), so an embed through the
 * typed client cannot be typechecked. Returns a Map so a caller with no match
 * renders the absence rather than an empty string.
 */
export async function resolveVehicleRefs(
  spvIds: readonly string[],
  authUserId?: string | null
): Promise<Map<string, VehicleRef>> {
  // ⚠ THE EARLY RETURN IS NOT AN OPTIMISATION, IT IS WHAT KEEPS THIS CHEAP ON
  // THE COMMON PAGE. Most investors have no vehicle-targeted commitment at all,
  // and without this every investor page would run the whole portfolio read to
  // answer a question about nothing.
  if (spvIds.filter(isId).length === 0) return new Map()
  return (await loadVehicleDirectory(spvIds, authUserId)).refs
}

/**
 * PostgREST rows into the shape the PURE summarizer takes.
 *
 * ⚠ THE COERCION LIVES HERE AND THE ARITHMETIC LIVES IN ownership.ts, which is
 * the same split the rest of this module keeps: that file loads with no
 * database and no environment, so `npm test` and the verification scripts can
 * exercise it (CLAUDE.md §12 — a shared lib no script can load is one nothing
 * can verify). `num` returns null for absent, NEVER 0.
 */
function toCommitments(rows: readonly InvestmentRow[]) {
  return rows.map((row) => ({
    investorId: row.investor_id,
    indicated: num(row.amount_indicated),
    committed: num(row.amount_committed),
    funded: num(row.amount_funded),
  }))
}

function isId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** A select that reports its own failure instead of returning a silent []. */
async function select<T>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  table: string
): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(`Could not load ${table}: ${error.message}`)
  return (data ?? []) as T[]
}

/**
 * Refuse a commitment pointed at a vehicle that does not exist.
 *
 * ⚠ WITHOUT THIS THE READER GETS A RAW `23503`. The FK does protect the data,
 * but a foreign-key message surfaced through a route reads as a platform fault
 * rather than "that vehicle is gone" — and the usual cause is a form left open
 * while the vehicle was renamed or removed on another screen.
 *
 * Returns null when there is nothing to check: a commitment into the parent
 * company or a whole project carries no vehicle, which is the normal case.
 */
export async function vehicleTargetError(spvId: unknown): Promise<string | null> {
  if (typeof spvId !== 'string' || !spvId) return null

  const { data, error } = await spvDb()
    .from('project_spvs')
    .select('id')
    .eq('id', spvId)
    .maybeSingle()
  if (error) return `Could not check the vehicle: ${error.message}`
  if (!data) {
    return 'That vehicle no longer exists. Pick another, or target the project as a whole.'
  }
  return null
}

/**
 * The raise pipeline against each of these vehicles, for a single deal's tab.
 *
 * ⚠ IT IS HANDED BACK SEPARATELY FROM THE LEDGER AND MUST STAY THAT WAY. The
 * same dollar can legitimately sit in both — an investor still in discussion who
 * is already on the cap table — so a screen that adds them reports a raise twice
 * the size of the one being run. Named apart, shown apart, never summed (§12,
 * one quantity one definition).
 */
export async function loadVehiclePipelines(
  spvs: readonly { id: string; participants: readonly { investorId: string | null }[] }[]
): Promise<Record<string, VehiclePipeline>> {
  if (spvs.length === 0) return {}

  const rows = await select<InvestmentRow>(
    spvDb()
      .from('investments')
      .select('id,spv_id,investor_id,stage,amount_indicated,amount_committed,amount_funded')
      .in('spv_id', spvs.map((s) => s.id))
      .limit(PAGE),
    'investments'
  )

  const bySpv = new Map<string, InvestmentRow[]>()
  for (const row of rows) if (row.spv_id) push(bySpv, row.spv_id, row)

  const out: Record<string, VehiclePipeline> = {}
  for (const spv of spvs) {
    out[spv.id] = summarizePipeline(toCommitments(bySpv.get(spv.id) ?? []), spv.participants)
  }
  return out
}

/**
 * The vehicles that belong to a project this viewer must not see.
 *
 * ⚠ THIS EXISTS BECAUSE `investments.spv_id` BROKE AN EXISTING CONTAINMENT
 * FILTER WITHOUT TOUCHING IT. Every outbound surface drops rows by
 * `project_id` — `dropHidden(rows, r => r.project_id, hidden)` in the daily
 * brief, Pepper and the digests. An spv-targeted commitment has `project_id`
 * NULL by design, so it passed straight through a filter that had been correct
 * for every other row shape, and a protected deal's committed capital would
 * have reached a SENT email. Adding a nullable pointer to a table that is
 * filtered by a different pointer is the whole bug class: the rule was applied
 * to one target kind and silently not the other.
 *
 * So: resolve the vehicles once, hand back a Set, and let the caller drop on
 * EITHER pointer. `authUserId` is explicit for the same reason
 * `hiddenProjectIds` makes it explicit — a cron has nobody to step up, so the
 * caller that forgets to pass one gets the safe answer (§12).
 *
 * ⚠ A VEHICLE ON AN OPPORTUNITY IS NEVER HIDDEN. Only a project carries
 * `confidential`; an opportunity has no such flag, and pretending otherwise
 * would withhold records nobody asked to protect.
 */
export async function hiddenVehicleIds(
  authUserId?: string | null
): Promise<Set<string>> {
  const hidden = await hiddenProjectIds(authUserId ?? null)
  if (hidden.size === 0) return new Set()

  const { data, error } = await spvDb()
    .from('project_spvs')
    .select('id,project_id')
    .not('project_id', 'is', null)
    .limit(PAGE)
  if (error) {
    // ⚠ FAIL CLOSED IS NOT AN OPTION HERE AND NEITHER IS FAIL OPEN, SO IT
    // THROWS. An empty Set would let a protected deal's figures into an email;
    // a Set whose `has()` always answers true would hand a disclosure to any
    // caller that writes `if (hidden.size)` (§12, 09-30). A thrown error stops
    // the cron, which is the only honest outcome.
    throw new Error(`Could not resolve protected vehicles: ${error.message}`)
  }

  const out = new Set<string>()
  for (const row of (data ?? []) as { id: string; project_id: string | null }[]) {
    if (row.project_id && hidden.has(row.project_id)) out.add(row.id)
  }
  return out
}
