import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phoneForAddress, formatPhone, phonesBySender, splitMessages } from './signatures'

// The live shapes, copied from real deal threads (measured 2026-10-15).
test('reads a labelled cell out of a signature block', () => {
  const t = `Kind regards,
Ericson H. Tua'one
Founder & Chief Executive, Ber Wilson
C: 385-436-6519
tuaone@berwilson.com`
  assert.equal(phoneForAddress(t, 'tuaone@berwilson.com'), '3854366519')
})

test('reads an unlabelled space-separated number', () => {
  const t = `Best Regards, Mike Delport
Government Contracting Specialist GovPointe 727 614 8844
MDelport@govpointe.com`
  assert.equal(phoneForAddress(t, 'mdelport@govpointe.com'), '7276148844')
})

test('reads dotted and parenthesised forms', () => {
  assert.equal(
    phoneForAddress('James Roth Realtor 801.597.5700 james@thereelsalt.com', 'james@thereelsalt.com'),
    '8015975700'
  )
  assert.equal(
    phoneForAddress('Dana <dana.norton.whitfield@gmail.com> (801) 555-0303', 'dana.norton.whitfield@gmail.com'),
    '8015550303'
  )
})

test('⚠ never hands one person another signature\'s number', () => {
  // Two blocks in one footer. Each number is nearest its own owner.
  const t = `
Seth Lloyd
Elite Solutions
C: 801 555 0101
seth.lloyd@elitesolutions.tech

Sterling Orr
Tensor IQ
C: 801 555 0202
sterling@tensoriq.io
`
  assert.equal(phoneForAddress(t, 'seth.lloyd@elitesolutions.tech'), '8015550101')
  assert.equal(phoneForAddress(t, 'sterling@tensoriq.io'), '8015550202')
})

test('a number in prose belongs to nobody', () => {
  const t = 'Give me a call on 801 555 0100 when you get a chance and we can talk through it.'
  assert.equal(phoneForAddress(t, 'somebody@example.com'), null)
})

test('ignores tracking ids and URLs', () => {
  const t = `Update subscriptions https://mit.us4.list-manage.com/profile?u=1a57a715520513505ca5cda89&id=eb3c6d9
  someone@example.com`
  assert.equal(phoneForAddress(t, 'someone@example.com'), null)
})

test('consensus across sightings beats one unlucky window', () => {
  const t = `
Jaren L Davis 801 560 6776 jarendavis@avenu.com
---
Jaren L Davis 801 560 6776 jarendavis@avenu.com
---
stray 801 560 9999
`
  assert.equal(phoneForAddress(t, 'jarendavis@avenu.com'), '8015606776')
})

test('says nothing rather than guessing when the address is absent', () => {
  assert.equal(phoneForAddress('C: 385-436-6519', 'nobody@example.com'), null)
  assert.equal(phoneForAddress('', 'a@b.com'), null)
})

test('a year or a version is not a phone', () => {
  assert.equal(phoneForAddress('Rev 1.2.2026 contract 2026 someone@example.com', 'someone@example.com'), null)
})

test('formatPhone matches the shape the directory stores', () => {
  assert.equal(formatPhone('3854366519'), '385-436-6519')
  assert.equal(formatPhone('weird'), 'weird')
})

// ── per-message attribution ──────────────────────────────────────────────────
// ⚠ These encode the live failure: the first version read a whole thread and
// handed Eric's own cell to four counterparties.

test('splitMessages finds each sender', () => {
  const t = `## Subject
Mailbox: tuaone@berwilson.com · 2 message(s)

### 2026-10-08 14:32 — Ericson H. Tua'one <tuaone@berwilson.com>
To: Merlin Corbin <merlinole@gmail.com>

Here is the draft.
C: 385-436-6519

### 2026-10-09 09:01 — Merlin Corbin <merlinole@gmail.com>
To: tuaone@berwilson.com

Thanks.
Merlin Corbin  801 555 7788
merlinole@gmail.com
`
  const msgs = splitMessages(t)
  assert.equal(msgs.length, 2)
  assert.equal(msgs[0].from, 'tuaone@berwilson.com')
  assert.equal(msgs[1].from, 'merlinole@gmail.com')
})

test("⚠ a sender's signature is never attributed to the recipient", () => {
  const t = `### 2026-10-08 14:32 — Ericson H. Tua'one <tuaone@berwilson.com>
To: Merlin Corbin <merlinole@gmail.com>

Here is the draft.
Ericson H. Tua'one
C: 385-436-6519
tuaone@berwilson.com
`
  const found = phonesBySender(t)
  // Eric's number is Eric's. Merlin learns nothing from a message he received.
  assert.equal(found.get('tuaone@berwilson.com'), '3854366519')
  assert.equal(found.has('merlinole@gmail.com'), false)
})

test('each party keeps its own number across a real exchange', () => {
  const t = `### 2026-10-08 14:32 — Ericson H. Tua'one <tuaone@berwilson.com>
To: Merlin Corbin <merlinole@gmail.com>

Ericson H. Tua'one
C: 385-436-6519
tuaone@berwilson.com

### 2026-10-09 09:01 — Merlin Corbin <merlinole@gmail.com>
To: tuaone@berwilson.com

Merlin Corbin
801 555 7788
merlinole@gmail.com
`
  const found = phonesBySender(t)
  assert.equal(found.get('tuaone@berwilson.com'), '3854366519')
  assert.equal(found.get('merlinole@gmail.com'), '8015557788')
})

test('a bare-address heading still attributes', () => {
  const t = `### 2026-10-09 09:01 — moose@berwilson.com
To: x@y.com

Richard
801 815 9150
moose@berwilson.com
`
  assert.equal(phonesBySender(t).get('moose@berwilson.com'), '8018159150')
})

test('a thread with no headings yields nothing rather than throwing', () => {
  assert.equal(phonesBySender('just some text 801 555 0100').size, 0)
})
