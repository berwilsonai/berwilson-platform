/**
 * Read the text out of a Messages `attributedBody` blob.
 *
 * ⚠ WITHOUT THIS, 98% OF THE CORPUS IS INVISIBLE. Measured on this box
 * 2026-10-11: of 305,107 messages, **5,243 carry `message.text` and 298,728
 * leave it NULL**, storing the text only in `attributedBody` — a serialized
 * NSAttributedString typedstream. A reader that selects `text` is not partly
 * right; it sees 1.7% of the history and would report that there is no business
 * traffic in it at all. Modern macOS stopped populating `text`.
 *
 * ⚠ AND `attributedBody` IS THE MORE COMPLETE FIELD, NOT A FALLBACK. Validated
 * against the 5,243 rows where BOTH exist: 255 of 300 sampled decode to the
 * exact `text` value and the other 45 decode to a SUPERSET of it — `text` had
 * been truncated (one marketing message lost its "Text END to OPT-OUT" tail).
 * Zero decoded wrongly. So where both are present, prefer this.
 *
 * The format, for whoever next has to touch it: somewhere after the `NSString`
 * class marker comes a `+` and then a length-prefixed UTF-8 run. The length is
 * one byte when it is under 0x80; `0x81` means the next two bytes are a
 * little-endian length, `0x82` the next four. Getting that wrong truncates long
 * messages while short ones look perfect, which is why the validation above
 * deliberately sampled messages over 130 characters.
 */

/** Marker the string run follows. */
const CLASS_MARKER = Buffer.from('NSString', 'utf8')

export function decodeAttributedBody(blob: Buffer | Uint8Array | null): string | null {
  if (!blob || blob.length === 0) return null
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)

  const marker = buf.indexOf(CLASS_MARKER)
  if (marker < 0) return null

  const plus = buf.indexOf(0x2b /* '+' */, marker)
  if (plus < 0) return null

  let k = plus + 1
  if (k >= buf.length) return null

  let n: number = buf[k]
  k += 1
  if (n === 0x81) {
    if (k + 2 > buf.length) return null
    n = buf.readUInt16LE(k)
    k += 2
  } else if (n === 0x82) {
    if (k + 4 > buf.length) return null
    n = buf.readUInt32LE(k)
    k += 4
  }

  // A declared length past the end of the blob means this is not the run we
  // think it is — return nothing rather than a slice of adjacent archive data.
  if (n <= 0 || k + n > buf.length) return null

  const text = buf.subarray(k, k + n).toString('utf8')
  return text.length > 0 ? text : null
}

/**
 * The text of a message row, preferring whichever field actually holds it.
 *
 * `attributedBody` wins when both are present, per the validation above.
 */
export function messageText(row: {
  text?: string | null
  attributedBody?: Buffer | Uint8Array | null
}): string | null {
  const decoded = decodeAttributedBody(row.attributedBody ?? null)
  if (decoded) return decoded
  const plain = row.text?.trim()
  return plain ? plain : null
}

/**
 * Apple epoch (2001-01-01) nanoseconds → JS Date.
 *
 * Older rows store SECONDS rather than nanoseconds, and the two differ by nine
 * orders of magnitude — read one as the other and a 2014 message lands in 1970
 * or far past the year 3000. Switching on magnitude is how both are handled.
 */
export function appleDate(raw: number | bigint | null): Date | null {
  if (raw === null) return null
  const n = typeof raw === 'bigint' ? Number(raw) : raw
  if (!Number.isFinite(n) || n === 0) return null
  const seconds = Math.abs(n) > 1e11 ? n / 1e9 : n
  return new Date((seconds + 978_307_200) * 1000)
}
