/**
 * What the text actually says, and where its link points.
 *
 * This is the one message in the platform that announces a record NOBODY
 * approved, so the body has to carry three things every time: what it is, what
 * happens next, and a tap that reaches it.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { CreatedRecord } from '@/lib/records/from-recording'
import { composeRecordAlert, recordPath } from './record-alert'

const APP = 'https://richards-mac-studio.tail9acc02.ts.net'

function created(over: Partial<CreatedRecord> = {}): CreatedRecord {
  return {
    kind: 'opportunity',
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Synetra',
    oppType: 'joint_venture',
    tldr: 'Synetra builds modular switchgear and wants Ber Wilson as the EPC on two Utah sites.',
    nextStep: 'Return the signed MNDA (by 2026-10-24)',
    fact: { kind: 'executed_document', detail: 'BW MNDA Synetra (2026-10-19)' },
    ...over,
  }
}

/** APP_URL is read at call time, so each test sets what it needs. */
function withAppUrl<T>(value: string | undefined, fn: () => T): T {
  const before = process.env.APP_URL
  if (value === undefined) delete process.env.APP_URL
  else process.env.APP_URL = value
  try {
    return fn()
  } finally {
    if (before === undefined) delete process.env.APP_URL
    else process.env.APP_URL = before
  }
}

test('a single record reads as what it is, what is next, and a link', () => {
  const body = withAppUrl(APP, () => composeRecordAlert([created()]))
  const lines = body.split('\n')
  assert.equal(lines[0], 'New opportunity (joint venture): Synetra')
  assert.match(body, /modular switchgear/)
  assert.match(body, /^Next: Return the signed MNDA \(by 2026-10-24\)$/m)
  assert.equal(lines[lines.length - 2], '— Pepper')
  assert.equal(lines[lines.length - 1], `${APP}/opportunities/11111111-2222-3333-4444-555555555555`)
})

test('the type Richard asked to be tagged is in the first line', () => {
  const jv = withAppUrl(APP, () => composeRecordAlert([created({ oppType: 'joint_venture' })]))
  const buy = withAppUrl(APP, () => composeRecordAlert([created({ oppType: 'acquisition' })]))
  assert.match(jv, /^New opportunity \(joint venture\)/)
  assert.match(buy, /^New opportunity \(acquisition\)/)
})

test('an untyped opportunity says so rather than claiming a type', () => {
  const body = withAppUrl(APP, () => composeRecordAlert([created({ oppType: null })]))
  assert.match(body, /opportunity \(type not stated on the call\)/)
})

test('a project is labelled a project and links to the projects route', () => {
  const body = withAppUrl(APP, () =>
    composeRecordAlert([created({ kind: 'project', oppType: null, name: 'Tooele Pad B' })])
  )
  assert.match(body, /^New project: Tooele Pad B/)
  assert.match(body, /\/projects\/11111111-2222-3333-4444-555555555555$/m)
})

test('a missing next step is named in words, never left as a dangling label', () => {
  // §12: a bare em dash at a value's own weight reads as a failed render, and
  // "Next:" with nothing after it reads worse — it looks like a truncated text.
  const body = withAppUrl(APP, () => composeRecordAlert([created({ nextStep: null })]))
  assert.match(body, /Next: not set on the call — needs one/)
})

test('several records off one recording are ONE text, each with its own link', () => {
  const body = withAppUrl(APP, () =>
    composeRecordAlert(
      [
        created({ name: 'Synetra', id: 'aaaaaaaa-0000-0000-0000-000000000001' }),
        created({ name: 'Firm Power', id: 'aaaaaaaa-0000-0000-0000-000000000002', oppType: 'acquisition' }),
      ],
      { recordedOn: '2026-10-19' }
    )
  )
  assert.match(body, /^2 new records off a recording \(2026-10-19\):/)
  assert.match(body, /Synetra — new opportunity \(joint venture\)/)
  assert.match(body, /Firm Power — new opportunity \(acquisition\)/)
  assert.equal((body.match(/\/opportunities\//g) ?? []).length, 2)
  assert.ok(body.trim().endsWith('— Pepper'), 'the signature closes the message')
})

test('with no APP_URL the message says why there is no link rather than linking to nowhere', () => {
  const body = withAppUrl(undefined, () => composeRecordAlert([created()]))
  assert.doesNotMatch(body, /https?:\/\//)
  assert.match(body, /no APP_URL configured/)
})

test('a non-http APP_URL is refused, not pasted into a text', () => {
  const body = withAppUrl('localhost:3000', () => composeRecordAlert([created()]))
  assert.doesNotMatch(body, /localhost/)
})

test('the route for each kind is the one the app serves', () => {
  assert.equal(recordPath('project', 'abc'), '/projects/abc')
  assert.equal(recordPath('opportunity', 'abc'), '/opportunities/abc')
})
