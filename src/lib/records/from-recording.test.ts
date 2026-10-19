/**
 * The rules that decide whether a recording creates a deal, and what the text
 * about it says. Every one of these is a judgement a human would otherwise make.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MeetingIntakeExtraction, MeetingReferencedRecord } from '@/lib/ai/prompts/meeting-intake'
import { composeTldr, datedNextStep, destinationFor, opportunityType, succinct } from './from-recording'

function ref(over: Partial<MeetingReferencedRecord> = {}): MeetingReferencedRecord {
  return {
    kind: 'opportunity',
    name: 'Synetra',
    note: null,
    discussion: null,
    location: null,
    sector: null,
    estimated_value: null,
    ...over,
  } as MeetingReferencedRecord
}

function extraction(over: Partial<MeetingIntakeExtraction> = {}): MeetingIntakeExtraction {
  return {
    title: 'Synetra / Ber Wilson',
    meeting_date: '2026-10-19',
    summary: 'A first conversation about working together.',
    minutes: null,
    attendees: [],
    decisions: [],
    referenced_records: [],
    tasks: [],
    confidence: 0.8,
    ...over,
  } as MeetingIntakeExtraction
}

// ─── the dated next step ─────────────────────────────────────────────────────

test('a task with a due date and a matching hint is this record’s next step', () => {
  const e = extraction({
    tasks: [
      { title: 'Send the MNDA', what: null, why: null, how: null, assignee: null, due_date: null, record_hint: 'Synetra' },
      { title: 'Return the signed LOI', what: null, why: null, how: null, assignee: null, due_date: '2026-10-24', record_hint: 'Synetra' },
    ],
  })
  const step = datedNextStep(e, 'Synetra', false)
  assert.equal(step?.label, 'Return the signed LOI (by 2026-10-24)')
  assert.equal(step?.date, '2026-10-24')
})

test('a task with no due date is never a hard fact, however keen it sounds', () => {
  const e = extraction({
    tasks: [
      { title: 'Circle back and move forward', what: null, why: null, how: null, assignee: null, due_date: null, record_hint: 'Synetra' },
    ],
  })
  assert.equal(datedNextStep(e, 'Synetra', true), null)
})

test('a hint-less task counts only when the meeting named ONE record', () => {
  const e = extraction({
    tasks: [
      { title: 'Draft the term sheet', what: null, why: null, how: null, assignee: null, due_date: '2026-11-01', record_hint: null },
    ],
  })
  // One record in the room: the task can only be about it.
  assert.equal(datedNextStep(e, 'Synetra', true)?.date, '2026-11-01')
  // Two in the room: an unattributed task belongs to neither, or a broker call
  // would create every site it named off one unrelated follow-up.
  assert.equal(datedNextStep(e, 'Synetra', false), null)
})

test('a hint naming a DIFFERENT record does not carry to this one', () => {
  const e = extraction({
    tasks: [
      { title: 'Order the survey', what: null, why: null, how: null, assignee: null, due_date: '2026-10-30', record_hint: 'Steelton' },
    ],
  })
  assert.equal(datedNextStep(e, 'Synetra', false), null)
})

// ─── which table, and which tag ──────────────────────────────────────────────

test('the opportunity side is the default and a project must be asked for', () => {
  assert.equal(destinationFor(ref({ kind: 'project' })), 'project')
  assert.equal(destinationFor(ref({ kind: 'opportunity' })), 'opportunity')
  // Anything the model did not label is a pursuit, not work we hold.
  assert.equal(destinationFor(ref({ kind: undefined as unknown as 'project' })), 'opportunity')
})

test('partnership and acquisition language is read off what was said', () => {
  assert.equal(opportunityType(ref({ discussion: 'They proposed a joint venture on the site.' })), 'joint_venture')
  assert.equal(opportunityType(ref({ discussion: 'We signed an MNDA with non-circumvention.' })), 'joint_venture')
  assert.equal(opportunityType(ref({ note: 'Potential acquisition of their fabrication arm.' })), 'acquisition')
  assert.equal(opportunityType(ref({ discussion: 'An LOI is being drafted.' })), 'acquisition')
  assert.equal(opportunityType(ref({ discussion: 'They would take an equity stake.' })), 'investment')
})

test('silence about the type is left as silence, not guessed', () => {
  assert.equal(opportunityType(ref({ discussion: 'We walked the site and talked about power.' })), null)
})

// ─── the line that goes in the text ──────────────────────────────────────────

test('the TLDR is this record’s own paragraph, never the meeting’s', () => {
  const e = extraction({ summary: 'Steelton, Riverdale and Synetra were all discussed.' })
  const r = ref({ discussion: 'Synetra builds modular switchgear and wants Ber Wilson as the EPC on two Utah sites.' })
  const tldr = composeTldr(r, e)
  assert.match(tldr, /modular switchgear/)
  assert.doesNotMatch(tldr, /Riverdale/)
})

test('with no paragraph of its own it falls back to the meeting summary', () => {
  const e = extraction({ summary: 'A first conversation about working together.' })
  assert.equal(composeTldr(ref(), e), 'A first conversation about working together.')
})

test('a record with nothing said about it still produces a readable line', () => {
  const e = extraction({ summary: '' })
  assert.equal(composeTldr(ref(), e), 'Read off a recording; no detail was stated.')
})

test('succinct cuts at a sentence and never mid-word', () => {
  const long =
    'Synetra builds modular switchgear in Houston. They want Ber Wilson as the EPC on two Utah sites. ' +
    'Pricing was not discussed and no timeline was agreed beyond an MNDA.'
  const out = succinct(long)
  assert.ok(out.length <= 191, `too long: ${out.length}`)
  assert.ok(out.endsWith('.') || out.endsWith('…'), `odd ending: ${out}`)
  assert.doesNotMatch(out, /\s\w{1,2}…$/)
})

test('a short line is returned untouched — no ellipsis on a complete sentence', () => {
  assert.equal(succinct('Short and done.'), 'Short and done.')
})
