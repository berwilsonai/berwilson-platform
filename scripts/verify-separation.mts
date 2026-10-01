/**
 * Verify the separation pass end to end against the live database.
 *
 * Creates a throwaway employment record, an appointment carrying unlimited
 * signing authority, a platform login with a project grant and a box on the org
 * chart; separates the person; asserts each side-effect; then cleans up.
 *
 * ⚠ Run against the Studio's own database. It writes real rows and deletes them
 * again — every created id is tracked and removed in a finally block, including
 * on an assertion failure.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-separation.mts
 */

import { govDb, govDbAs } from '../src/lib/governance/db.ts'
import { applySeparation } from '../src/lib/governance/separation.ts'
import { OFFBOARDING_TEMPLATE } from '../src/lib/governance/offboarding.ts'

const SUFFIX = `verify-${Date.now()}`
const db = govDb()
const writer = govDbAs({ id: '00000000-0000-0000-0000-000000000000', email: 'verify@local' })

let failures = 0
function check(label: string, pass: boolean, detail = '') {
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!pass) failures += 1
}

const cleanup: (() => Promise<void>)[] = []

try {
  // ── Fixtures ───────────────────────────────────────────────────────────────
  const { data: node } = await db.from('org_nodes').select('id, name').limit(1).maybeSingle()
  if (!node) throw new Error('No org_nodes rows — the entity chart must have at least one node.')

  const { data: person, error: personError } = await writer
    .from('personnel')
    .insert({ full_name: `Separation Check ${SUFFIX}`, title: 'Verification Officer', engaged_on: '2024-01-01' })
    .select('*')
    .single()
  if (personError) throw new Error(`could not create personnel: ${personError.message}`)
  cleanup.push(async () => { await writer.from('personnel').delete().eq('id', person.id) })

  const { data: member, error: memberError } = await writer
    .from('team_members')
    .insert({ name: `Separation Check ${SUFFIX}`, role: 'member', active: true })
    .select('*')
    .single()
  if (memberError) throw new Error(`could not create team_member: ${memberError.message}`)
  cleanup.push(async () => { await writer.from('team_members').delete().eq('id', member.id) })

  const { data: project } = await db.from('projects').select('id').limit(1).maybeSingle()
  if (project) {
    const { error } = await writer
      .from('access_grants')
      .insert({ team_member_id: member.id, resource_type: 'project', resource_id: project.id })
    if (error) console.warn(`  (could not seed a grant: ${error.message})`)
  }

  const { data: orgPerson, error: orgPersonError } = await writer
    .from('org_people')
    .insert({ name: `Separation Check ${SUFFIX}`, role: 'Verification Officer', status: 'active', node_id: node.id })
    .select('*')
    .single()
  if (orgPersonError) throw new Error(`could not create org_person: ${orgPersonError.message}`)
  cleanup.push(async () => { await writer.from('org_people').delete().eq('id', orgPerson.id) })

  const { data: role, error: roleError } = await writer
    .from('org_roles')
    .insert({
      personnel_id: person.id,
      person_name: person.full_name,
      title: 'Verification Officer',
      org_node_id: node.id,
      org_node_name: node.name,
      can_sign_contracts: true,
      signing_limit: null, // unlimited — the state that most needs closing
      bank_signatory: true,
      effective_from: '2024-01-01',
    })
    .select('*')
    .single()
  if (roleError) throw new Error(`could not create org_role: ${roleError.message}`)
  cleanup.push(async () => { await writer.from('org_roles').delete().eq('id', role.id) })

  // A SECOND appointment, already closed for a different reason. The pass must
  // not touch it — that is the fill-versus-overwrite guarantee.
  const { data: oldRole } = await writer
    .from('org_roles')
    .insert({
      personnel_id: person.id,
      person_name: person.full_name,
      title: 'Former Assistant Secretary',
      effective_from: '2022-01-01',
      effective_to: '2023-06-30',
      end_reason: 'role_changed',
    })
    .select('*')
    .single()
  if (oldRole) cleanup.push(async () => { await writer.from('org_roles').delete().eq('id', oldRole.id) })

  await writer
    .from('personnel')
    .update({ team_member_id: member.id, org_person_id: orgPerson.id })
    .eq('id', person.id)

  // ── The pass ───────────────────────────────────────────────────────────────
  const separatedOn = '2026-09-30'
  const { data: separated, error: sepError } = await writer
    .from('personnel')
    .update({ separated_on: separatedOn, separation_type: 'resigned' })
    .eq('id', person.id)
    .select('*')
    .single()
  if (sepError) throw new Error(`could not separate: ${sepError.message}`)
  check('status is derived, not written', separated.status === 'departed', `status=${separated.status}`)

  const result = await applySeparation(db, writer, separated, 'verify script')
  console.log(`\n  applied: ${result.applied.join(' | ') || '(nothing)'}`)
  if (result.problems.length) console.log(`  problems: ${result.problems.join(' | ')}`)
  console.log('')
  check('the pass reported no problems', result.problems.length === 0, result.problems.join('; '))

  // ── Assertions ─────────────────────────────────────────────────────────────
  const { data: steps } = await db.from('personnel_offboarding').select('*').eq('personnel_id', person.id)
  check(
    'offboarding checklist seeded in full',
    (steps ?? []).length === OFFBOARDING_TEMPLATE.length,
    `${(steps ?? []).length} of ${OFFBOARDING_TEMPLATE.length} steps`
  )
  check(
    'the authority step is on the checklist and required',
    (steps ?? []).some((s: { label: string; required: boolean }) =>
      s.label.includes('Signature authority ended') && s.required),
  )

  const { data: closedRole } = await db.from('org_roles').select('*').eq('id', role.id).single()
  check('open signing authority was closed', closedRole.effective_to === separatedOn, `effective_to=${closedRole.effective_to}`)
  check("closed with reason 'separation'", closedRole.end_reason === 'separation', `end_reason=${closedRole.end_reason}`)

  if (oldRole) {
    const { data: untouched } = await db.from('org_roles').select('*').eq('id', oldRole.id).single()
    check(
      'an already-closed appointment keeps its own reason (fill, not overwrite)',
      untouched.effective_to === '2023-06-30' && untouched.end_reason === 'role_changed',
      `${untouched.effective_to} / ${untouched.end_reason}`
    )
  }

  const { data: deactivated } = await db.from('team_members').select('*').eq('id', member.id).single()
  check('platform access revoked', deactivated.active === false)
  check('revocation carries a date', Boolean(deactivated.deactivated_at), String(deactivated.deactivated_at))
  check('revocation names the actor', deactivated.deactivated_by === 'verify script', String(deactivated.deactivated_by))
  if (project) {
    const snapshot = (deactivated.revoked_grants ?? []) as unknown[]
    check(
      'the grants the login could reach were snapshotted before any cascade',
      snapshot.length === 1,
      `${snapshot.length} grant(s) recorded`
    )
  }

  const { data: chart } = await db.from('org_people').select('*').eq('id', orgPerson.id).single()
  check('org chart marked departed, not deleted', chart.status === 'departed', `status=${chart.status}`)
  check('the chart carries the departure date', chart.departed_on === separatedOn, `departed_on=${chart.departed_on}`)

  // ── Idempotence: a re-run must change nothing ─────────────────────────────
  const before = deactivated.deactivated_at
  const second = await applySeparation(db, writer, separated, 'verify script (second run)')
  const { data: again } = await db.from('team_members').select('deactivated_at').eq('id', member.id).single()
  check('a second run does not move the revocation date', again.deactivated_at === before)
  check('a second run reports no new work', second.applied.length === 0, second.applied.join('; '))
  const { data: stepsAgain } = await db.from('personnel_offboarding').select('id').eq('personnel_id', person.id)
  check(
    'a second run does not duplicate the checklist',
    (stepsAgain ?? []).length === OFFBOARDING_TEMPLATE.length,
    `${(stepsAgain ?? []).length} steps`
  )

  // ── The guards ─────────────────────────────────────────────────────────────
  await writer
    .from('personnel')
    .update({ legal_hold: true, legal_hold_reason: 'verification' })
    .eq('id', person.id)
  const { error: heldDelete } = await writer.from('personnel').delete().eq('id', person.id)
  check(
    'a held record refuses deletion, in words',
    Boolean(heldDelete) && /legal hold/i.test(heldDelete!.message),
    heldDelete?.message ?? 'DELETED — the guard did not fire'
  )
  await writer.from('personnel').update({ legal_hold: false, legal_hold_reason: null }).eq('id', person.id)

  // ── The audit trail ────────────────────────────────────────────────────────
  const { data: log } = await db
    .from('activity_log')
    .select('table_name, action, field_changes')
    .eq('record_id', person.id)
    .eq('action', 'UPDATE')
    .order('created_at', { ascending: false })
    .limit(5)
  const sepEntry = (log ?? []).find((l: { field_changes: Record<string, unknown> | null }) =>
    l.field_changes && 'separation_type' in l.field_changes)
  check(
    'the audit log diffed the separation field by field',
    Boolean(sepEntry),
    sepEntry ? Object.keys(sepEntry.field_changes as object).join(', ') : 'no field_changes found'
  )
} catch (err) {
  failures += 1
  console.error(`\n✗ threw: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  // Reverse order, so children go before parents.
  for (const step of cleanup.reverse()) {
    try { await step() } catch (err) { console.error(`  cleanup failed: ${String(err)}`) }
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}
