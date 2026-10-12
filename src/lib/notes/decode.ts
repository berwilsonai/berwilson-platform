/**
 * Decode an Apple Notes body.
 *
 * A note's text is not stored as text. `ZICNOTEDATA.ZDATA` holds a gzip stream
 * whose payload is protobuf, and the readable note lives in one length-delimited
 * field inside it. The rest of the message carries the attribute runs — fonts,
 * checklists, table ids, attachment pointers — which is why scraping the blob
 * for printable bytes produces text sprinkled with stray markers and loses
 * paragraph breaks.
 *
 * ⚠ SO THIS WALKS THE PROTOBUF RATHER THAN SCRAPING IT, AND THE DIFFERENCE IS
 * MEASURABLE: `scripts/verify-notes-decode.mts` asserts that the decoded body
 * STARTS WITH the note's own title, which is true of Apple Notes by
 * construction (the first line IS the title) and is therefore a check the
 * decoder cannot fake. A scraping decoder passes that test on short notes and
 * fails it on any note with a checklist or a table.
 *
 * There is no protobuf dependency and there should not be one: the schema used
 * here is three nested fields deep and a generic library would be a package to
 * maintain for one varint reader. §11 forbids adding orchestration frameworks
 * for the same reason — the cost of a dependency is not its size.
 */

import { gunzipSync } from 'node:zlib'

/** Wire types we care about. 2 is length-delimited (strings and sub-messages). */
const WIRE_LENGTH = 2

interface Field {
  number: number
  wire: number
  bytes?: Buffer
}

/**
 * Read one protobuf message's top-level fields, skipping what we cannot use.
 *
 * Returns [] rather than throwing on malformed input: a note whose body cannot
 * be parsed must be reported as unreadable by the caller, not crash a sweep
 * over 348 of them.
 */
function fields(buf: Buffer): Field[] {
  const out: Field[] = []
  let i = 0
  while (i < buf.length) {
    const [tag, afterTag] = varint(buf, i)
    if (afterTag < 0) break
    i = afterTag
    // eslint-disable-next-line no-bitwise
    const number = tag >>> 3
    // eslint-disable-next-line no-bitwise
    const wire = tag & 7
    if (number === 0) break
    if (wire === WIRE_LENGTH) {
      const [len, afterLen] = varint(buf, i)
      if (afterLen < 0) break
      const size = Number(len)
      if (size < 0 || afterLen + size > buf.length) break
      out.push({ number, wire, bytes: buf.subarray(afterLen, afterLen + size) })
      i = afterLen + size
    } else if (wire === 0) {
      const [, after] = varint(buf, i)
      if (after < 0) break
      i = after
    } else if (wire === 5) {
      i += 4
    } else if (wire === 1) {
      i += 8
    } else {
      // Groups (3/4) are not emitted by Notes; anything else means we have lost
      // the frame, and guessing further would invent text.
      break
    }
  }
  return out
}

/**
 * A protobuf varint. Returns [value, nextIndex], or [0, -1] if truncated.
 *
 * ⚠ PLAIN NUMBERS, NOT BigInt — the tsconfig targets below ES2020, so a BigInt
 * literal does not compile. It costs nothing here: the only varints read are
 * field tags and byte lengths, both far inside 2^31 for a note body, and the
 * 32-bit ceiling below refuses anything larger rather than silently wrapping.
 */
function varint(buf: Buffer, start: number): [number, number] {
  let result = 0
  let shift = 0
  let i = start
  while (i < buf.length) {
    const byte = buf[i]
    result += (byte & 0x7f) * Math.pow(2, shift)
    i += 1
    if ((byte & 0x80) === 0) return [result, i]
    shift += 7
    if (shift > 31) return [0, -1]
  }
  return [0, -1]
}

function child(buf: Buffer, number: number): Buffer | null {
  for (const f of fields(buf)) {
    if (f.number === number && f.bytes) return f.bytes
  }
  return null
}

export interface DecodedNote {
  text: string
  /** How it was read, so a verification script can report coverage per path. */
  via: 'protobuf' | 'none'
}

/**
 * The note's plain text.
 *
 * The path is document(2) → note(3) → text(2), which is what Apple has emitted
 * for every note in this corpus. When it does not resolve, this returns no text
 * rather than falling back to scraping: a body we cannot parse is a note the
 * sweep must SKIP and say so. §12 — "no text" must say why, or it reads as a
 * transient miss, and a half-decoded note would be stored as though complete.
 */
export function decodeNoteBody(data: Buffer | Uint8Array | null): DecodedNote {
  if (!data || data.length === 0) return { text: '', via: 'none' }

  let raw: Buffer
  try {
    raw = gunzipSync(Buffer.from(data))
  } catch {
    // Not every row is gzipped — a very old note can be stored raw.
    raw = Buffer.from(data)
  }

  const document = child(raw, 2)
  const note = document ? child(document, 3) : null
  const text = note ? child(note, 2) : null
  if (text) {
    const decoded = stripInlineMarkers(text.toString('utf8'))
    if (decoded.trim()) return { text: decoded, via: 'protobuf' }
  }
  return { text: '', via: 'none' }
}

/**
 * Remove the placeholder characters Notes uses for non-text content.
 *
 * U+FFFC (object replacement) stands in for every attachment, table and
 * checklist item. Left in, a note reads as having content it does not have —
 * and worse, a note that is ONLY an attachment decodes to a string of them,
 * which would otherwise be stored as a thread with no words in it.
 */
function stripInlineMarkers(text: string): string {
  return text
    .replace(/\uFFFC/g, ' ')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The first line, which Apple Notes guarantees is the note's title. */
export function titleOf(text: string): string {
  return (text.split('\n').find((l) => l.trim()) ?? '').trim()
}
