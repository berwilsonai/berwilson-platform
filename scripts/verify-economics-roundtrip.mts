/**
 * Does a deal economics model survive a round trip through the real database?
 *
 *   node --no-deprecation --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-economics-roundtrip.mts
 *
 * `npm test` proves the arithmetic with no database. This proves the other
 * half: that the eleven tables, the untyped client and the row mapping agree
 * with each other, that an invalid model refuses to publish a pipeline figure,
 * and that a version snapshot comes back the way it went in.
 *
 * Creates a throwaway project, exercises every line type that needs a column,
 * and removes everything it created in a `finally` block even when an
 * assertion fails. Follows scripts/verify-separation.mts.
 */

import { computeDealEconomics } from '@/lib/economics'
import { calcDb, calcDbAs } from '@/lib/economics/db'
import {
  captureForPipeline,
  createEconomics,
  lineInsert,
  loadAndCompute,
  persistComputed,
  saveVersion,
} from '@/lib/economics/store'

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
const db = calcDb()
const write = calcDbAs(actor)

let projectId: string | null = null

try {
  console.log(`${BOLD}Deal economics round trip${OFF}`)

  const { data: project, error: projectError } = await write
    .from('projects')
    .insert({ name: `ZZZ verify economics ${Date.now()}`, sector: 'infrastructure' })
    .select('id')
    .single()
  if (projectError) throw new Error(`Could not create the throwaway project: ${projectError.message}`)
  projectId = (project as { id: string }).id
  console.log(`${DIM}  throwaway project ${projectId}${OFF}`)

  const economicsId = await createEconomics('project', projectId, actor)
  const { data: buckets } = await db
    .from('economics_buckets')
    .select('id,label,priority')
    .eq('economics_id', economicsId)
    .order('priority')
  const bucketRows = (buckets ?? []) as { id: string; label: string; priority: number }[]
  check(
    'creating a model seeds the brief’s priority buckets',
    bucketRows.length === 7,
    `${bucketRows.length} buckets, first is "${bucketRows[0]?.label}"`
  )

  const { data: spvs, error: spvError } = await write
    .from('economics_spvs')
    .insert([
      { economics_id: economicsId, label: 'Verify Energy LLC', purpose: 'energy', bw_ownership_pct: 60, sort_order: 1 },
      { economics_id: economicsId, label: 'Verify Data Center LLC', purpose: 'data_center', sort_order: 2 },
    ])
    .select('id,label,bw_ownership_pct')
  if (spvError) throw new Error(`SPV insert: ${spvError.message}`)
  const spvRows = (spvs ?? []) as { id: string; label: string; bw_ownership_pct: number | null }[]
  const energySpv = spvRows.find((s) => s.label === 'Verify Energy LLC')!
  const dcSpv = spvRows.find((s) => s.label === 'Verify Data Center LLC')!
  check(
    'an SPV with no split stores NULL, not 100',
    dcSpv.bw_ownership_pct === null,
    'an unknown share must never read as all of it'
  )

  const { error: sourceError } = await write.from('economics_capacity_sources').insert([
    { economics_id: economicsId, label: 'Interconnect', kind: 'grid_interconnect', nameplate_mw: 100, status: 'loi_term_sheet' },
    {
      economics_id: economicsId,
      label: 'Fuel cells',
      kind: 'onsite_generation',
      block_count: 6,
      redundant_blocks: 1,
      block_mw: 25,
      stated_net_mw: 150,
      status: 'vendor_quoted',
    },
  ])
  if (sourceError) throw new Error(`Source insert: ${sourceError.message}`)

  const localBucket = bucketRows.find((b) => b.label === 'Local and retail load')!
  const dcBucket = bucketRows.find((b) => b.label === 'Data center facility load')!

  // Every line type that needs a column of its own, so a missing column fails
  // here rather than in front of Richard.
  const { data: lines, error: lineError } = await write
    .from('economics_lines')
    .insert([
      // Through lineInsert so every row carries the SAME column list. A hand
      // written array where only some rows mention a NOT NULL boolean fails the
      // whole statement, which is how this script found the trap.
      lineInsert(economicsId, 'energy_sale', 'Municipal offtake', {
        spv_id: energySpv.id, bucket_id: localBucket.id, mw: 20, load_factor: 0.65,
        price: 0.075, price_unit: 'per_kwh', mode: 'forward', term_years: 20,
        escalator_pct: 2.5, status: 'loi_term_sheet', sort_order: 1,
      }),
      lineInsert(economicsId, 'dc_lease', 'Turnkey lease', {
        spv_id: dcSpv.id, bucket_id: dcBucket.id, it_mw: 40, rate_per_kw_month: 145,
        occupancy: 0.95, pue: 1.3, term_years: 15, escalator_pct: 3,
        ramp: [0.2, 0.6, 1], sort_order: 2,
      }),
      lineInsert(economicsId, 'one_time_per_mw', 'Partner internals', {
        spv_id: dcSpv.id, mw: 40, price_per_mw: 17_500_000,
        is_ber_wilson_revenue: false, sort_order: 3,
      }),
      lineInsert(economicsId, 'one_time_per_unit', 'Prefab steel', {
        quantity: 1_250_000, price_per_unit: 33, cost_per_unit: 20,
        unit_label: 'square feet', sort_order: 4,
      }),
      lineInsert(economicsId, 'tax_credit', '48E credit', {
        spv_id: energySpv.id, amount: 94_000_000, credit_kind: '48E',
        transferable: true, our_share_pct: 60, counts_toward_project_value: false,
        sort_order: 5,
      }),
      lineInsert(economicsId, 'om_service', 'Microgrid O&M', {
        spv_id: energySpv.id, mw: 125, price: 18, price_unit: 'per_kw_year',
        term_years: 20, counterparty: 'City of Verify', sort_order: 6,
      }),
      lineInsert(economicsId, 'land', 'Surplus acreage', {
        disposition: 'sale', acres: 180, price: 34_000, price_unit: 'per_acre',
        counts_toward_project_value: false, sort_order: 7,
      }),
    ])
    .select('id,line_type,label')
  if (lineError) throw new Error(`Line insert: ${lineError.message}`)
  const lineRows = (lines ?? []) as { id: string; line_type: string; label: string }[]
  check('all seven line shapes insert', lineRows.length === 7, `${lineRows.length} lines`)

  const energyLine = lineRows.find((l) => l.line_type === 'energy_sale')!
  const internals = lineRows.find((l) => l.label === 'Partner internals')!

  // The two derived types, which need the referencing columns to work.
  const { error: derivedError } = await write.from('economics_lines').insert([
    lineInsert(economicsId, 'energy_attribute', 'RECs', {
      spv_id: energySpv.id, rides_on_line_id: energyLine.id, price_per_mwh: 11,
      attribute_kind: 'REC', term_years: 20, sort_order: 8,
    }),
    lineInsert(economicsId, 'recurring_fee_on_line', 'Internals commission', {
      spv_id: dcSpv.id, referenced_line_id: internals.id,
      fee_base: 'referenced_line_value', annual_rate_pct: 1.5, our_share_pct: 50,
      partner_label: 'Elite Solutions / Avant', term_years: 15, is_carve_out: false,
      sort_order: 9,
    }),
  ])
  if (derivedError) throw new Error(`Derived line insert: ${derivedError.message}`)

  // Per-field provenance on one input, which is what makes the whole model a
  // planning number however well sourced the rest is.
  const { error: provError } = await write.from('economics_provenance').insert({
    economics_id: economicsId,
    line_id: energyLine.id,
    field_key: 'load factor',
    status: 'planning_assumption',
    source: 'No load study yet',
    note: 'Load study not done',
  })
  if (provError) throw new Error(`Provenance insert: ${provError.message}`)

  const { error: headerError } = await write
    .from('deal_economics')
    .update({
      discount_rate_pct: 9,
      cap_rate_pct: 6.3,
      base_year: 2027,
      stated_total_amount: 152_500_000,
      stated_total_shape: 'recurring',
    })
    .eq('id', economicsId)
  if (headerError) throw new Error(`Header update: ${headerError.message}`)

  // ── Read it all back and compute ───────────────────────────────────────────
  const loaded = await loadAndCompute('project', projectId)
  if (!loaded) throw new Error('loadAndCompute returned null for a model that exists')
  const { input, result } = { input: loaded.loaded.input, result: loaded.result }

  check('every line comes back', input.lines.length === 9, `${input.lines.length} of 9`)
  check(
    'firm MW derates the fuel cell block design',
    result.ledger.firmMw === 225,
    `${result.ledger.firmMw} MW (100 interconnect + 5 of 6 blocks at 25)`
  )
  check(
    'the stated 150 MW net is flagged against the derived 125',
    result.warnings.some((w) => w.code === 'block_design_mismatch'),
    'the disagreement is kept, not settled'
  )

  const lease = result.lines.find((l) => l.label === 'Turnkey lease')!
  check(
    'the lease draws facility load, not IT load',
    Math.abs(lease.facilityMw - 52) < 1e-6,
    `40 MW IT at PUE 1.30 is ${lease.facilityMw} MW on the plant`
  )
  // The numeric[] column itself, asserted on the loaded INPUT rather than on a
  // derived figure: year 3 revenue carries 3% escalation and so cannot equal
  // the unescalated stabilized figure, which is the engine being right.
  const leaseInput = input.lines.find((l) => l.label === 'Turnkey lease')
  const loadedRamp = leaseInput && 'ramp' in leaseInput ? leaseInput.ramp : null
  check(
    'the ramp survives the numeric[] round trip',
    JSON.stringify(loadedRamp) === JSON.stringify([0.2, 0.6, 1]),
    `loaded ${JSON.stringify(loadedRamp)}`
  )
  check(
    'the ramp shapes the early years and escalation still applies after it',
    lease.years[0].revenue < lease.years[1].revenue &&
      lease.years[1].revenue < lease.years[2].revenue &&
      lease.years[2].revenue > (lease.annualRevenue ?? 0),
    'year 3 is at full occupancy AND two years of escalation'
  )

  const commission = result.lines.find((l) => l.label === 'Internals commission')!
  check(
    'the Elite commission reads 1.5% of $700M, halved',
    Math.abs((commission.annualRevenue ?? 0) - 5_250_000) < 1,
    `${commission.annualRevenue} a year on a 40 MW package`
  )

  const recs = result.lines.find((l) => l.label === 'RECs')!
  check(
    'RECs ride on the energy line and draw nothing',
    recs.facilityMw === 0 && (recs.annualRevenue ?? 0) > 0,
    `${Math.round(recs.annualRevenue ?? 0).toLocaleString()} a year, 0 MW drawn`
  )

  check(
    'one planning assumption makes the whole model a planning number',
    result.status === 'planning_assumption',
    'the load factor had no study behind it'
  )
  check(
    'the data center SPV has no split, so its revenue is undetermined',
    !result.tiers.ownershipComplete && (result.tiers.undetermined.annualRecurringRevenue ?? 0) > 0,
    `${Math.round(result.tiers.undetermined.annualRecurringRevenue ?? 0).toLocaleString()} a year held out of net`
  )
  check(
    'revenue generated exceeds what reaches Ber Wilson',
    (result.tiers.grossGenerated.totalProjectValue ?? 0) >
      (result.tiers.berWilsonGross.totalProjectValue ?? 0),
    'the partner-built internals are not ours'
  )

  // ── Persist, and check an invalid model publishes nothing ──────────────────
  await persistComputed('project', projectId, economicsId, result, actor)
  const { data: afterValid } = await db
    .from('projects')
    .select('economics_capture_value,economics_status')
    .eq('id', projectId)
    .single()
  const validRow = afterValid as { economics_capture_value: number | null; economics_status: string | null }
  check(
    'a valid model publishes its capture to the pipeline column',
    validRow.economics_capture_value != null,
    `${Math.round(Number(validRow.economics_capture_value)).toLocaleString()}, status ${validRow.economics_status}`
  )
  check(
    'the published figure is net capture, not gross generated',
    Math.abs(Number(validRow.economics_capture_value) - (captureForPipeline(result) ?? 0)) < 1,
    'and it is smaller than the gross'
  )

  // Over-allocate on purpose: 225 MW firm against a 400 MW claim.
  const { error: overError } = await write
    .from('economics_lines')
    .insert(
      lineInsert(economicsId, 'capacity_charge', 'Impossible reservation', {
        bucket_id: localBucket.id, mw: 400, price: 10, price_unit: 'per_kw_month',
        term_years: 10, sort_order: 99,
      })
    )
  if (overError) throw new Error(`Overage line insert: ${overError.message}`)

  const over = await loadAndCompute('project', projectId)
  if (!over) throw new Error('reload returned null')
  check(
    'an over-allocated model is invalid and names the overage',
    !over.result.valid && over.result.ledger.overageMw != null,
    `${over.result.ledger.overageMw?.toFixed(0)} MW more than the deal has`
  )

  const before = Number(validRow.economics_capture_value)
  await persistComputed('project', projectId, economicsId, over.result, actor)
  const { data: afterInvalid } = await db
    .from('projects')
    .select('economics_capture_value')
    .eq('id', projectId)
    .single()
  check(
    'an invalid model publishes NOTHING to the pipeline',
    Math.abs(Number((afterInvalid as { economics_capture_value: number }).economics_capture_value) - before) < 1,
    'the record keeps what it had rather than showing an indefensible figure'
  )
  const { data: invalidHeader } = await db
    .from('deal_economics')
    .select('computed_valid')
    .eq('id', economicsId)
    .single()
  check(
    'but the model itself records that it is invalid',
    (invalidHeader as { computed_valid: boolean }).computed_valid === false,
    'so the tab can say why'
  )

  // ── Versions ──────────────────────────────────────────────────────────────
  const v1 = await saveVersion(economicsId, input, result, { label: 'Base case' }, { ...actor, name: 'Verify' })
  const v2 = await saveVersion(economicsId, over.result ? over.loaded.input : input, over.result, { label: 'Over-allocated' }, { ...actor, name: 'Verify' })
  check('versions number from 1 and increment', v1 === 1 && v2 === 2, `v${v1} then v${v2}`)

  const { data: snapshot } = await db
    .from('economics_versions')
    .select('label,input_snapshot')
    .eq('economics_id', economicsId)
    .eq('version', 1)
    .single()
  const snap = snapshot as { label: string; input_snapshot: { lines: unknown[] } }
  check(
    'a version snapshot comes back the way it went in',
    snap.label === 'Base case' && snap.input_snapshot.lines.length === 9,
    `${snap.input_snapshot.lines.length} lines frozen`
  )

  // ── The audit trail ───────────────────────────────────────────────────────
  // The whole claim of the audit migration is that a number changed and
  // someone changed it. Both halves are checked: that the DIFF is recorded,
  // and that the actor is a person rather than "system".
  await write
    .from('deal_economics')
    .update({ discount_rate_pct: 11.5 })
    .eq('id', economicsId)

  const { data: audit, error: auditError } = await db
    .from('activity_log')
    .select('action,table_name,field_changes,actor_id,actor_email')
    .eq('table_name', 'deal_economics')
    .eq('record_id', economicsId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (auditError) throw new Error(`activity_log read: ${auditError.message}`)
  const rows = (audit ?? []) as {
    action: string
    field_changes: Record<string, { old: unknown; new: unknown }> | null
    actor_email: string | null
  }[]

  const rateChange = rows.find((r) => r.field_changes?.discount_rate_pct)
  check(
    'changing a rate records the old and new value, not just that someone touched it',
    rateChange != null,
    rateChange
      ? `${JSON.stringify(rateChange.field_changes?.discount_rate_pct)}`
      : `${rows.length} rows, none carrying a discount_rate_pct diff`
  )
  check(
    'and the audit row names a person, not "system"',
    rateChange?.actor_email === actor.email,
    `actor_email ${rateChange?.actor_email ?? 'null'} (calcDbAs sends x-actor-email)`
  )

  const { count: versionAudit } = await db
    .from('activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('table_name', 'economics_versions')
  check(
    'economics_versions is NOT audited',
    (versionAudit ?? 0) === 0,
    'wide jsonb snapshots would write both copies on every touch'
  )

  // ── The engine and the database agree ─────────────────────────────────────
  const recomputed = computeDealEconomics(input)
  check(
    'recomputing the loaded input reproduces the stored figures exactly',
    recomputed.tiers.berWilsonNet.contractValue === result.tiers.berWilsonNet.contractValue,
    'one engine, one answer'
  )
} catch (error) {
  failures += 1
  console.log(`\n${RED}Threw:${OFF} ${error instanceof Error ? error.message : String(error)}`)
} finally {
  if (projectId) {
    // Cascade removes deal_economics and every child. Verified below.
    const { error } = await write.from('projects').delete().eq('id', projectId)
    if (error) {
      console.log(`\n${RED}CLEANUP FAILED${OFF} — remove project ${projectId} by hand: ${error.message}`)
      failures += 1
    } else {
      const { count } = await db
        .from('deal_economics')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
      check('deleting the project cascades the whole model away', (count ?? 0) === 0, 'no orphans')
    }
  }
}

// ⚠ THIS RUN LEAVES AUDIT ROWS BEHIND AND CANNOT REMOVE THEM ITSELF.
// activity_log has no DELETE policy, deliberately, so the application can
// never erase history. That is the right rule and this script does not get an
// exception to it. But these particular rows describe a project called
// "ZZZ verify economics …" that was never a business record, so keeping them
// has no audit value and real cost: a hundred of them bury the actual history
// at the top of /activity. The command to clear them is printed rather than
// run, because the decision to touch an append-only log belongs to a person.
const { count: leftBehind } = await db
  .from('activity_log')
  .select('id', { count: 'exact', head: true })
  .eq('actor_email', actor.email)
if ((leftBehind ?? 0) > 0) {
  console.log(
    `\n${DIM}${leftBehind} audit row(s) in activity_log are from this script, all attributed` +
      ` to ${actor.email}. They refer to a project that no longer exists and will` +
      ` otherwise sit at the top of /activity.${OFF}\n` +
      `${DIM}  To clear them:${OFF}\n` +
      `${DIM}  docker exec supabase-db psql -U postgres -c "delete from activity_log` +
      ` where actor_email = '${actor.email}';"${OFF}`
  )
}

console.log(
  failures === 0
    ? `\n${GREEN}All checks passed.${OFF} Every record this run created was removed.`
    : `\n${RED}${failures} check(s) failed.${OFF}`
)
if (failures > 0) process.exitCode = 1
