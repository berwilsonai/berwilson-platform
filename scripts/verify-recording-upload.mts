/**
 * Does an uploaded recording actually get the full treatment, on the record the
 * uploader chose?
 *
 * ⚠ REAL WHISPER, REAL SPEECH, REAL DATABASE. The thing being proved is a chain
 * of eight phases and a rewired pair of live crons, and every link of it fails
 * in a way a mock cannot show: whisper is spawned, the thread goes through
 * `summarizePending` and `runRecordingPhases`, the link is asserted rather than
 * matched, obligations are extracted by a model, and the meeting register is
 * written last. A fixture that hands the pass a transcript would prove the
 * plumbing after the only interesting part.
 *
 * Generate the audio first (macOS TTS — a real file, really transcribed):
 *   say -o /tmp/speech.aiff "…" && afconvert -f m4af -d aac /tmp/speech.aiff /tmp/speech.m4a
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-recording-upload.mts <path-to-audio>
 *
 * Creates a scratch project, uploads onto it, asserts, then removes everything
 * it made — including the thread, the meeting and the commitments, which are
 * not cascaded by the project delete.
 */

import { readFileSync } from 'node:fs'

import { ingestUploadedRecording } from '@/lib/audio/upload'
import { createAdminClient } from '@/lib/supabase/admin'

const audioPath = process.argv[2]
if (!audioPath) {
  console.error('usage: verify-recording-upload.mts <path-to-audio>')
  process.exit(1)
}

const SCRATCH_NAME = `Zzz Scratch Verification ${Date.now().toString().slice(-6)}`
let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const db = createAdminClient()
let projectId: string | null = null
let threadId: string | null = null
let meetingId: string | null = null

async function cleanup() {
  console.log('\nCleaning up')
  if (threadId) {
    // Order matters: commitments and links point at the thread.
    await db.from('commitments').delete().eq('thread_id', threadId)
    await db.from('thread_links').delete().eq('thread_id', threadId)
    await db.from('thread_chunks').delete().eq('thread_id', threadId)
    await db.from('email_threads').delete().eq('id', threadId)
    console.log('  · thread, links, passages and obligations removed')
  }
  if (meetingId) {
    await db.from('meetings').delete().eq('id', meetingId)
    console.log('  · meeting removed')
  }
  if (projectId) {
    await db.from('email_intake_sessions').delete().eq('drive_file_id', threadId ?? '')
    await db.from('updates').delete().eq('project_id', projectId)
    await db.from('tasks').delete().eq('project_id', projectId)
    await db.from('projects').delete().eq('id', projectId)
    console.log(`  · scratch project removed`)
  }
}

try {
  // ── A record to upload onto ───────────────────────────────────────────────
  const { data: project, error: pErr } = await db
    .from('projects')
    .insert({ name: SCRATCH_NAME, sector: 'infrastructure', stage: 'pursuit', status: 'active' })
    .select('id, name')
    .single()
  if (pErr || !project) throw new Error(`could not create the scratch project: ${pErr?.message}`)
  projectId = (project as { id: string }).id
  console.log(`\nScratch project: ${SCRATCH_NAME}`)

  // ── The upload ────────────────────────────────────────────────────────────
  console.log('\nTranscribing and filing (real whisper — this takes a few seconds)')
  const started = Date.now()
  const res = await ingestUploadedRecording({
    bytes: readFileSync(audioPath),
    fileName: 'site-walk-note.m4a',
    target: { kind: 'project', id: projectId, name: SCRATCH_NAME },
    title: 'Site walk note',
    occurredOn: '2026-10-19',
    uploadedBy: 'Richard White',
  })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  threadId = res.threadId
  meetingId = res.meetingId

  check('the upload succeeded', res.ok, res.error ?? '')
  if (!res.ok) throw new Error('nothing further can be checked')
  console.log(`    ${res.transcriptChars} characters in ${elapsed}s`)
  check('whisper produced real text', res.transcriptChars > 200, `${res.transcriptChars} chars`)

  // ── The thread, and what it says ──────────────────────────────────────────
  const { data: thread } = await db
    .from('email_threads')
    .select('id, subject, raw_markdown, pipeline, gmail_thread_id, summary')
    .eq('id', threadId!)
    .maybeSingle()
  const t = thread as Record<string, unknown> | null
  check('a thread was stored', Boolean(t))
  check('its fingerprint says which door it came through', String(t?.gmail_thread_id).startsWith('upload:'), String(t?.gmail_thread_id))
  check('the transcript is in the body', /county recorder/i.test(String(t?.raw_markdown)))
  check('the provenance line names the record and the uploader', /uploaded onto .*Scratch Verification.*by Richard White/is.test(String(t?.raw_markdown)))

  // ── THE POINT: the link is asserted, not matched ──────────────────────────
  const { data: links } = await db
    .from('thread_links')
    .select('record_kind, record_id, certainty, reason')
    .eq('thread_id', threadId!)
  const rows = (links ?? []) as { record_kind: string; record_id: string; certainty: string; reason: string }[]
  check('the thread is linked to exactly the record chosen', rows.some((l) => l.record_id === projectId), JSON.stringify(rows))
  const mine = rows.find((l) => l.record_id === projectId)
  check("the link's certainty is `linked`, not a guess", mine?.certainty === 'linked', String(mine?.certainty))
  check('and it says why, in words', /uploaded onto/.test(mine?.reason ?? ''), mine?.reason)

  // ── The phases actually ran ───────────────────────────────────────────────
  console.log(`\n    phases: ${JSON.stringify(res.phases)}`)
  check('passages were indexed for retrieval', await indexed(threadId!), 'no thread_chunks rows')
  check(
    'an update was posted or staged on the record',
    res.phases.updatesPosted + res.phases.updatesStaged > 0,
    JSON.stringify(res.phases)
  )
  check('a meeting was registered', Boolean(res.meetingId))

  // The transcript names two dated follow-ups, so the obligation pass has
  // something real to find. Reported rather than asserted hard: the model's
  // recall is not what this script is testing, and a flaky assert on a model's
  // output is a test nobody trusts (§12).
  console.log(
    `    obligations found: ${res.phases.commitments}${res.phases.commitments === 0 ? '  (reported, not asserted — model recall is not what this proves)' : ''}`
  )

  const { data: meeting } = await db
    .from('meetings')
    .select('id, title, scope, project_id, transcript')
    .eq('id', res.meetingId!)
    .maybeSingle()
  const m = meeting as Record<string, unknown> | null
  check('the meeting carries the transcript', String(m?.transcript ?? '').length > 200)
  check(
    'and it is filed on the record, not left unfiled',
    m?.project_id === projectId || m?.scope === 'project',
    `scope=${String(m?.scope)} project_id=${String(m?.project_id)}`
  )

  // ── Promotion ran and correctly refused ───────────────────────────────────
  check('the promotion gate ran', res.promotion !== null)
  check(
    'and created nothing, because the record already exists',
    (res.promotion?.created.length ?? 0) === 0,
    JSON.stringify(res.promotion?.created)
  )

  for (const n of res.notes) console.log(`    · ${n.slice(0, 150)}`)
} catch (err) {
  console.error('\nverification threw:', err)
  fail++
}

await cleanup().catch((e) => console.error('cleanup failed:', e))
console.log(`\n${pass} passed, ${fail} failed\n`)
process.exitCode = fail === 0 ? 0 : 1

async function indexed(id: string): Promise<boolean> {
  const { count } = await db
    .from('thread_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', id)
  return (count ?? 0) > 0
}
