/**
 * Mail text noise — what a corporate mail gateway adds, and what it costs.
 *
 * Two distinct harms, both measured on the live corpus before this existed:
 *
 * 1. **Rewritten links hide the document.** Proofpoint, Outlook ATP and Inky
 *    rewrite every URL in an inbound message into a 300-400 character wrapper
 *    carrying the original inside an encoded query parameter. `extractPortalLinks`
 *    pairs a link with the filename in the 300 characters BEFORE it — and a
 *    wrapped link is itself long enough to fill that window, so the filename is
 *    never found and the reference is discarded. Measured over 1,000 threads:
 *    74 carried proofpoint-wrapped links and **not one produced a portal
 *    reference**, against 49 from unwrapped mail. The mail most likely to carry
 *    a bid package is the mail from a company big enough to run a gateway.
 *
 * 2. **Opaque blobs win retrieval.** A signature image, a digital certificate or
 *    a gateway tracking token arrives as one unbroken run of hex or base64.
 *    Chunked and embedded it becomes a passage like any other, and it ranks:
 *    asking "what did the title company say about the parcels?" returned a
 *    2,000-character hex dump as the TOP hit on the Carbon County thread, ahead
 *    of the title commitment sitting in the same thread.
 *
 * Scrubbing at index time fixes new mail. `isLowSignalPassage` is the same
 * judgement applied at READ time, so the ~6,000 chunks already indexed stop
 * poisoning answers without waiting on a full re-embed.
 */

/** A whitespace-free run at least this long is a token, not a word. */
const OPAQUE_MIN_LENGTH = 64

/**
 * Decode a Proofpoint v2 `u=` parameter back to the URL it wraps.
 *
 * The encoding is percent-encoding with two substitutions so the result
 * survives as a query value: `-` stands for `%` and `_` for `/`.
 */
function decodeProofpointV2(encoded: string): string | null {
  try {
    const restored = encoded.replace(/-/g, '%').replace(/_/g, '/')
    const decoded = decodeURIComponent(restored)
    return /^https?:\/\//i.test(decoded) ? decoded : null
  } catch {
    // A malformed percent sequence throws. The wrapper is still noise, so the
    // caller drops it — returning null must not abort the whole scrub.
    return null
  }
}

/**
 * Replace gateway-rewritten links with the URL they wrap.
 *
 * Every branch either recovers a real URL or removes the wrapper: leaving it in
 * place is the one outcome with no value, since nothing downstream can read it
 * and it costs the filename window that makes a link a document reference.
 */
export function unwrapSafeLinks(text: string): string {
  if (!text) return text
  let out = text

  // Proofpoint v2: …/v2/url?u=<encoded>&d=…&c=…&r=…&m=…&s=…&e=
  out = out.replace(
    /https?:\/\/urldefense\.proofpoint\.com\/v2\/url\?u=([^&\s)<>"']+)[^\s)<>"']*/gi,
    (_m, u: string) => decodeProofpointV2(u) ?? ''
  )

  // Proofpoint v3: …/v3/__<real url>__;<base64 metadata>$
  out = out.replace(
    /https?:\/\/urldefense(?:\.proofpoint)?\.com\/v3\/__(.+?)__;[^\s)<>"']*/gi,
    (_m, u: string) => (/^https?:\/\//i.test(u) ? u : '')
  )

  // Outlook ATP Safe Links: …safelinks.protection.outlook.com/?url=<encoded>&…
  out = out.replace(
    /https?:\/\/[^\s)<>"']*safelinks\.protection\.outlook\.com\/\?url=([^&\s)<>"']+)[^\s)<>"']*/gi,
    (_m, u: string) => {
      try {
        const decoded = decodeURIComponent(u)
        return /^https?:\/\//i.test(decoded) ? decoded : ''
      } catch {
        return ''
      }
    }
  )

  // Inky rewrites into a link?domain=… form that does not carry the original
  // URL at all, only the domain. There is nothing to recover, so it goes.
  out = out.replace(/https?:\/\/[^\s)<>"']*\.inky\.com\/link[^\s)<>"']*/gi, '')

  return out
}

/**
 * Is this whitespace-free run an opaque token rather than a word or a URL?
 *
 * Deliberately narrow. A URL, a file path and a hostname all carry `.`, `/` or
 * `:`, so requiring their absence keeps every reference in the text and leaves
 * only the base64 / hex / JWT family — which is what actually ranks.
 */
function isOpaqueToken(token: string): boolean {
  if (token.length < OPAQUE_MIN_LENGTH) return false
  if (/[.:/@]/.test(token)) return false
  return /^[A-Za-z0-9+/=_-]+$/.test(token)
}

/**
 * Trim the punctuation a blob picks up from the text around it.
 *
 * These runs are usually the tail of a rewritten URL cut at a chunk boundary,
 * so they arrive wearing the markup that followed them — `…ffaaabbb>` from a
 * `<…>` link. Testing the raw token let a single trailing `>` save a
 * 300-character hex dump, which then led the top passage for a question about
 * the Carbon County title work.
 */
const TOKEN_EDGES = /^[<>("'\[]+|[<>)"'\].,;:!?]+$/g

/** Drop opaque tokens — certificate blobs, tracking ids, encoded attachments. */
export function stripOpaqueTokens(text: string): string {
  if (!text) return text
  return text.replace(/\S+/g, (token) => {
    const core = token.replace(TOKEN_EDGES, '')
    return isOpaqueToken(core) ? '' : token
  })
}

/**
 * The full index-time scrub: recover wrapped links, drop opaque blobs, and
 * collapse the whitespace both steps leave behind.
 *
 * Line structure is preserved — the thread markdown uses it to separate
 * messages, and the summarizer and the reader both rely on that.
 */
export function scrubMailText(text: string): string {
  if (!text) return text
  const cleaned = stripOpaqueTokens(unwrapSafeLinks(text))
  return cleaned
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Should this passage be withheld from the model as evidence?
 *
 * Applied at READ time to chunks indexed before the scrub existed, so the
 * ~6,000 already in the index stop poisoning answers without a full re-embed.
 *
 * Tuned three times against the live corpus. Every attempt to be clever cost
 * real evidence, and the record is worth keeping:
 *
 *   1. Share of characters belonging to PROSE, below 35% — withheld 11.6% of
 *      chunks, including "Site Visit - IDIQ @ HAFB, Evanston, UTTR", "Bid
 *      Invite: Chick-Fil-A #04616" and "View the RFP for Membrane Roofing".
 *      Mail is full of URLs and addresses, so a prose ratio reads a bid
 *      invitation and a certificate blob alike.
 *   2. Share of characters in SHORT tokens, below 50% — worse, 14.4%, and it
 *      took the bid invitations again: a BuildingConnected invite is mostly
 *      long per-trade links, which are content, not noise.
 *
 * What works is the crudest test available: DENSITY of ordinary words. Prose
 * carries roughly one word per six characters; an encoded run carries none,
 * because it is a single token thousands of characters long. Below one word
 * per forty characters is a blob and nothing else — 2.5% of the index, and
 * zero false positives across 256 bid and title passages.
 *
 * A "word" counts figures as well as letters, because the second tuning pass
 * withheld the life-insurance policy ledgers: real money, in a table, where
 * every cell is a number and not one is a word.
 *
 * Erring toward keeping things is the whole point — a withheld passage is
 * evidence the agent cannot cite, and the failure that produces ("I found
 * nothing") is the one this index exists to prevent.
 */
export function isLowSignalPassage(text: string): boolean {
  const trimmed = (text ?? '').trim()
  // Short passages are cheap to carry and hard to judge; let them through.
  if (trimmed.length < 200) return false

  let words = 0
  for (const token of trimmed.split(/\s+/)) {
    // Nothing this long is a word. Skipping it is what makes the measure work:
    // a blob is one such token, so it contributes nothing to the count.
    if (token.length > 40) continue
    const letters = token.replace(/[^A-Za-z]/g, '').length
    const digits = token.replace(/[^0-9]/g, '').length
    // A word, or a table cell: "Commitment", "9/18", "$4,339,831", "2026".
    if (letters >= 2 && letters * 2 >= token.length) words++
    else if (digits >= 2 && digits * 2 >= token.length) words++
  }

  return words < trimmed.length / 40
}
