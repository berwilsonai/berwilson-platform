import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeAttributedBody, messageText, appleDate } from './decode'

/**
 * The length encoding is the subtle part and it is load-bearing for 98% of the
 * corpus. Getting it wrong truncates long messages while short ones look
 * perfect — which is exactly the shape of bug that ships.
 */

/** Build a minimal typedstream-shaped blob around a string. */
function blobFor(text: string): Buffer {
  const body = Buffer.from(text, 'utf8')
  let len: Buffer
  if (body.length < 0x80) {
    len = Buffer.from([body.length])
  } else if (body.length <= 0xffff) {
    len = Buffer.alloc(3)
    len[0] = 0x81
    len.writeUInt16LE(body.length, 1)
  } else {
    len = Buffer.alloc(5)
    len[0] = 0x82
    len.writeUInt32LE(body.length, 1)
  }
  return Buffer.concat([
    Buffer.from('streamtyped\x81\xe8\x03\x84\x01\x40\x84\x84\x84', 'binary'),
    Buffer.from('NSString', 'utf8'),
    Buffer.from([0x01, 0x94, 0x84, 0x01]),
    Buffer.from('+', 'utf8'),
    len,
    body,
    Buffer.from([0x86, 0x84]),
  ])
}

test('a short message round-trips', () => {
  assert.equal(decodeAttributedBody(blobFor('on my way')), 'on my way')
})

test('a message over 127 bytes uses the 2-byte length and is NOT truncated', () => {
  // The exact case that broke the first implementation: short messages decoded
  // perfectly while anything past 0x7F lost its tail.
  const long = 'The closing moved to 1 November and the title commitment is still outstanding. '.repeat(3)
  assert.ok(long.length > 127)
  assert.equal(decodeAttributedBody(blobFor(long)), long)
})

test('a message over 65535 bytes uses the 4-byte length', () => {
  const huge = 'x'.repeat(70_000)
  assert.equal(decodeAttributedBody(blobFor(huge)), huge)
})

test('multi-byte characters survive — length is BYTES, not characters', () => {
  // An emoji is 4 bytes and one or two JS characters; conflating the two cuts
  // the string mid-codepoint.
  const text = 'signed ✅ — see you at the site 🏗️ mañana'
  assert.equal(decodeAttributedBody(blobFor(text)), text)
})

test('a blob with no NSString marker yields null, not garbage', () => {
  assert.equal(decodeAttributedBody(Buffer.from('nothing useful here')), null)
})

test('a declared length past the end of the blob yields null', () => {
  // Rather than returning a slice of adjacent archive data as if it were text.
  const bad = Buffer.concat([
    Buffer.from('NSString', 'utf8'),
    Buffer.from('+', 'utf8'),
    Buffer.from([0x7f]), // claims 127 bytes
    Buffer.from('short', 'utf8'),
  ])
  assert.equal(decodeAttributedBody(bad), null)
})

test('empty and null input yield null', () => {
  assert.equal(decodeAttributedBody(null), null)
  assert.equal(decodeAttributedBody(Buffer.alloc(0)), null)
})

test('attributedBody wins over text, because it is the untruncated field', () => {
  // Validated against 300 ground-truth rows: 255 identical, 45 where
  // attributedBody held MORE than `text`, 0 wrong.
  const full = 'Qualify for new coverage. Text END to OPT-OUT'
  assert.equal(
    messageText({ text: 'Qualify for new coverage.', attributedBody: blobFor(full) }),
    full
  )
})

test('text is used when attributedBody is absent', () => {
  assert.equal(messageText({ text: 'older row', attributedBody: null }), 'older row')
})

test('a row with neither yields null rather than an empty string', () => {
  assert.equal(messageText({ text: '   ', attributedBody: null }), null)
})

test('apple dates read both nanoseconds and seconds', () => {
  // 2026-10-11T00:00:00Z = 1791676800 unix = 813369600 Apple-epoch seconds.
  // Older rows store seconds, modern ones nanoseconds, and the two differ by
  // nine orders of magnitude — reading one as the other lands a 2014 message in
  // 1970 or past the year 3000.
  const seconds = 813_369_600
  const fromSeconds = appleDate(seconds)
  const fromNanos = appleDate(BigInt(seconds) * BigInt(1_000_000_000))
  assert.ok(fromSeconds && fromNanos)
  assert.equal(fromSeconds.toISOString(), fromNanos.toISOString())
  assert.equal(fromSeconds.toISOString().slice(0, 10), '2026-10-11')
})

test('a zero or null date is null, not 2001', () => {
  assert.equal(appleDate(0), null)
  assert.equal(appleDate(null), null)
})
