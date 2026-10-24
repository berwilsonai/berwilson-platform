/**
 * The attendee classifier, tested against the shapes the LIVE corpus actually
 * holds.
 *
 * ⚠ EVERY FIXTURE HERE IS A ROW THAT EXISTS. §12: a fuzzy threshold is measured
 * against the real corpus, never chosen, and a worked example whose figures
 * coincide cannot distinguish two readings of the rule it illustrates. These
 * names were read off `meetings.attendees` on 2026-10-23 — 135 unlinked slots,
 * 96 distinct names — and each test below names the row that forced the rule.
 * Inventing plausible fixtures would have passed on the first version of this
 * classifier, which put "New York Life" and "Golden Dome" in the create queue.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAttendeeFindings,
  classifyAttendee,
  offeredActions,
  type DirectoryFacts,
  type MeetingWithAttendees,
} from './attendee-findings'

/** The live team: Richard, Eric, and the assistant seat. */
function facts(overrides: Partial<DirectoryFacts> = {}): DirectoryFacts {
  return {
    names: new Set(['richard white', 'eric tua’one', 'pepper potts']),
    addresses: new Set(['moose@berwilson.com', 'tuaone@berwilson.com', 'info@berwilson.com']),
    addressLocalParts: new Set(['moose', 'tuaone', 'info']),
    firstNames: new Map([
      ['richard', 1],
      ['eric', 1],
      ['pepper', 1],
    ]),
    organizationNames: new Set(['bloom energy', 'zenthium ai', 'ber wilson']),
    ...overrides,
  }
}

// ─── Us ──────────────────────────────────────────────────────────────────────

test('our own mailbox as an attendee name is internal, not a new contact', () => {
  // Live: `moose@berwilson.com` and `tuaone@berwilson.com` each appear on five
  // of the eighteen recorded meetings.
  const c = classifyAttendee({ name: 'moose@berwilson.com' }, facts())
  assert.equal(c.kind, 'internal')
  assert.equal(c.email, 'moose@berwilson.com')
  assert.equal(offeredActions(c.kind).create, false)
})

test('a first name unique on the team is one of ours', () => {
  // Live: "Eric" on five meetings, with the company "Ber Wilson".
  assert.equal(classifyAttendee({ name: 'Eric', org: 'Ber Wilson' }, facts()).kind, 'internal')
})

test('a first name that TWO of us answer to is undecidable, never resolved', () => {
  // §12: ambiguity must mean NO match, and one hit is an unchallenged match
  // rather than a unique one. A second Eric must break the rule above, not be
  // silently preferred.
  const twoErics = facts({ firstNames: new Map([['eric', 2]]) })
  assert.equal(classifyAttendee({ name: 'Eric' }, twoErics).kind, 'fragment')
})

test('a nickname that is one of our mailboxes is one of ours', () => {
  // Live: "Moose" / "Staff/Advisor" / company "Ber Wilson". The team row says
  // "Eric", so no first-name map can hold this; the mailbox local part can.
  assert.equal(classifyAttendee({ name: 'Moose' }, facts()).kind, 'internal')
})

// ─── Our own company and its labels ──────────────────────────────────────────

test('our own company in the person field is an organization, never a person', () => {
  // Live: "Ber Wilson" as an ATTENDEE on five meetings. Creating it would put
  // "attended a call" on our own company's profile.
  const c = classifyAttendee({ name: 'Ber Wilson', org: 'Ber Wilson' }, facts())
  assert.equal(c.kind, 'organization')
  assert.equal(offeredActions(c.kind).create, false)
})

test('a group inside our company is a label and offers only a skip', () => {
  // Live: "Ber Wilson Executive Team" and "Ber Wilson Lead".
  for (const name of ['Ber Wilson Executive Team', 'Ber Wilson Lead']) {
    const c = classifyAttendee({ name, org: 'Ber Wilson' }, facts())
    assert.equal(c.kind, 'label', name)
    const a = offeredActions(c.kind)
    assert.equal(a.create, false)
    assert.equal(a.link, false)
    assert.equal(a.skip, true)
  }
})

// ─── Organizations ───────────────────────────────────────────────────────────

test('an agency name is an organization', () => {
  // Live: "Army Corps of Engineers", "Department of Defense".
  assert.equal(classifyAttendee({ name: 'Army Corps of Engineers' }, facts()).kind, 'organization')
  assert.equal(classifyAttendee({ name: 'Department of Defense' }, facts()).kind, 'organization')
})

test('an org-shaped ROLE convicts a name no word list can', () => {
  // Live: "Dell" / "GPU Supplier". One word, no suffix — only the role says it.
  assert.equal(
    classifyAttendee({ name: 'Dell', role: 'GPU Supplier' }, facts()).kind,
    'organization',
  )
})

test('a contact already filed as an organization is one here too', () => {
  // §12: a row beats a word list. "Zenthium" is heard on a call; "Zenthium AI"
  // is in the directory, and nameMatches reaches it (surname whole, an extra
  // token on the directory record is not a disagreement).
  assert.equal(classifyAttendee({ name: 'Zenthium' }, facts()).kind, 'organization')
  assert.equal(classifyAttendee({ name: 'Bloom Energy' }, facts()).kind, 'organization')
})

test('an acronym and a brand with internal capitals are organizations', () => {
  // Live: "GRC", "HTS", "QTS", "TensorIQ".
  for (const name of ['GRC', 'HTS', 'QTS']) {
    assert.equal(classifyAttendee({ name }, facts()).kind, 'organization', name)
  }
  assert.equal(classifyAttendee({ name: 'TensorIQ' }, facts()).kind, 'organization')
})

test('the model’s organization flag may convict and never acquit', () => {
  // §12, measured the hard way: reading the flag with `??` and falling back to a
  // name test only when absent let `is_organization: false` silently disable the
  // rule. A true flag decides; a false one does not get a vote.
  assert.equal(classifyAttendee({ name: 'Acme Holdings', is_organization: true }, facts()).kind, 'organization')
  assert.equal(
    classifyAttendee({ name: 'Army Corps of Engineers', is_organization: false }, facts()).kind,
    'organization',
    'a false flag must not rescue an agency name',
  )
})

// ─── Seats and fragments ─────────────────────────────────────────────────────

test('a seat is not a name', () => {
  // Live: "Deseret New CEO", "Tensor Representative", "Speaker/Property Owner".
  for (const name of ['Deseret New CEO', 'Tensor Representative', 'Speaker/Property Owner']) {
    assert.equal(classifyAttendee({ name }, facts()).kind, 'label', name)
  }
})

test('one word that nothing settles may be linked but never created', () => {
  // Live: "Abe", "Amy", "Brooke", "Chuck" — and "Shell", "Oracle", "Raytheon".
  // §12: allow a first name only as a prefix of something longer, never a
  // prefix alone. Both readings are in the corpus and the string cannot tell
  // them apart, so the ANSWER is the same for both: no create.
  for (const name of ['Abe', 'Amy', 'Brooke', 'Shell', 'Oracle']) {
    const c = classifyAttendee({ name }, facts())
    assert.equal(c.kind, 'fragment', name)
    assert.equal(offeredActions(c.kind).create, false, name)
    assert.equal(offeredActions(c.kind).link, true, name)
  }
})

test('a one-word name heard WITH an address is actionable, because an address is identity', () => {
  // Live: "calvin.vass@goavant.net" and "rthompson@goavant.com" are attendee
  // names in their own right. §12: a mailbox is a better key than a name.
  const c = classifyAttendee({ name: 'Calvin', email: 'calvin.vass@goavant.net' }, facts())
  assert.equal(c.kind, 'candidate')
  assert.equal(offeredActions(c.kind).create, true)
})

// ─── Candidates ──────────────────────────────────────────────────────────────

test('a full human name no contact answers to is the one thing that may be created', () => {
  // Live: "Chip Hoisington", "Jonathan Houk", "Sterling Orr", "Cash Patel".
  for (const name of ['Chip Hoisington', 'Jonathan Houk', 'Sterling Orr']) {
    const c = classifyAttendee({ name, org: 'Tensor' }, facts())
    assert.equal(c.kind, 'candidate', name)
    assert.equal(offeredActions(c.kind).create, true, name)
  }
})

// ─── Aggregation ─────────────────────────────────────────────────────────────

function meeting(id: string, attendees: MeetingWithAttendees['attendees'], date = '2026-10-01'): MeetingWithAttendees {
  return { id, title: `call ${id}`, meeting_date: date, scope: 'unfiled', summary: 'a recap', attendees }
}

test('one row per name, however many calls it was heard on', () => {
  // Live: "Ber Wilson" on five calls. Being asked five times is how a queue
  // becomes something nobody works.
  const out = buildAttendeeFindings(
    [
      meeting('a', [{ name: 'Sterling Orr', org: 'Tensor' }]),
      meeting('b', [{ name: 'Sterling Orr' }]),
      meeting('c', [{ name: 'sterling orr' }]),
    ],
    facts(),
    new Set(),
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].meetings.length, 3)
})

test('the verdict reads the MERGED record, not the first sighting', () => {
  // ⚠ THE BUG THE LIVE CORPUS CAUGHT. "Brad" is heard twice — once with no
  // company, once with "Ber Wilson" — and classifying the first sighting while
  // DISPLAYING the merged facts offered one of our own people as an external
  // candidate on a line whose company column said "Ber Wilson".
  const out = buildAttendeeFindings(
    [
      meeting('a', [{ name: 'Brad', role: 'Regional Sales' }], '2026-09-01'),
      meeting('b', [{ name: 'Brad', org: 'Ber Wilson', role: 'Executive/Lead' }], '2026-10-01'),
    ],
    facts(),
    new Set(),
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].classification.kind, 'internal')
  assert.equal(out[0].company, 'Ber Wilson')
})

test('an attendee already linked to a contact is not a finding', () => {
  const out = buildAttendeeFindings(
    [meeting('a', [{ name: 'Sterling Orr', party_id: 'abc' }])],
    facts(),
    new Set(),
  )
  assert.equal(out.length, 0)
})

test('a skipped name never comes back', () => {
  // The tombstone is what lets the queue reach zero.
  const out = buildAttendeeFindings(
    [meeting('a', [{ name: 'Department of Defense' }, { name: 'Sterling Orr' }])],
    facts(),
    new Set(['department of defense']),
  )
  assert.deepEqual(out.map((f) => f.name), ['Sterling Orr'])
})

test('a suspected duplicate is FLAGGED and never folded', () => {
  // Live: "Jaren Davis" / "Jaren L. Davis", "Todd" / "Todd Gorringe",
  // "Jonathan" / "Jonathan Houk". §12: marking is safe where it is wrong and
  // merging settles the other party's obligation.
  const out = buildAttendeeFindings(
    [meeting('a', [{ name: 'Jaren Davis' }, { name: 'Jaren L. Davis' }, { name: 'Sterling Orr' }])],
    facts(),
    new Set(),
  )
  const jaren = out.find((f) => f.name === 'Jaren Davis')!
  assert.deepEqual(jaren.alsoHeardAs, ['Jaren L. Davis'])
  // Two rows, not one: the flag is a warning, not a merge.
  assert.equal(out.filter((f) => f.name.startsWith('Jaren')).length, 2)
  assert.equal(out.find((f) => f.name === 'Sterling Orr')!.alsoHeardAs, undefined)
})

test('a transcription slip is NOT flagged, because the rule does not guess', () => {
  // Live: "Jiren Davis" beside "Jaren Davis" — almost certainly one person, and
  // the name rule declines to say so. §12: a prefix alone is never enough, and
  // loosening the bar moves the cliff rather than removing it. A surname shared
  // with a different first name is how "Cliff" reached an unrelated academic.
  const out = buildAttendeeFindings(
    [meeting('a', [{ name: 'Jaren Davis' }, { name: 'Jiren Davis' }])],
    facts(),
    new Set(),
  )
  assert.equal(out.find((f) => f.name === 'Jaren Davis')!.alsoHeardAs, undefined)
})

test('candidates sort above everything a reader cannot act on', () => {
  const out = buildAttendeeFindings(
    [
      meeting('a', [
        { name: 'Ber Wilson' },
        { name: 'Abe' },
        { name: 'Chip Hoisington' },
        { name: 'Ber Wilson Lead' },
        { name: 'Eric' },
      ]),
    ],
    facts(),
    new Set(),
  )
  assert.deepEqual(
    out.map((f) => f.classification.kind),
    ['candidate', 'fragment', 'internal', 'organization', 'label'],
  )
})
