/**
 * What a signature block says about the person who signed it.
 *
 * ⚠ THE SWEEP'S `people[]` HAS NO PHONE, AND THE PHONE IS THE GAP. Measured
 * 2026-10-15 against the live rolodex: `parties.phone` is blank on 82 of 97
 * contacts — the emptiest column in the whole writable registry — while 718 of
 * 1,638 readable deal threads (44%) contain a phone-shaped number. The model's
 * thread summary extracts name, title, company and email for each participant
 * and no number, so this is the one contact field that cannot be a read of
 * `summary` and has to come from the message text.
 *
 * ⚠ AND A NUMBER IN A THREAD IS NOT A NUMBER FOR A PERSON. The whole risk here
 * is attribution: a thread carries several signatures, and "nearest phone to
 * the bottom" would hand one person another's cell. The rule below is that a
 * number counts for an address only if that address is the CLOSEST address to
 * it — so in a two-signature footer each number stays with its own owner, and
 * a number sitting alone in prose ("call me on 801 555 0100") is attributed to
 * nobody, because nobody's address is near it.
 *
 * A consensus across sightings then decides, which is what makes a single
 * unlucky window harmless: the number that appears beside this address most
 * often wins, exactly as `applyPeople` takes the newest non-empty value per
 * FIELD rather than the newest sighting whole.
 */
import { normalizePhone } from '@/lib/imessage/classify'

/** One rendered message heading: `### 2026-10-08 14:32 — Name <addr>`. */
const HEADING_RE = /^### .*? — (.+)$/gm

/**
 * A phone-shaped run of digits.
 *
 * Deliberately NOT anchored on a label (`C:`, `Mobile`), because the live
 * corpus writes it every way: `C: 385-436-6519`, `727 614 8844`,
 * `801.597.5700`, `(801) 637-8970`. The area code may not start with 0 or 1,
 * which is what keeps it off years and version strings.
 */
const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})(?!\d)/g

/** Any email address, for the "is this address the nearest one" test. */
const ADDRESS_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g

/**
 * How far from an address a number may sit and still be its number.
 *
 * A signature block is a few hundred characters; beyond that the pairing is a
 * coincidence. Measured on the samples: name/title/company/phone/email all
 * land inside ~200 chars, so this has slack without reaching the next block.
 */
const WINDOW = 400

/**
 * Numbers that are real but belong to a switchboard rather than a person.
 *
 * Kept as a last resort rather than discarded: a counterparty whose only
 * number is a main line is still reachable, and the alternative is a blank.
 */
function isTollFree(digits: string): boolean {
  return /^(800|833|844|855|866|877|888)/.test(digits)
}

/**
 * Every digit run long enough to be an id rather than a number.
 *
 * Tracking links in marketing footers (`?u=1a57a715520513505ca5cda89`) and
 * long numeric ids would otherwise yield a phone from the middle of them.
 */
function idSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  for (const m of text.matchAll(/\d{11,}/g)) {
    spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
  }
  // A URL is never a signature's phone line.
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
  }
  return spans
}

/**
 * One rendered thread, split into the messages it is made of.
 *
 * ⚠ THIS SPLIT IS WHAT MAKES ATTRIBUTION WORK, AND A DRY RUN AGAINST THE LIVE
 * CORPUS IS WHAT PROVED IT NECESSARY. Searching a whole thread for a target's
 * address finds it in the `To:` line of messages somebody ELSE sent — and a
 * signature's phone at the foot of one message sits closer to the next
 * message's `To:` line than to its own sender's address. So the first version
 * offered Eric's own cell (385-436-6519) as the phone number for Merlin
 * Corbin, Ocean Patel, Amy Clark and Courtney, and spread one 410-991-1469
 * across three unrelated people. A signature belongs to whoever SENT the
 * message it is in; nothing else is evidence.
 */
export function splitMessages(markdown: string): { from: string; text: string }[] {
  const out: { from: string; text: string }[] = []
  const heads = [...markdown.matchAll(HEADING_RE)]
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].index ?? 0
    const end = i + 1 < heads.length ? (heads[i + 1].index ?? markdown.length) : markdown.length
    const m = heads[i][1].match(/<([^>]+)>\s*$/)
    const from = (m ? m[1] : heads[i][1]).trim().toLowerCase().replace(/^mailto:/, '')
    out.push({ from, text: markdown.slice(start, end) })
  }
  return out
}

/**
 * Every phone this thread attributes to the person who SENT the message it is
 * in, as `address -> number`.
 *
 * Only a sender's own signature speaks for them, so a recipient named in a
 * `To:` line learns nothing here. An empty map means "nothing said", never
 * "no phone exists" — the caller fills a blank and must never read this as a
 * reason to clear one.
 */
export function phonesBySender(markdown: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const msg of splitMessages(markdown)) {
    if (!msg.from.includes('@')) continue
    const phone = phoneForAddress(msg.text, msg.from)
    if (phone) out.set(msg.from, phone)
  }
  return out
}

/**
 * The phone `text` attributes to `email`, or null.
 *
 * ⚠ Call this with ONE message and its own sender (see `phonesBySender`).
 * Handing it a whole thread and an arbitrary address is the bug described
 * above.
 */
export function phoneForAddress(text: string, email: string): string | null {
  const target = email.trim().toLowerCase()
  if (!target || !text) return null

  const addresses = [...text.matchAll(ADDRESS_RE)].map((m) => ({
    at: m.index ?? 0,
    email: m[0].toLowerCase(),
  }))
  if (addresses.length === 0) return null

  const skip = idSpans(text)
  const inSkip = (at: number) => skip.some(([a, b]) => at >= a && at < b)

  const votes = new Map<string, number>()

  for (const m of text.matchAll(PHONE_RE)) {
    const at = m.index ?? 0
    if (inSkip(at)) continue
    const digits = normalizePhone(m[0])
    if (!digits) continue

    // ⚠ THE ATTRIBUTION RULE. Of every address in the text, which is nearest
    // this number? Only that one may claim it. A tie goes to nobody.
    let best: { email: string; d: number } | null = null
    let tied = false
    for (const a of addresses) {
      const d = Math.abs(a.at - at)
      if (!best || d < best.d) {
        best = { email: a.email, d }
        tied = false
      } else if (d === best.d && a.email !== best.email) {
        tied = true
      }
    }
    if (!best || tied || best.d > WINDOW || best.email !== target) continue

    votes.set(digits, (votes.get(digits) ?? 0) + 1)
  }

  if (votes.size === 0) return null

  // Most sightings wins; a direct number beats a switchboard on a tie.
  const ranked = [...votes].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    const at = isTollFree(a[0]) ? 1 : 0
    const bt = isTollFree(b[0]) ? 1 : 0
    return at - bt
  })
  return ranked[0][0]
}

/** `8015550100` → `801-555-0100`, the shape the directory already stores. */
export function formatPhone(digits: string): string {
  return /^\d{10}$/.test(digits)
    ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits
}
