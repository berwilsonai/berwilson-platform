/**
 * The four things this session changed, proved against the real database.
 *
 *   node --no-deprecation --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-deal-flow.mts
 *
 * `npm test` proves the pure rules with no database. This proves the half that
 * only the live stack can answer:
 *
 *   1. A commitment targets a VEHICLE — the new `investments.spv_id` and the
 *      rewritten CHECK accept the three legal shapes and refuse the rest.
 *   2. The raise pipeline and the cap table are read as two quantities, and the
 *      overlap between them is reported rather than summed.
 *   3. A vehicle's documents hang off its legal ENTITY, and the retired/excluded
 *      ones are not counted.
 *   4. The cross-portfolio read names each vehicle's deal, and a confidential
 *      project's vehicles leave it entirely.
 *   5. The program rollup counts each deal once — a parent with children does
 *      not add its own model to theirs.
 *
 * Creates throwaway records and removes everything in a `finally` even when an
 * assertion fails. Follows scripts/verify-spvs.mts.
 */

import { leafRecords, portfolioTotal, rolledPipelineValue } from '@/lib/economics/pipeline'
import { spvDb, spvDbAs } from '@/lib/spvs/db'
import { summarizePipeline } from '@/lib/spvs/ownership'
import { loadVehicleDocuments } from '@/lib/spvs/documents'
import {
  hiddenVehicleIds,
  listVehicleOptions,
  loadPortfolioVehicles,
  loadVehicleDirectory,
  loadVehiclePipelines,
  resolveVehicleRefs,
  vehicleTargetError,
} from '@/lib/spvs/portfolio'
import { loadProjectSpvs } from '@/lib/spvs/queries'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

let failures = 0
function check(label: string, pass: boolean, detail = ''): void {
  if (pass) console.log(`  ${GREEN}✓${OFF} ${label} ${DIM}${detail}${OFF}`)
  else {
    failures += 1
    console.log(`  ${RED}✗${OFF} ${label} ${RED}${detail}${OFF}`)
  }
}

const actor = { id: '00000000-0000-0000-0000-000000000000', email: 'verify@berwilson.com' }
const db = spvDb()
const write = spvDbAs(actor)
const stamp = Date.now()

let parentId: string | null = null
let childId: string | null = null
let secretId: string | null = null
let entityId: string | null = null
let investorId: string | null = null
const docIds: string[] = []

try {
  // ── fixtures ──────────────────────────────────────────────────────────────
  const project = async (name: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await write
      .from('projects')
      .insert({ name: `ZZZ verify deal-flow ${stamp} ${name}`, sector: 'infrastructure', ...extra })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create project ${name}: ${error.message}`)
    return (data as { id: string }).id
  }

  parentId = await project('program', { economics_capture_value: 100_000_000 })
  childId = await project('phase 1', {
    parent_project_id: parentId,
    economics_capture_value: 40_000_000,
  })
  secretId = await project('protected', { confidential: true, economics_capture_value: 7_000_000 })

  const { data: entityRow, error: entityError } = await write
    .from('entities')
    // ⚠ `llc`, NOT `spv`. `entity_type` is an ENUM with seven members and no
    // `spv` among them — an out-of-enum value fails the whole insert (§12), and
    // a Utah SPV is an LLC anyway.
    .insert({ name: `ZZZ Verify LandCo ${stamp} LLC`, entity_type: 'llc' })
    .select('id')
    .single()
  if (entityError) throw new Error(`Could not create the entity: ${entityError.message}`)
  entityId = (entityRow as { id: string }).id

  const { data: investorRow, error: investorError } = await write
    .from('investors')
    .insert({ name: `ZZZ Verify Capital ${stamp}` })
    .select('id')
    .single()
  if (investorError) throw new Error(`Could not create the investor: ${investorError.message}`)
  investorId = (investorRow as { id: string }).id

  const vehicle = async (projectId: string, label: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await write
      .from('project_spvs')
      .insert({ project_id: projectId, label, purpose: 'land', ...extra })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create vehicle ${label}: ${error.message}`)
    return (data as { id: string }).id
  }

  const openVehicle = await vehicle(parentId, `Verify LandCo ${stamp}`, {
    entity_id: entityId,
    raise_target: 20_000_000,
  })
  const secretVehicle = await vehicle(secretId, `Verify SecretCo ${stamp}`)

  // ── 1. a commitment targets a vehicle ─────────────────────────────────────
  console.log(`\n${BOLD}1. An investment targets a vehicle${OFF}`)

  const insertCommitment = async (body: Record<string, unknown>) =>
    write.from('investments').insert({ investor_id: investorId, ...body }).select('id').single()

  const legal = [
    { label: 'the parent company', body: { target_kind: 'company' } },
    { label: 'a whole project', body: { target_kind: 'project', project_id: parentId } },
    { label: 'a vehicle', body: { target_kind: 'spv', spv_id: openVehicle } },
  ]
  const commitmentIds: string[] = []
  for (const { label, body } of legal) {
    const { data, error } = await insertCommitment(body)
    check(`a commitment into ${label} is accepted`, error == null, error?.message ?? '')
    if (data) commitmentIds.push((data as { id: string }).id)
  }

  // ⚠ THE REFUSALS ARE THE POINT. A CHECK that accepts everything is a CHECK
  // that enforces nothing, and this one is what keeps "which deal" single-homed.
  const illegal = [
    { label: 'an spv target with no vehicle', body: { target_kind: 'spv' } },
    {
      label: 'an spv target that ALSO names a project',
      body: { target_kind: 'spv', spv_id: openVehicle, project_id: parentId },
    },
    {
      label: 'a company target that still carries a vehicle',
      body: { target_kind: 'company', spv_id: openVehicle },
    },
    { label: 'a project target with no project', body: { target_kind: 'project' } },
  ]
  for (const { label, body } of illegal) {
    const { error } = await insertCommitment(body)
    check(`${label} is refused`, error != null, error ? '' : 'the database accepted it')
  }

  const { error: goneError } = await write
    .from('investments')
    .insert({ investor_id: investorId, target_kind: 'spv', spv_id: parentId })
  check(
    'a commitment pointed at something that is not a vehicle is refused by the FK',
    goneError != null,
    goneError ? '' : 'the database accepted it'
  )
  check(
    'and the route turns that into a sentence rather than a raw 23503',
    (await vehicleTargetError(parentId)) != null,
    'vehicleTargetError'
  )
  check(
    'a commitment with no vehicle is not checked at all (the normal case)',
    (await vehicleTargetError(null)) == null
  )

  // ── 2. two ledgers, never summed ──────────────────────────────────────────
  console.log(`\n${BOLD}2. The raise pipeline and the cap table stay apart${OFF}`)

  const spvCommitment = commitmentIds[2]
  await write
    .from('investments')
    .update({ stage: 'committed', amount_committed: 5_000_000 })
    .eq('id', spvCommitment)

  const { error: partError } = await write.from('project_spv_participants').insert({
    spv_id: openVehicle,
    holder_name: 'Ber Wilson Corporation',
    is_ber_wilson: true,
    role: 'sponsor',
    equity_pct: 60,
  })
  if (partError) throw new Error(`Could not create the Ber Wilson row: ${partError.message}`)

  const { error: lpError } = await write.from('project_spv_participants').insert({
    spv_id: openVehicle,
    holder_name: 'ZZZ Verify Capital',
    investor_id: investorId,
    role: 'capital_partner',
    equity_pct: 40,
    capital_committed: 5_000_000,
  })
  if (lpError) throw new Error(`Could not create the LP row: ${lpError.message}`)

  const spvs = await loadProjectSpvs('project', parentId)
  const loaded = spvs.find((s) => s.id === openVehicle)
  check('the vehicle loads with both holders', loaded?.participants.length === 2,
    `${loaded?.participants.length ?? 0} holder(s)`)

  const pipelines = await loadVehiclePipelines(spvs)
  const pipeline = pipelines[openVehicle]
  check('the pipeline sees the commitment', pipeline?.committed === 5_000_000,
    `signed ${pipeline?.committed}`)
  check(
    'and reports that the investor is ALREADY on the cap table',
    pipeline?.onCapTable === 1 && pipeline?.investorCount === 1,
    `${pipeline?.onCapTable} of ${pipeline?.investorCount}`
  )
  // ⚠ THE WHOLE REASON THE TWO ARE SEPARATE. The same $5M is in both, so a
  // screen that added them would report a $10M raise that does not exist. The
  // overlap count is what makes that visible instead of plausible.
  check(
    'the same $5M appears in both, which is why the overlap is reported',
    pipeline?.committed === 5_000_000 &&
      loaded?.participants.find((p) => p.investorId === investorId)?.capitalCommitted === 5_000_000
  )
  check(
    'a pipeline with no rows totals null, not 0',
    summarizePipeline([], []).committed === null
  )

  // ⚠ THE EXACT ROW THE "Add to cap table" ROUTE INSERTS. The route is a
  // handler and cannot be imported here, but the shape it writes can be — and
  // the shape is what would 400 silently: `class` and `status` are CHECK
  // constraints, and `equity_pct` is deliberately ABSENT because a dollar
  // commitment is not a percentage. An absent field must be OMITTED, never
  // nulled (§12, 10-06).
  const { data: seamRow, error: seamError } = await write
    .from('project_spv_participants')
    .insert({
      spv_id: openVehicle,
      holder_name: 'ZZZ Seam Partner',
      investor_id: investorId,
      is_ber_wilson: false,
      role: 'capital_partner',
      class: 'membership_units',
      capital_committed: 1_000_000,
      status: 'loi_term_sheet',
      note: 'From the capital raise pipeline (Committed).',
      sort_order: 0,
    })
    .select('id,equity_pct')
    .single()
  check(
    'the row the cap-table button writes is accepted by the database',
    seamError == null,
    seamError?.message ?? ''
  )
  check(
    'and its equity split lands UNDETERMINED rather than 0',
    (seamRow as { equity_pct: number | null } | null)?.equity_pct == null,
    `${(seamRow as { equity_pct: number | null } | null)?.equity_pct}`
  )
  if (seamRow) {
    await write.from('project_spv_participants').delete().eq('id', (seamRow as { id: string }).id)
  }

  // Our share is a FLAG, never a name match, and there can be only one.
  const { error: secondBwError } = await write.from('project_spv_participants').insert({
    spv_id: openVehicle,
    holder_name: 'Ber Wilson Corporation (again)',
    is_ber_wilson: true,
    role: 'sponsor',
  })
  check(
    'a second Ber Wilson row on one vehicle is refused',
    secondBwError != null,
    secondBwError ? '' : 'the database accepted two'
  )

  // ── 3. documents hang off the entity ──────────────────────────────────────
  console.log(`\n${BOLD}3. A vehicle's paperwork belongs to its legal entity${OFF}`)

  const doc = async (name: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await write
      .from('documents')
      .insert({
        entity_id: entityId,
        storage_path: `entities/${entityId}/${name}`,
        file_name: name,
        doc_type: 'entity_formation',
        ...extra,
      })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create document ${name}: ${error.message}`)
    const id = (data as { id: string }).id
    docIds.push(id)
    return id
  }

  await doc('Operating Agreement.pdf')
  await doc('Operating Agreement (old).pdf', {
    superseded_at: new Date().toISOString(),
    superseded_reason: 'replaced',
  })
  await doc('Site photo.jpg', {
    excluded_at: new Date().toISOString(),
    excluded_reason: 'not a document',
  })

  const byEntity = await loadVehicleDocuments([entityId, null])
  const live = byEntity.get(entityId) ?? []
  // ⚠ READ WITH BOTH TOMBSTONE FILTERS OR THE GRAVEYARD READS AS THE FILE. A
  // retired duplicate and a human's "not a document" are both still rows.
  check('only the live document is returned', live.length === 1, `${live.length} of 3 rows`)
  check('and it is the right one', live[0]?.fileName === 'Operating Agreement.pdf', live[0]?.fileName ?? '')
  check(
    'a vehicle with no entity asks for nothing',
    (await loadVehicleDocuments([null, null])).size === 0
  )

  // ── 4. the cross-portfolio read ───────────────────────────────────────────
  console.log(`\n${BOLD}4. Every vehicle, across every deal${OFF}`)

  const { vehicles, hiddenDeals } = await loadPortfolioVehicles(null)
  const found = vehicles.find((v) => v.spv.id === openVehicle)
  check('the vehicle is in the portfolio read', found != null)
  check(
    'and it carries its deal name and a link, not a bare id',
    found?.deal.name.includes(`${stamp} program`) === true &&
      found?.deal.href === `/projects/${parentId}`,
    found?.deal.name ?? ''
  )
  check('with its pipeline attached', found?.pipeline.committed === 5_000_000)

  // ⚠ CONTAINMENT. A confidential project leaves every cross-portfolio surface,
  // and the COUNT of what left is reported — "there are N vehicles" from a
  // trimmed list is confidently wrong and worse than saying some are protected.
  check(
    "a confidential project's vehicle is withheld",
    vehicles.every((v) => v.spv.id !== secretVehicle),
    vehicles.some((v) => v.spv.id === secretVehicle) ? 'IT LEAKED' : ''
  )
  check('and the withholding is counted, not silent', hiddenDeals >= 1, `${hiddenDeals} deal(s)`)
  check(
    'the picker is filtered the same way',
    (await listVehicleOptions(null)).every((o) => o.id !== secretVehicle)
  )
  const refs = await resolveVehicleRefs([openVehicle, secretVehicle], null)
  check(
    'and so is the per-row label resolver',
    refs.has(openVehicle) && !refs.has(secretVehicle)
  )
  check(
    'asking for nothing costs no query at all',
    (await resolveVehicleRefs([], null)).size === 0,
    'most investors have no vehicle-targeted commitment'
  )
  const directory = await loadVehicleDirectory([openVehicle], null)
  check(
    'and one read answers both the picker and the row labels',
    directory.options.some((o) => o.id === openVehicle) && directory.refs.has(openVehicle)
  )

  // The containment gap this session found: an spv-targeted commitment has
  // `project_id` NULL, so every outbound filter that drops by `project_id`
  // passed it straight through into a SENT email.
  const hiddenVehicles = await hiddenVehicleIds(null)
  check(
    "a protected deal's vehicle is in the outbound withhold set",
    hiddenVehicles.has(secretVehicle),
    hiddenVehicles.has(secretVehicle) ? '' : 'IT WOULD REACH THE DAILY BRIEF'
  )
  check(
    "and an open deal's vehicle is not",
    !hiddenVehicles.has(openVehicle)
  )

  // ── 5. the program rollup counts each deal once ───────────────────────────
  console.log(`\n${BOLD}5. A program and its sub-projects are not two deals${OFF}`)

  const { data: liveProjects, error: liveError } = await db
    .from('projects')
    .select('id,name,parent_project_id,estimated_value,economics_capture_value')
    .limit(1000)
  if (liveError) throw new Error(`Could not read projects: ${liveError.message}`)
  const rows = (liveProjects ?? []) as {
    id: string
    parent_project_id: string | null
    estimated_value: number | string | null
    economics_capture_value: number | string | null
  }[]

  const leaves = leafRecords(rows)
  check(
    'the program is held out of the leaf set',
    leaves.every((r) => r.id !== parentId) && leaves.some((r) => r.id === childId),
    `${leaves.length} leaves of ${rows.length} projects`
  )
  const total = portfolioTotal(rows)
  check('and the portfolio total reports what it rolled up', total.rolledUp >= 1, `${total.rolledUp}`)

  const rolled = rolledPipelineValue(rows.find((r) => r.id === parentId)!, rows)
  check(
    "the program's value is its child's $40M, not its own $100M",
    rolled.amount === 40_000_000,
    `${rolled.amount}`
  )
  check(
    'and the overruled $100M is handed back rather than dropped silently',
    rolled.ownValue?.amount === 100_000_000,
    `${rolled.ownValue?.amount}`
  )
  // The arithmetic that was live before this session: parent + children.
  check(
    'the old behaviour would have reported $140M — the bug this fixes',
    100_000_000 + 40_000_000 === 140_000_000 && rolled.amount !== 140_000_000
  )
} catch (error) {
  // ⚠ SAY WHAT THREW. A `finally` that calls process.exit swallows the throw it
  // is unwinding, so an exception halfway down this file would look exactly
  // like the checks below it having silently not run (§12, 10-06).
  failures += 1
  console.log(
    `  ${RED}✗${OFF} the script threw: ${RED}${error instanceof Error ? error.message : String(error)}${OFF}`
  )
} finally {
  // Documents do not cascade from the entity, so they go first and by id.
  for (const id of docIds) await write.from('documents').delete().eq('id', id)
  // Investments cascade from the investor; vehicles and participants from the
  // project. The entity is referenced by the vehicle with ON DELETE SET NULL,
  // so it has to outlive it — order matters.
  if (investorId) await write.from('investors').delete().eq('id', investorId)
  for (const id of [childId, parentId, secretId]) {
    if (id) await write.from('projects').delete().eq('id', id)
  }
  if (entityId) await write.from('entities').delete().eq('id', entityId)

  const { count: auditRows } = await db
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('actor_email', actor.email)
  if ((auditRows ?? 0) > 0) {
    console.log(
      `\n${DIM}${auditRows} audit row(s) in activity_log are from this script. To clear them:${OFF}`
    )
    console.log(
      `${DIM}  docker exec supabase-db psql -U postgres -c "delete from activity_log where actor_email = '${actor.email}';"${OFF}`
    )
  }

  console.log(
    failures === 0
      ? `\n${GREEN}${BOLD}All checks passed.${OFF} Every record this run created was removed.`
      : `\n${RED}${BOLD}${failures} check(s) failed.${OFF}`
  )
  process.exit(failures === 0 ? 0 : 1)
}
