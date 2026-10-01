/** App-layer verification: the helpers every surface depends on. */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  confidentialProjectIds, dropHidden, hiddenProjectIds, hasStepUp,
  recordStepUp, clearStepUps, scrubHiddenProjects, STEP_UP_TTL_MS,
} from '@/lib/security/confidential'
import { projectIdFromPath, isLockedPath, isLockExemptApiPath } from '@/lib/security/path'

let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fail++
}

// ── path parsing ─────────────────────────────────────────────────────────────
const UUID = 'b1f0c2d3-4444-4555-8666-777788889999'
check('path: /projects/<uuid> parses', projectIdFromPath(`/projects/${UUID}`) === UUID)
check('path: a sub-tab parses', projectIdFromPath(`/projects/${UUID}/documents`) === UUID)
check('path: /api/projects/<uuid> parses', projectIdFromPath(`/api/projects/${UUID}/parcels`) === UUID)
check('path: /projects alone is null', projectIdFromPath('/projects') === null)
check('path: /projects/new is null', projectIdFromPath('/projects/new') === null)
check('path: /projects/locked is null', projectIdFromPath('/projects/locked') === null)
check('path: /api/projects/parents is null', projectIdFromPath('/api/projects/parents') === null)
check('path: the locked page is recognised', isLockedPath('/projects/locked'))
check('path: the confidential toggle is lock-exempt', isLockExemptApiPath(`/api/projects/${UUID}/confidential`))
check('path: a normal project api is NOT exempt', !isLockExemptApiPath(`/api/projects/${UUID}/parcels`))

// ── the real flag, on a real project ─────────────────────────────────────────
const admin = createAdminClient()
const { data: projects } = await admin.from('projects').select('id, name, confidential').order('name')
const subject = projects![0]!
const originally = subject.confidential === true
console.log(`\nTest subject: "${subject.name}"\n`)

const baseline = await confidentialProjectIds()
check('the confidential set reads', baseline !== null, `${baseline?.length ?? '?'} protected`)

await admin.from('projects').update({ confidential: true }).eq('id', subject.id)

const hiddenForCron = await hiddenProjectIds(null)
check('a CRON (no user) sees it hidden', hiddenForCron.has(subject.id))

const FAKE = '00000000-0000-4000-8000-000000000002'
const hiddenNoStepUp = await hiddenProjectIds(FAKE)
check('a user with no step-up sees it hidden', hiddenNoStepUp.has(subject.id))

const sessionId = await recordStepUp({ authUserId: FAKE, projectId: subject.id })
check('a step-up can be recorded', !!sessionId)
check('hasStepUp sees it', await hasStepUp(FAKE, subject.id))
const hiddenAfter = await hiddenProjectIds(FAKE)
check('a stepped-up user does NOT see it hidden', !hiddenAfter.has(subject.id))
check('but the cron still does', (await hiddenProjectIds(null)).has(subject.id))

check('TTL is 30 minutes', STEP_UP_TTL_MS === 30 * 60 * 1000)
check('clearStepUps closes it', (await clearStepUps({ authUserId: FAKE })) === 1)
check('and it is hidden again', (await hiddenProjectIds(FAKE)).has(subject.id))

// ── dropHidden / scrubHiddenProjects ─────────────────────────────────────────
const hidden = new Set([subject.id])
const rows = [{ project_id: subject.id }, { project_id: 'other' }, { project_id: null }]
check('dropHidden removes the hidden row', dropHidden(rows, (r) => r.project_id, hidden).length === 2)
check('dropHidden keeps an untagged row', dropHidden(rows, (r) => r.project_id, hidden).some((r) => r.project_id === null))
check('dropHidden with an empty set is a no-op', dropHidden(rows, (r) => r.project_id, new Set()).length === 3)

const nested = {
  projects: [{ id: subject.id, name: 'secret' }, { id: 'keep', name: 'fine' }],
  summary: { total: 2 },
  dep: { upstream_project_id: subject.id, description: 'x' },
}
const scrubbed = scrubHiddenProjects(nested, hidden)
check('scrub removes a list entry by its own id', scrubbed.value.projects.length === 1)
check('scrub nulls a nested object naming the project', scrubbed.value.dep === null)
check('scrub counts what it removed', scrubbed.removed === 2, `removed=${scrubbed.removed}`)
check('scrub leaves unrelated data alone', scrubbed.value.summary.total === 2)
check('scrub with no hidden projects is identity', scrubHiddenProjects(nested, new Set()).removed === 0)

// ── restore ──────────────────────────────────────────────────────────────────
await admin.from('projects').update({ confidential: originally }).eq('id', subject.id)
const { data: restored } = await admin.from('projects').select('confidential').eq('id', subject.id).single()
check('subject restored to its original state', restored!.confidential === originally)

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILED`}`)
process.exit(fail === 0 ? 0 : 1)
