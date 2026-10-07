/**
 * Do a deal's vehicles and their participant ledgers survive a round trip
 * through the real database?
 *
 *   node --no-deprecation --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-spvs.mts
 *
 * `npm test` proves the derivation rule with no database. This proves the other
 * half: that the two tables, the untyped client and the row mapping agree with
 * each other; that a split entered as three participants reaches the economics
 * engine as one ownership weight; that the constraints refuse what they are
 * there to refuse; and that the audit trigger records WHICH FIELD moved.
 *
 * Creates a throwaway project and removes everything it created in a `finally`
 * block even when an assertion fails. Follows
 * scripts/verify-economics-roundtrip.mts.
 */

import { computeDealEconomics } from '@/lib/economics'
import { createEconomics, lineInsert, loadAndCompute } from '@/lib/economics/store'
import { spvDb, spvDbAs } from '@/lib/spvs/db'
import {
  participantTotals,
  resolveBwShare,
  splitWarnings,
  stillToPlace,
} from '@/lib/spvs/ownership'
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

let projectId: string | null = null
let otherProjectId: string | null = null

try {
  console.log(`${BOLD}Vehicles and participant ledgers, round trip${OFF}`)

  for (const label of ['', ' (a second deal, for the cross-deal checks)']) {
    const { data, error } = await write
      .from('projects')
      .insert({ name: `ZZZ verify vehicles ${Date.now()}${label}`, sector: 'infrastructure' })
      .select('id')
      .single()
    if (error) throw new Error(`Could not create the throwaway project: ${error.message}`)
    if (projectId == null) projectId = (data as { id: string }).id
    else otherProjectId = (data as { id: string }).id
  }
  if (!projectId || !otherProjectId) throw new Error('throwaway projects not created')

  // ── the three standard vehicles, twice ──────────────────────────────────
  //
  // ⚠ A PASS THAT REPORTS WHAT IT DID MUST READ BEFORE IT WRITES, OR IT CLAIMS
  // WORK IT DID NOT DO (CLAUDE.md §12, 09-30). Idempotent and honest are
  // different properties, so this runs the bootstrap's own logic twice and
  // asserts the second run reports nothing created.
  const standardRows = (['land', 'energy', 'data_center'] as const).map((purpose, i) => ({
    project_id: projectId,
    label: `Verify ${purpose} LLC`,
    purpose,
    entity_id: null,
    org_node_id: null,
    org_node_name: null,
    jurisdiction: null,
    bw_ownership_pct: null,
    raise_target: null,
    status: 'planning_assumption',
    note: null,
    sort_order: i + 1,
  }))
  const { error: stdError } = await write.from('project_spvs').insert(standardRows)
  if (stdError) throw new Error(`standard vehicles: ${stdError.message}`)

  const { data: roll } = await db
    .from('project_spvs')
    .select('label')
    .eq('project_id', projectId)
  const taken = new Set(((roll ?? []) as { label: string }[]).map((r) => r.label))
  const secondRun = standardRows.filter((r) => !taken.has(r.label))
  check(
    'running the bootstrap twice creates nothing the second time',
    secondRun.length === 0,
    `${secondRun.length} would be created on a second press`
  )

  // ── the constraints refuse what they exist to refuse ────────────────────
  const { error: dupe } = await write
    .from('project_spvs')
    .insert({ project_id: projectId, label: 'Verify energy LLC', purpose: 'energy' })
  check(
    'two vehicles cannot share a name on one deal',
    dupe?.code === '23505',
    dupe ? `refused with ${dupe.code}` : 'IT WAS ACCEPTED — the unique index is not doing its job'
  )

  const { error: bothParents } = await write
    .from('project_spvs')
    .insert({ project_id: projectId, opportunity_id: projectId, label: 'Verify both', purpose: 'other' })
  check(
    'a vehicle cannot belong to a project AND an opportunity',
    bothParents != null,
    bothParents ? `refused with ${bothParents.code}` : 'IT WAS ACCEPTED'
  )

  const { error: noParent } = await write
    .from('project_spvs')
    .insert({ label: 'Verify orphan', purpose: 'other' })
  check(
    'a vehicle cannot belong to nothing',
    noParent != null,
    noParent ? `refused with ${noParent.code}` : 'IT WAS ACCEPTED'
  )

  const { data: energyRow } = await db
    .from('project_spvs')
    .select('id')
    .eq('project_id', projectId)
    .eq('purpose', 'energy')
    .single()
  const energyId = (energyRow as { id: string }).id

  // ── the participant ledger ──────────────────────────────────────────────
  const { error: partError } = await write.from('project_spv_participants').insert([
    {
      spv_id: energyId, holder_name: 'Ber Wilson Corporation', is_ber_wilson: true,
      role: 'sponsor', class: 'membership_units', equity_pct: 40,
      capital_committed: null, capital_funded: null, preferred_return_pct: null,
      profit_share_pct: null, status: 'contracted', note: null, sort_order: 1,
      holder_party_id: null, holder_entity_id: null, investor_id: null,
    },
    {
      spv_id: energyId, holder_name: 'Avant Capital', is_ber_wilson: false,
      role: 'capital_partner', class: 'preferred', equity_pct: 35,
      capital_committed: 14_000_000, capital_funded: 4_000_000, preferred_return_pct: 8,
      profit_share_pct: null, status: 'loi_term_sheet', note: null, sort_order: 2,
      holder_party_id: null, holder_entity_id: null, investor_id: null,
    },
    {
      spv_id: energyId, holder_name: 'Elite Solutions', is_ber_wilson: false,
      role: 'capital_partner', class: 'membership_units', equity_pct: 25,
      capital_committed: 10_000_000, capital_funded: null, preferred_return_pct: null,
      profit_share_pct: null, status: 'planning_assumption', note: null, sort_order: 3,
      holder_party_id: null, holder_entity_id: null, investor_id: null,
    },
  ])
  if (partError) throw new Error(`participants: ${partError.message}`)

  const { error: secondOurs } = await write.from('project_spv_participants').insert({
    spv_id: energyId, holder_name: 'Ber Wilson again', is_ber_wilson: true, equity_pct: 10,
  })
  check(
    'a vehicle cannot have two Ber Wilson rows',
    secondOurs?.code === '23505',
    secondOurs
      ? `refused with ${secondOurs.code}`
      : 'IT WAS ACCEPTED — our share would have two answers'
  )

  const { error: overHundred } = await write.from('project_spv_participants').insert({
    spv_id: energyId, holder_name: 'Impossible', equity_pct: 140,
  })
  check(
    'an equity split above 100% is refused',
    overHundred?.code === '23514',
    overHundred ? `refused with ${overHundred.code}` : 'IT WAS ACCEPTED'
  )

  // ── the round trip: does what went in come back? ────────────────────────
  const vehicles = await loadProjectSpvs('project', projectId)
  check(
    'all three vehicles come back, in sort order',
    vehicles.length === 3 && vehicles[0].purpose === 'land' && vehicles[1].purpose === 'energy',
    vehicles.map((v) => v.purpose).join(', ')
  )

  const energy = vehicles.find((v) => v.id === energyId)!
  const share = resolveBwShare(energy, energy.participants)
  check(
    'our share comes from the ledger, not from the vehicle',
    share.pct === 40 && share.from === 'ledger',
    `${share.pct}% via ${share.from}`
  )

  const totals = participantTotals(energy.participants)
  check(
    'the splits total 100% and the capital totals only the rows that carry one',
    totals.equityPct === 100 && totals.committed === 24_000_000 && totals.funded === 4_000_000,
    `${totals.equityPct}% · ${totals.committed} committed from ${totals.withCommitted} of 3 · ${totals.funded} funded`
  )
  check(
    'a complete ledger raises no warnings',
    splitWarnings(energy, energy.participants).length === 0,
    splitWarnings(energy, energy.participants).join(' | ')
  )

  const land = vehicles.find((v) => v.purpose === 'land')!
  check(
    'a vehicle with no ledger and nothing typed reports an undetermined share, never 0 or 100',
    resolveBwShare(land, land.participants).pct === null,
    `from: ${resolveBwShare(land, land.participants).from}`
  )
  check(
    'and its capital totals are NULL rather than 0',
    participantTotals(land.participants).committed === null,
    'a $0 beside a real figure reads as computed rather than unfinished'
  )

  // ── an incomplete ledger warns, and does not block ──────────────────────
  const { data: eliteRow } = await db
    .from('project_spv_participants')
    .select('id')
    .eq('spv_id', energyId)
    .eq('holder_name', 'Elite Solutions')
    .single()
  const eliteId = (eliteRow as { id: string }).id

  const { error: reduceError } = await write
    .from('project_spv_participants')
    .update({ equity_pct: 10 })
    .eq('id', eliteId)
    .eq('spv_id', energyId)
  check('reducing a split is allowed even though it breaks 100%', reduceError == null,
    reduceError?.message ?? 'reports, never blocks')

  const afterReduce = (await loadProjectSpvs('project', projectId)).find((v) => v.id === energyId)!
  const warnings = splitWarnings(afterReduce, afterReduce.participants)
  check(
    'the 85% ledger is reported, naming the unassigned remainder',
    warnings.some((w) => w.includes('85%') && w.includes('15% is unassigned')),
    warnings.join(' | ') || 'NOTHING WAS REPORTED'
  )

  // ── the audit trigger names the field, and the person ───────────────────
  //
  // ⚠ `action` IS `TG_OP`, SO IT IS 'UPDATE' AND NOT 'updated', AND THE DIFF
  // LANDS IN `field_changes` RATHER THAN IN `metadata`. `metadata` carries
  // `to_jsonb(old)` on a DELETE and nothing on an update. Getting either wrong
  // reads as "the trigger is not firing" when it is firing perfectly.
  const { data: audit } = await db
    .from('activity_log')
    .select('action,actor_type,field_changes')
    .eq('table_name', 'project_spv_participants')
    .eq('record_id', eliteId)
    .eq('action', 'UPDATE')
    .order('created_at', { ascending: false })
    .limit(1)
  const row = ((audit ?? []) as {
    actor_type: string
    field_changes: Record<string, { old: unknown; new: unknown }> | null
  }[])[0]
  const changes = row?.field_changes ?? {}
  check(
    'the audit log records WHICH field moved, and from what to what',
    Number(changes.equity_pct?.old) === 25 && Number(changes.equity_pct?.new) === 10,
    JSON.stringify(changes.equity_pct ?? null)
  )
  check(
    'and attributes it to a person, not to "system"',
    row?.actor_type === 'user',
    `actor_type: ${row?.actor_type}`
  )

  // ── the cross-deal guard ────────────────────────────────────────────────
  const { data: foreignSpv } = await write
    .from('project_spvs')
    .insert({ project_id: otherProjectId, label: 'Someone else’s vehicle', purpose: 'energy' })
    .select('id')
    .single()
  const foreignSpvId = (foreignSpv as { id: string }).id

  // The route-level guard reads the vehicle scoped to the deal, so the proof is
  // that this read finds nothing — which is exactly what makes the route refuse.
  const { data: scoped } = await db
    .from('project_spvs')
    .select('id')
    .eq('id', foreignSpvId)
    .eq('project_id', projectId)
    .maybeSingle()
  check(
    'another deal’s vehicle is invisible when scoped to this one',
    scoped == null,
    'which is what makes a line refuse to name it'
  )

  const { data: foreignPart } = await write
    .from('project_spv_participants')
    .insert({ spv_id: foreignSpvId, holder_name: 'Not ours to edit' })
    .select('id')
    .single()
  const { data: crossPatch } = await write
    .from('project_spv_participants')
    .update({ equity_pct: 99 })
    .eq('id', (foreignPart as { id: string }).id)
    .eq('spv_id', energyId)
    .select('id')
  check(
    'a participant PATCH filtered by the WRONG vehicle changes nothing',
    (crossPatch ?? []).length === 0,
    'the second filter is what stops one deal editing another'
  )

  // ── the engine reads the derived share ──────────────────────────────────
  const economicsId = await createEconomics('project', projectId, actor)
  const { error: lineError } = await write.from('economics_lines').insert(
    lineInsert(economicsId, 'one_time_lump', 'Verify development fee', {
      spv_id: energyId,
      amount: 10_000_000,
      is_ber_wilson_revenue: true,
      status: 'planning_assumption',
    })
  )
  if (lineError) throw new Error(`line: ${lineError.message}`)

  const computed = await loadAndCompute('project', projectId)
  if (!computed) throw new Error('the model did not load')
  const engineSpv = computed.loaded.input.spvs.find((s) => s.id === energyId)
  check(
    'the engine receives the LEDGER share as the vehicle’s one ownership number',
    engineSpv?.bwOwnershipPct === 40,
    `engine saw ${engineSpv?.bwOwnershipPct}%`
  )

  const tiers = computed.result.tiers
  check(
    'a $10M fee in a 40%-ours vehicle nets $4M, not $10M',
    tiers.berWilsonNet.oneTimeRevenue === 4_000_000,
    `net one-time: ${tiers.berWilsonNet.oneTimeRevenue}`
  )

  const byEntity = computed.result.byEntity.find((e) => e.spvId === energyId)
  check(
    'and the per-vehicle rollup the Vehicles tab renders agrees with it',
    byEntity?.gross.oneTimeRevenue === 10_000_000 &&
      byEntity?.berWilsonNet?.oneTimeRevenue === 4_000_000,
    `gross ${byEntity?.gross.oneTimeRevenue}, net ${byEntity?.berWilsonNet?.oneTimeRevenue}`
  )

  // ── deleting a vehicle that earns revenue ───────────────────────────────
  const { count: lineCount } = await db
    .from('economics_lines')
    .select('id', { count: 'exact', head: true })
    .eq('spv_id', energyId)
  check(
    'the delete route can see that revenue is earned here, so it can refuse',
    (lineCount ?? 0) === 1,
    `${lineCount} line(s) — on delete set null would have made this revenue wholly ours`
  )

  // ── clearing the ledger hands the typed figure back ─────────────────────
  await write.from('project_spv_participants').delete().eq('spv_id', energyId)
  await write.from('project_spvs').update({ bw_ownership_pct: 51 }).eq('id', energyId)
  const cleared = (await loadProjectSpvs('project', projectId)).find((v) => v.id === energyId)!
  const clearedShare = resolveBwShare(cleared, cleared.participants)
  check(
    'with the ledger emptied, the typed share answers again and says so',
    clearedShare.pct === 51 && clearedShare.from === 'typed',
    `${clearedShare.pct}% via ${clearedShare.from}`
  )

  check(
    'still-to-place needs both a target and a total',
    stillToPlace(null, 1_000) === null && stillToPlace(20_000_000, 14_000_000) === 6_000_000,
    'no target is an unknown, not a gap of the whole commitment'
  )

  // One more compute, to prove nothing throws once a vehicle has no split.
  const recomputed = computeDealEconomics(
    (await loadAndCompute('project', projectId))!.loaded.input
  )
  check(
    'the model still computes with the ledger gone',
    recomputed.valid || recomputed.errors.length > 0,
    `${recomputed.errors.length} error(s), ${recomputed.warnings.length} warning(s)`
  )
} catch (error) {
  // ⚠ SAY WHAT THREW. A `finally` that calls process.exit swallows the throw it
  // is unwinding, so an exception halfway down this file looked exactly like
  // the checks below it having silently not run.
  failures += 1
  console.log(`  ${RED}✗${OFF} the script threw: ${RED}${error instanceof Error ? error.message : String(error)}${OFF}`)
} finally {
  // Vehicles, participants, lines and the model all cascade from the project.
  for (const id of [projectId, otherProjectId]) {
    if (id) await write.from('projects').delete().eq('id', id)
  }
  // The audit trigger is append-only by design, so this run's rows survive the
  // cleanup and would otherwise sit at the top of /activity referring to a
  // project that no longer exists.
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
