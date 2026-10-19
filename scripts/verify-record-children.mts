/**
 * The child registry, exercised against the live database.
 *
 * ⚠ A LISTED ROUTE IS NOT AN ANSWERING ONE, AND BEHIND AUTH A CURL CANNOT TELL
 * YOU WHICH IT IS (§12) — it returns the same redirect either way. The route
 * handlers themselves cannot be called here (getViewer reads cookies), so this
 * exercises the two pieces that carry all the behaviour: the guard, which takes
 * its Viewer as a PARAMETER precisely so it can be asked questions outside a
 * request, and the normalise-then-write pipeline the handlers run verbatim.
 *
 * What it proves, each of which was broken, missing or unprovable before:
 *   1. The record check refuses a row whose parent the viewer may not touch —
 *      including, for an admin with no step-up, a project marked confidential.
 *      That is the hole six route files had: they took an id and wrote.
 *   2. A PATCH leaves the columns the caller did not mention alone.
 *   3. A status flip stamps its timestamp server-side, and clears it again.
 *   4. A Postgres enum is refused at the edge rather than coming back 22P02.
 *   5. Exactly one parent, and a parentless row only where that is legitimate.
 *
 * Everything it writes is on a scratch project it creates and deletes. Run:
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-record-children.mts
 */

import { strict as assert } from 'node:assert'

import type { Viewer } from '../src/lib/auth/viewer.ts'
import { guardCreateScope, guardExistingRow } from '../src/lib/records/children-access.ts'
import { applyStamp, CHILDREN, type ChildSpec } from '../src/lib/records/children.ts'
import { normalizePayload } from '../src/lib/registry/fields.ts'
import { createUntypedAdminClient } from '../src/lib/supabase/admin.ts'

const db = createUntypedAdminClient()

let checks = 0
function check(label: string, cond: boolean, detail = '') {
  checks++
  if (!cond) {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    throw new Error(`FAILED: ${label}`)
  }
  console.log(`  ✓ ${label}`)
}

/** A viewer of a given role, built by hand — getViewer() needs a request. */
function viewerOf(role: Viewer['role'], grants: string[] = []): Viewer {
  return {
    authUserId: 'ec89f3ee-534d-4e32-96a3-1054734d0adc',
    email: 'verify@berwilson.com',
    role,
    isAdmin: role === 'admin',
    teamMemberId: null,
    teamMemberName: 'Verification',
    grantedProjectIds: grants,
    grantedOpportunityIds: [],
    preMigration: false,
    bootstrap: false,
  }
}

const admin = viewerOf('admin')
const pm = viewerOf('project_manager')
const member = viewerOf('member')

/** The write the route performs, run through the identical pipeline. */
async function createRow(
  spec: ChildSpec,
  scope: Record<string, string | null>,
  body: Record<string, unknown>
) {
  const parsed = normalizePayload(spec, body, { partial: false })
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error)
  const value: Record<string, unknown> = { ...scope }
  for (const [c, v] of Object.entries(spec.defaults ?? {})) value[c] = v
  Object.assign(value, parsed.value)
  applyStamp(spec, body, value)
  const { data, error } = await db
    .from(spec.table)
    .insert(value)
    .select(spec.select ?? '*')
    .maybeSingle()
  if (error) throw new Error(`${spec.table} insert: ${error.message}`)
  return data as Record<string, unknown>
}

async function patchRow(spec: ChildSpec, id: string, body: Record<string, unknown>) {
  const parsed = normalizePayload(spec, body, { partial: true })
  const value: Record<string, unknown> = parsed.ok ? parsed.value : {}
  applyStamp(spec, body, value)
  if (spec.touchUpdatedAt) value.updated_at = new Date().toISOString()
  const { data, error } = await db
    .from(spec.table)
    .update(value)
    .eq('id', id)
    .select(spec.select ?? '*')
    .maybeSingle()
  if (error) throw new Error(`${spec.table} update: ${error.message}`)
  return data as Record<string, unknown>
}

async function main() {
  // ── A scratch project nothing else references ───────────────────────────────
  const stamp = new Date().toISOString()
  const { data: created, error: projectError } = await db
    .from('projects')
    .insert({ name: `ZZ registry verification ${stamp}`, sector: 'infrastructure' })
    .select('id, name')
    .single()
  if (projectError) throw new Error(`could not create scratch project: ${projectError.message}`)
  const projectId = (created as { id: string }).id
  console.log(`\nScratch project ${projectId}\n`)

  const cleanup: Array<[string, string]> = []

  try {
    // ── 1. Exactly one parent ────────────────────────────────────────────────
    console.log('Parent resolution')
    const ms = CHILDREN.milestones

    const neither = await guardCreateScope(admin, ms, {})
    check('a milestone with no parent is a 400, not a row', !neither.ok)

    const both = await guardCreateScope(admin, ms, {
      project_id: projectId,
      opportunity_id: projectId,
    })
    check('naming both a project and an opportunity is refused', !both.ok)

    const one = await guardCreateScope(admin, ms, { project_id: projectId })
    check('exactly one parent resolves', one.ok)
    assert.ok(one.ok)
    check(
      'the scope written is the pair, with the other side null',
      one.value.project_id === projectId && one.value.opportunity_id === null
    )

    // Only compliance may have no record at all — a company-level obligation.
    const companyLevel = await guardCreateScope(admin, CHILDREN['compliance-items'], {})
    check('a compliance item with no record is allowed for an admin', companyLevel.ok)
    const companyLevelMember = await guardCreateScope(member, CHILDREN['compliance-items'], {})
    check('…and refused for a non-admin, since no record answers for it', !companyLevelMember.ok)

    // ── 2. The access check, on create and on an existing row ────────────────
    console.log('\nAccess')
    const pmDenied = await guardCreateScope(pm, ms, { project_id: projectId })
    check('a project_manager with no grant cannot create on that project', !pmDenied.ok)

    const pmGranted = await guardCreateScope(viewerOf('project_manager', [projectId]), ms, {
      project_id: projectId,
    })
    check('…and can once the grant exists', pmGranted.ok)

    const milestone = await createRow(ms, one.value, {
      stage: 'bid',
      label: 'Registry verification milestone',
    })
    cleanup.push(['milestones', milestone.id as string])
    check('the row landed on the project', milestone.project_id === projectId)
    check('an un-ticked milestone has no completion time', milestone.completed_at === null)

    const rowOk = await guardExistingRow(admin, ms, milestone.id as string)
    check('an admin may edit a row on an open project', rowOk.ok)

    const rowPm = await guardExistingRow(pm, ms, milestone.id as string)
    check('a project_manager with no grant may not — read off the ROW, not the body', !rowPm.ok)

    const missing = await guardExistingRow(admin, ms, '00000000-0000-0000-0000-000000000000')
    check('a row that does not exist answers 404, not 403', !missing.ok)
    assert.ok(!missing.ok)
    check('…and says so in words', missing.response.status === 404)

    // ⚠ THE GAP THIS REFACTOR CLOSES. `confidential` is containment and applies
    // to both admins (§8); a step-up is the only way in, and these six tables
    // never asked.
    console.log('\nConfidentiality')
    await db.from('projects').update({ confidential: true }).eq('id', projectId)
    const locked = await guardExistingRow(admin, ms, milestone.id as string)
    check('an admin with no step-up is refused a row on a protected project', !locked.ok)
    const lockedCreate = await guardCreateScope(admin, ms, { project_id: projectId })
    check('…and cannot create one there either', !lockedCreate.ok)
    await db.from('projects').update({ confidential: false }).eq('id', projectId)
    const unlocked = await guardExistingRow(admin, ms, milestone.id as string)
    check('unprotecting the project restores the write', unlocked.ok)

    // ── 3. Partial updates ───────────────────────────────────────────────────
    console.log('\nPartial writes')
    const fin = CHILDREN.financing
    const financing = await createRow(fin, { project_id: projectId, opportunity_id: null }, {
      lender: 'Verification Bank',
      senior_debt: '1,250,000',
      notes: 'created by verify-record-children',
    })
    cleanup.push(['financing_structures', financing.id as string])
    check('money typed with separators stored as a number', Number(financing.senior_debt) === 1250000)

    const patched = await patchRow(fin, financing.id as string, { lender: 'Second Bank' })
    check('the mentioned column changed', patched.lender === 'Second Bank')
    check(
      'the unmentioned column SURVIVED — the bug financing/[id] carried',
      Number(patched.senior_debt) === 1250000,
      `senior_debt is now ${String(patched.senior_debt)}`
    )
    check('and so did the one after it', patched.notes === 'created by verify-record-children')

    // ── 4. Server-side stamps ────────────────────────────────────────────────
    console.log('\nStamps')
    const dd = CHILDREN['dd-items']
    const item = await createRow(dd, { project_id: projectId, opportunity_id: null }, {
      category: 'legal',
      item: 'Registry verification item',
      severity: 'blocker',
    })
    cleanup.push(['dd_items', item.id as string])
    check('a create takes the spec default', item.status === 'open')
    check('an enum value inside the vocabulary is stored', item.severity === 'blocker')
    check('nothing is resolved yet', item.resolved_at === null)

    const resolved = await patchRow(dd, item.id as string, { status: 'resolved' })
    check('resolving stamps resolved_at server-side', typeof resolved.resolved_at === 'string')
    const reopened = await patchRow(dd, item.id as string, { status: 'open' })
    check('reopening clears it again', reopened.resolved_at === null)

    const ticked = await patchRow(ms, milestone.id as string, { completed: true })
    check('ticking a milestone stamps completed_at', typeof ticked.completed_at === 'string')
    const unticked = await patchRow(ms, milestone.id as string, { completed: false })
    check('un-ticking clears it', unticked.completed_at === null)

    // ── 5. An enum outside the vocabulary never reaches Postgres ─────────────
    console.log('\nEdge validation')
    const badSeverity = normalizePayload(dd, { category: 'legal', item: 'x', severity: 'high' })
    check('severity "high" is refused before any query', !badSeverity.ok)
    const badStatus = normalizePayload(CHILDREN['compliance-items'], {
      framework: 'cmmc',
      requirement: 'x',
      status: 'done',
    })
    check('an unknown compliance status is refused too', !badStatus.ok)
  } finally {
    // ── Clean up, children first, then assert nothing is left ────────────────
    console.log('\nCleanup')
    for (const [table, id] of cleanup.reverse()) {
      await db.from(table).delete().eq('id', id)
    }
    await db.from('projects').delete().eq('id', projectId)

    const { data: leftovers } = await db.from('projects').select('id').eq('id', projectId)
    check('the scratch project is gone', (leftovers ?? []).length === 0)
    for (const table of ['milestones', 'dd_items', 'financing_structures']) {
      const { data: rows } = await db.from(table).select('id').eq('project_id', projectId)
      check(`no ${table} left behind`, (rows ?? []).length === 0)
    }
  }

  console.log(`\n${checks} checks passed.\n`)
}

/**
 * ⚠ NOT `process.exit` IN A FINALLY (§12) — it swallows the throw it is
 * unwinding, and a verification script that exits 0 on a failure is worse than
 * no verification script.
 */
main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
