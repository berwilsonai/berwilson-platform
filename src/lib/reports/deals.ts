/**
 * The deal register every report reads from.
 *
 * ── WHY ONE READ ─────────────────────────────────────────────────────────────
 * Four of the five reports are "every deal, with something attached", and §12
 * has two rules pointing the same way: *"A PREDICATE TRANSCRIBED INTO ITS
 * READERS HAS A HOME PER READER, AND THE ONE THAT LIES TO YOU IS FOUND LAST"*,
 * and *"never fork a shared pass"*. If each builder selected its own deals,
 * four of them would eventually disagree about how many deals there are — and
 * the one that forgot to drop confidential projects would be found last of all.
 *
 * So the register is read once, here, and the builders take it as an argument.
 *
 * ── THE ONE SECURITY DECISION THIS MODULE MAKES ──────────────────────────────
 * ⚠ A CONFIDENTIAL PROJECT IS NEVER IN A REPORT, FOR ANY READER, STEP-UP OR
 * NOT. CLAUDE.md §4 says containment applies to everyone including both admins
 * and that the project leaves every cross-portfolio surface and every OUTBOUND
 * channel; a report is both, and a PDF of it is a file that walks out of the
 * building. §12 adds the rule that decides the shape: *"Containment and access
 * are different questions, and only one can be unlocked"* — a step-up opens
 * that project's own pages, it does not put the deal back into a portfolio
 * total. So this filters on `confidentialProjectIds()`, which is the absolute
 * list, and NOT on `viewerHiddenProjectIds()`, which would let an unlocked
 * admin export one by accident.
 *
 * ⚠ AND THE COUNT COMES BACK. §12: withholding means handing over the COUNT of
 * what was withheld, and the count cannot be derived after the fact. A report
 * reading "34 deals" when the portfolio holds 35 is confidently wrong; one
 * reading "34 deals · 1 protected deal withheld" is correct and says so.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { confidentialProjectIds } from '@/lib/security/confidential'
import type { DealStage } from '@/lib/supabase/types'
import { isDealStage } from '@/lib/utils/constants'
import type { PhaseRow } from '@/lib/records/power-read'
import { readPhaseRows } from '@/lib/records/power-read'

/**
 * A project and an opportunity, as one row.
 *
 * ⚠ THE TWO TABLES ARE NOT THE SAME SHAPE AND THIS DOES NOT PRETEND THEY ARE.
 * Only `projects` carries a hierarchy, a bid date or a win probability; only
 * `opportunities` carries a counterparty and a next step. Each is nullable
 * here, and the kind is on the row, so a column that applies to one half can
 * say so rather than printing an em dash down eleven rows (§12: a bare em dash
 * at a value's own weight reads as a failed render).
 */
export interface DealRow {
  id: string
  kind: 'project' | 'opportunity'
  name: string
  stage: DealStage
  status: string | null
  sector: string | null
  location: string | null
  /** Who the deal is with — `client_entity` on a project, `counterparty` on an opportunity. */
  client: string | null
  estimatedValue: number | null
  /** Projects only. Null on an opportunity, which has no hierarchy column. */
  parentProjectId: string | null
  /** Projects only — the band behind `WIN_BAND_VALUE`. */
  winProbability: number | null
  bidDueDate: string | null
  /** The date the deal is aiming at: substantial completion, or an opportunity's target close. */
  targetDate: string | null
  /** Projects only, internal: who is running capture. */
  captureLead: string | null
  dataRoomTemplate: string | null
  driveFolderId: string | null
  updatedAt: string | null
  createdAt: string | null
  href: string
}

export interface DealRegister {
  deals: DealRow[]
  /** Phase rows for every deal above, ready for `phaseLookup`. */
  phases: PhaseRow[]
  /** Confidential projects kept out. Printed, never silently dropped. */
  withheld: number
  /**
   * Every deal in the shape the roll-up arithmetic takes.
   *
   * ⚠ IT HOLDS OPPORTUNITIES TOO, AND THE VERSION THAT DID NOT WAS A LIVE BUG.
   * This was `projects` only, so `portfolioPower` and `portfolioTotal` ran over
   * 23 leaves while the report's own header said 35 deals — a page reading
   * "35 deals" above a tile reading "2 of 23 priced", which is §12's opening
   * rule broken in the first screenshot: one quantity, one definition, or the
   * reader trusts none of them. Found by rendering the page, not by `tsc`, the
   * suite or any unit test — all of which were green.
   *
   * An opportunity is always a root AND a leaf (the table has no parent
   * column), so adding them changes no hierarchy arithmetic; it only stops the
   * denominators lying.
   */
  rollupSet: { id: string; parent_project_id: string | null; estimated_value: number | null }[]
}

/**
 * PostgREST truncates at 1000 rows silently (§12). Thirty-five deals is not
 * near it, and the explicit range is here so that stays true by assertion
 * rather than by luck — a report that quietly stops at a thousand deals is a
 * report nobody can tell is wrong.
 */
const ROW_CAP = 2000

const PROJECT_COLUMNS =
  'id, name, stage, status, sector, location, client_entity, estimated_value, parent_project_id, ' +
  'win_probability, bid_due_date, substantial_completion_date, capture_lead, data_room_template, ' +
  'drive_folder_id, updated_at, created_at, confidential'

const OPPORTUNITY_COLUMNS =
  'id, name, stage, status, sector, location, counterparty, target_name, estimated_value, ' +
  'probability, target_close_date, data_room_template, drive_folder_id, updated_at, created_at'

interface ProjectSelect {
  id: string
  name: string
  stage: string
  status: string | null
  sector: string | null
  location: string | null
  client_entity: string | null
  estimated_value: number | string | null
  parent_project_id: string | null
  win_probability: number | null
  bid_due_date: string | null
  substantial_completion_date: string | null
  capture_lead: string | null
  data_room_template: string | null
  drive_folder_id: string | null
  updated_at: string | null
  created_at: string | null
  confidential: boolean
}

interface OpportunitySelect {
  id: string
  name: string
  stage: string
  status: string | null
  sector: string | null
  location: string | null
  counterparty: string | null
  target_name: string | null
  estimated_value: number | string | null
  probability: number | null
  target_close_date: string | null
  data_room_template: string | null
  drive_folder_id: string | null
  updated_at: string | null
  created_at: string | null
}

/**
 * ⚠ A `numeric` COLUMN COMES BACK FROM POSTGREST AS A STRING. `power.ts`
 * carries the same note for the same reason: the version of this that assumed
 * `number` would have concatenated two values rather than adding them, and the
 * result looks like a plausible figure.
 */
function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * ⚠ A STAGE OFF THE DATABASE IS VALIDATED, NOT CAST. Both columns are
 * `deal_stage` NOT NULL so this can only fail if the enum gains a member the
 * app has not been rebuilt for — in which case falling back to `prospecting`
 * puts the deal in the wrong lane silently. Returning null drops it from the
 * stage grouping and the report says how many it could not place.
 */
function stageOf(value: string): DealStage | null {
  return isDealStage(value) ? value : null
}

/** Every deal in the portfolio, protected ones removed and counted. */
export async function readDealRegister(): Promise<DealRegister> {
  const supabase = createAdminClient()

  const [{ data: projectRows, error: projectError }, { data: opportunityRows, error: opportunityError }, protectedIds] =
    await Promise.all([
      supabase.from('projects').select(PROJECT_COLUMNS).order('name').range(0, ROW_CAP - 1),
      supabase.from('opportunities').select(OPPORTUNITY_COLUMNS).order('name').range(0, ROW_CAP - 1),
      confidentialProjectIds(),
    ])

  if (projectError) throw new Error(`Report could not read projects: ${projectError.message}`)
  if (opportunityError) {
    throw new Error(`Report could not read opportunities: ${opportunityError.message}`)
  }

  const projects = (projectRows ?? []) as unknown as ProjectSelect[]
  const opportunities = (opportunityRows ?? []) as unknown as OpportunitySelect[]

  /*
   * ⚠ BOTH SOURCES OF TRUTH, BECAUSE EITHER ALONE CAN FAIL OPEN.
   * `confidentialProjectIds()` returns null when its own read failed, and the
   * `confidential` column travels on the row. Trusting only the list would
   * export every protected deal on a read error; trusting only the column
   * would miss one whose row this select somehow reached before the flag. The
   * union of the two is the containment answer, and containment takes the
   * absolute answer with no opt-out (§12).
   */
  const hidden = new Set(protectedIds ?? [])
  for (const project of projects) {
    if (project.confidential) hidden.add(project.id)
  }

  const visibleProjects = projects.filter((project) => !hidden.has(project.id))
  const withheld = projects.length - visibleProjects.length

  const deals: DealRow[] = [
    ...visibleProjects.map((row): DealRow | null => {
      const stage = stageOf(row.stage)
      if (!stage) return null
      return {
        id: row.id,
        kind: 'project',
        name: row.name,
        stage,
        status: row.status,
        sector: row.sector,
        location: row.location,
        client: row.client_entity,
        estimatedValue: num(row.estimated_value),
        parentProjectId: row.parent_project_id,
        winProbability: row.win_probability,
        bidDueDate: row.bid_due_date,
        targetDate: row.substantial_completion_date,
        captureLead: row.capture_lead,
        dataRoomTemplate: row.data_room_template,
        driveFolderId: row.drive_folder_id,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        href: `/projects/${row.id}`,
      }
    }),
    ...opportunities.map((row): DealRow | null => {
      const stage = stageOf(row.stage)
      if (!stage) return null
      return {
        id: row.id,
        kind: 'opportunity',
        name: row.name,
        stage,
        status: row.status,
        sector: row.sector,
        location: row.location,
        // `counterparty` is who we are across the table from; `target_name` is
        // what is being acquired. Either answers "who is this with", and the
        // first is the better answer when both are present.
        client: row.counterparty ?? row.target_name,
        estimatedValue: num(row.estimated_value),
        parentProjectId: null,
        winProbability: row.probability,
        bidDueDate: null,
        targetDate: row.target_close_date,
        captureLead: null,
        dataRoomTemplate: row.data_room_template,
        driveFolderId: row.drive_folder_id,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        href: `/opportunities/${row.id}`,
      }
    }),
  ].filter((deal): deal is DealRow => deal !== null)

  const phases = await readPhaseRows(deals.map((deal) => deal.id))

  return {
    deals,
    phases,
    withheld,
    /*
     * ⚠ IT CARRIES THE WHOLE SET, INCLUDING PARENTS THAT ARE THEMSELVES DEALS.
     * `portfolioPower` and `portfolioTotal` both judge a "root" by whether its
     * parent is PRESENT IN THE SAME SET rather than by the column being null,
     * precisely so a filtered set holding a child whose parent was withheld
     * still totals that child. Handing them the full list keeps that correct.
     */
    rollupSet: deals.map((deal) => ({
      id: deal.id,
      parent_project_id: deal.parentProjectId,
      estimated_value: deal.estimatedValue,
    })),
  }
}

/** "34 deals · 1 protected deal withheld", or just the first half. */
export function registerCoverage(register: DealRegister): string {
  const n = register.deals.length
  const base = `${n} deal${n === 1 ? '' : 's'} — ${register.deals.filter((d) => d.kind === 'project').length} projects, ${register.deals.filter((d) => d.kind === 'opportunity').length} opportunities`
  if (register.withheld === 0) return base
  return `${base}. ${register.withheld} protected deal${register.withheld === 1 ? '' : 's'} withheld from this report.`
}
