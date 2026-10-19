/**
 * Does the gate hold against the real register?
 *
 * The unit tests cover the RULES; this covers the two things only live data
 * can: that an existing deal is recognised (so a recording of a Steelton call
 * cannot manufacture a second Steelton), and that a genuinely new name with a
 * hard fact is created exactly once with everything a reader needs on it.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-recording-records.mts
 *
 * Writes and then removes its own rows. Nothing is texted: every send path is
 * exercised with `dryRun`, which still writes the self-loop guard row — that
 * being the half a dry run must not skip.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { promoteRecordingRecords } from '@/lib/records/from-recording'
import { composeRecordAlert, sendRecordAlert } from '@/lib/pepper/record-alert'
import { readJustIn } from '@/lib/records/just-in'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'

const TEST_REF = `voicememo:VERIFY-${Date.now()}`
const NEW_NAME = `Zzz Verify Counterparty ${Date.now().toString().slice(-6)}`

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

function extraction(over: Partial<MeetingIntakeExtraction> = {}): MeetingIntakeExtraction {
  return {
    title: 'Verification call',
    meeting_date: '2026-10-19',
    summary: 'A verification conversation.',
    minutes: null,
    attendees: [],
    decisions: [],
    referenced_records: [],
    tasks: [],
    confidence: 0.9,
    ...over,
  } as MeetingIntakeExtraction
}

async function cleanup() {
  const supabase = createAdminClient()
  // The undo handle, used exactly as a human would use it.
  for (const table of ['projects', 'opportunities'] as const) {
    const { data } = await supabase.from(table).select('id, name').eq('auto_created_from', TEST_REF)
    for (const row of (data ?? []) as { id: string; name: string }[]) {
      await supabase.from(table).delete().eq('id', row.id)
      console.log(`  · removed test ${table} row ${row.name}`)
    }
  }
}

async function main() {
  const supabase = createAdminClient()

  // ── 1. An existing deal is recognised, not duplicated ────────────────────
  console.log('\nAn existing record refuses a create')
  const { data: existingProjects } = await supabase
    .from('projects')
    .select('name')
    .limit(60)
  const names = ((existingProjects ?? []) as { name: string }[]).map((p) => p.name)
  if (names.length === 0) {
    check('there is at least one project to test against', false, 'the register is empty')
  } else {
    const sample = names[0]
    const res = await promoteRecordingRecords({
      extraction: extraction({
        referenced_records: [
          { kind: 'project', name: sample, note: null, discussion: 'Talked about moving forward.', location: null, sector: null, estimated_value: null },
        ],
        // A dated next step, so ONLY gate 1 can be what refuses it.
        tasks: [{ title: 'Follow up', what: null, why: null, how: null, assignee: null, due_date: '2026-11-30', record_hint: sample }],
      }),
      sourceRef: TEST_REF,
      recordedOn: '2026-10-19',
      dryRun: true,
    })
    check(`"${sample}" was not created again`, res.created.length === 0, JSON.stringify(res.created))
    check(
      'and the reason names the record it already is',
      /already a (project|opportunity)|looks like the existing/.test(res.skipped[0]?.why ?? ''),
      res.skipped[0]?.why
    )
  }

  // ── 2. Intent alone is refused ───────────────────────────────────────────
  console.log('\nIntent language alone creates nothing')
  const intentOnly = await promoteRecordingRecords({
    extraction: extraction({
      referenced_records: [
        {
          kind: 'opportunity',
          name: NEW_NAME,
          note: null,
          discussion: 'They want to move forward and discuss further next week. Very positive.',
          location: null,
          sector: null,
          estimated_value: null,
        },
      ],
      tasks: [
        // Keen, and undated — which is the whole point.
        { title: 'Circle back', what: null, why: null, how: null, assignee: null, due_date: null, record_hint: NEW_NAME },
      ],
    }),
    sourceRef: TEST_REF,
    recordedOn: '2026-10-19',
    // No calendar reads: a booked follow-up is a real fact and would make this
    // test depend on whatever is actually on the calendar today.
    mailboxes: [],
    dryRun: true,
  })
  check('nothing was created', intentOnly.created.length === 0, JSON.stringify(intentOnly.created))
  check(
    'and the refusal says what was missing',
    /nothing but intent/.test(intentOnly.skipped[0]?.why ?? ''),
    intentOnly.skipped[0]?.why
  )

  // ── 3. A hard fact creates it, once, with the record filled in ───────────
  console.log('\nA dated next step on a new name creates the record')
  const input = {
    extraction: extraction({
      referenced_records: [
        {
          kind: 'opportunity',
          name: NEW_NAME,
          note: null,
          discussion:
            'They build modular switchgear and want Ber Wilson as the EPC on two Utah sites. An MNDA with non-circumvention was signed on the call.',
          location: 'Salt Lake City, UT',
          sector: 'infrastructure',
          estimated_value: 4_500_000,
        },
      ],
      attendees: [
        { name: 'Ber Wilson', email: null, company: null, title: null, role: null, is_organization: true },
        { name: 'Verify Counterparty Inc', email: null, company: null, title: null, role: null, is_organization: true },
      ],
      tasks: [
        { title: 'Return the countersigned MNDA', what: null, why: null, how: null, assignee: null, due_date: '2026-10-24', record_hint: NEW_NAME },
      ],
    }),
    sourceRef: TEST_REF,
    recordedOn: '2026-10-19',
    mailboxes: [] as string[],
  }

  const first = await promoteRecordingRecords(input)
  check('one record was created', first.created.length === 1, JSON.stringify(first.skipped))
  const made = first.created[0]
  if (made) {
    check('it went to the opportunity side', made.kind === 'opportunity', made.kind)
    check('tagged joint_venture off the MNDA language', made.oppType === 'joint_venture', String(made.oppType))
    check('the gate recorded its own fact', made.fact.kind === 'dated_next_step', JSON.stringify(made.fact))
    check('the TLDR is the deal’s own paragraph', /switchgear/.test(made.tldr), made.tldr)
    check('the next step carries its date', /2026-10-24/.test(made.nextStep ?? ''), String(made.nextStep))

    const { data: row } = await supabase
      .from('opportunities')
      .select('id, name, status, description, next_step, location, estimated_value, source, counterparty, auto_created_from, identified_date')
      .eq('id', made.id)
      .maybeSingle()
    const r = row as Record<string, unknown> | null
    check('the row exists', Boolean(r))
    check('it carries the undo handle', r?.auto_created_from === TEST_REF, String(r?.auto_created_from))
    check('status is identified', r?.status === 'identified', String(r?.status))
    check('the description says it was read off a recording', /read from speech/.test(String(r?.description)))
    check('and names the gate that opened it', /Gate: dated next step/.test(String(r?.description)))
    check('the counterparty is the other side, not us', r?.counterparty === 'Verify Counterparty Inc', String(r?.counterparty))
    check('the figure survived', Number(r?.estimated_value) === 4_500_000, String(r?.estimated_value))

    // ── 4. Who the activity log says did it ──────────────────────────────
    const { data: log } = await supabase
      .from('activity_log')
      .select('action, actor_email, record_id')
      .eq('record_id', made.id)
      .limit(5)
    const actors = ((log ?? []) as { actor_email: string | null }[]).map((l) => l.actor_email)
    check(
      'the activity log names Pepper, not "system"',
      actors.some((a) => (a ?? '').includes('info@berwilson.com')),
      JSON.stringify(actors)
    )

    // ── 5. It cannot be created twice ────────────────────────────────────
    console.log('\nA second run of the same recording creates nothing')
    const second = await promoteRecordingRecords(input)
    check('the re-run created nothing', second.created.length === 0, JSON.stringify(second.created))
    check(
      'and said the name is taken',
      /already (a|exists)|exact name/.test(second.skipped[0]?.why ?? ''),
      second.skipped[0]?.why
    )

    // ── 6. The text, composed and claimed but not sent ───────────────────
    console.log('\nThe text')
    const body = composeRecordAlert([made], { recordedOn: '2026-10-19' })
    console.log(`\n${body.split('\n').map((l) => `    │ ${l}`).join('\n')}\n`)
    check('it names the record', body.includes(made.name))
    check('it is signed by Pepper', body.includes('— Pepper'))
    check('it carries a tappable link', /https?:\/\/\S+\/opportunities\//.test(body))
    check('it stays short enough to read as a text', body.length <= 600, `${body.length} chars`)

    const alert = await sendRecordAlert({ created: [made], recordedOn: '2026-10-19', dryRun: true })
    check(
      'both executives are addressed',
      alert.sent === 2,
      `sent=${alert.sent} failed=${alert.failed} skipped=${alert.skipped} ${JSON.stringify(alert.notes)}`
    )
    check('Pepper did not text herself', !alert.results.some((r) => r.to.startsWith('info@')))

    // ── 7. And it is on the dashboard band ───────────────────────────────
    console.log('\nThe dashboard band')
    const band = await readJustIn({ limit: 8, hidden: new Set() })
    check(
      'the new record is in "Just in"',
      band.some((i) => i.key === `opportunity:${made.id}`),
      band.map((i) => i.title).join(' | ')
    )
    const entry = band.find((i) => i.key === `opportunity:${made.id}`)
    check('it is labelled as a record, not a recording', entry?.kind === 'record', String(entry?.kind))
    check('and its action opens the record', entry?.action.href === `/opportunities/${made.id}`, entry?.action.href)
    // §12: a listed route is not an answering one — assert no NaN/undefined
    // reached anything a reader sees.
    const rendered = JSON.stringify(band)
    check('nothing renders as NaN or undefined', !/NaN|"undefined"/.test(rendered))
  }

  console.log('\nCleaning up')
  await cleanup()

  console.log(`\n${pass} passed, ${fail} failed\n`)
  // ⚠ NOT process.exit — §12: a `finally` that calls it swallows the throw it
  // is unwinding, and here it would also abandon the cleanup above.
  process.exitCode = fail === 0 ? 0 : 1
}

try {
  await main()
} catch (err) {
  console.error('\nverification threw:', err)
  await cleanup().catch(() => {})
  process.exitCode = 1
}
