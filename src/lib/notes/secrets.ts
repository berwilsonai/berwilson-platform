/**
 * Refuse a note that looks like it holds credentials.
 *
 * ⚠ THIS IS NOT HYPOTHETICAL. Measured on this box 2026-10-12, before any of
 * this shipped: the note titled `Ber Wilson Passcodes` holds, in plain text, a
 * bank passcode, the office front-door code, the Woodlands gate code, a GoDaddy
 * customer number and password, and the password to `info@berwilson.com` —
 * which is Pepper's OWN mailbox. `Api keys`, `PawPair credentials firebase`,
 * `Clawdia AWS`, `Gushroombot … use this token` and `N8n lead … client id` are
 * in the same corpus. 19 of 334 notes (5.7%) trip the patterns below.
 *
 * What ingesting one would cost: the body lands in `email_threads.raw_markdown`,
 * is summarized, chunked and EMBEDDED into `thread_chunks`, and is then
 * retrievable by Ber AI and reachable by every outbound channel — the morning
 * note, the digest, a Drive-published sheet. There is no un-embedding a secret
 * you have already answered a question with.
 *
 * ⚠ SO IT FAILS CLOSED AND IT IS NOT THE ONLY GUARD. The sweep reads only a
 * folder a human nominated, which is the real control; this is defence in depth
 * for the day somebody drops the wrong note into that folder. A note that trips
 * this is skipped WHOLE — not redacted, not stored with its title — because a
 * title like `Brighton bank 2484#` is itself the secret.
 *
 * False positives are deliberately cheap: a work note that happens to say
 * "password" is simply not read, and the sweep reports the count so the
 * refusals are visible rather than silent.
 */

/**
 * Words that mean "this note exists to hold a secret".
 *
 * Kept narrow and literal rather than clever. §12's lesson on noise filters
 * applies in reverse here: every clever version of a filter costs evidence, but
 * this filter's job is to be over-eager, and the cost of over-refusing is one
 * unread note.
 */
const CREDENTIAL_WORDS = [
  'passcode',
  'passcodes',
  'password',
  'passwords',
  '\\bpw\\b',
  '\\bpwd\\b',
  '\\bpin\\b',
  'routing number',
  'account\\s*#',
  'acct\\s*#',
  '\\bssn\\b',
  'social security',
  'seed phrase',
  'recovery phrase',
  'private key',
  'api[\\s_-]?key',
  'secret key',
  'access token',
  'client secret',
  '\\bcvv\\b',
  'security code',
  'gate code',
  'door code',
  'login\\s*[-:]',
  'credentials',
]

const CREDENTIAL = new RegExp(`(${CREDENTIAL_WORDS.join('|')})`, 'i')

/**
 * A long high-entropy run, which is what a key or a generated password looks
 * like even when no word nearby announces it.
 *
 * ⚠ CAUGHT `gosqYs-fyjzeg-dyfpi2` IN THE LIVE CORPUS — a generated passphrase
 * sitting in a note whose surrounding words the list above would also have
 * caught, but the point is that one of them is enough.
 *
 * ⚠ URLS ARE STRIPPED BEFORE THIS RUNS, AND THE MEASUREMENT IS WHY. On the
 * first pass over 332 real notes it refused `BW Task list Eric`, `Tasks` and
 * `Utah rugby alumni` — all genuine work notes, all carrying a Drive or
 * Calendar link whose id is forty characters of exactly this shape. A work
 * folder is FULL of links, so an entropy rule that reads a URL as a secret
 * refuses the very notes the feature exists for. §12: every clever filter
 * costs evidence, and the cost has to be measured against the corpus rather
 * than reasoned about.
 */
const HIGH_ENTROPY = /[A-Za-z0-9][A-Za-z0-9_\-+=]{19,}/g

/** A URL, including the bare `www.` form. Removed before the entropy test. */
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/gi

/**
 * Does this run actually look generated, rather than long?
 *
 * ⚠ MEASURED, AND THE FIRST TWO VERSIONS BOTH FAILED ON REAL NOTES. Including
 * `/` in the character class made `website/host/deliver/what` and
 * `projects/infographics` — ordinary words joined by slashes — read as secrets,
 * which refused `BW Task list Eric` and `Tasks`, two of the most work-relevant
 * notes in the corpus. A generated credential has BOTH letters and digits; a
 * phrase, a path and a hyphenated title have letters only.
 */
function looksGenerated(run: string): boolean {
  return /[A-Za-z]/.test(run) && /[0-9]/.test(run)
}

function hasGeneratedRun(text: string): boolean {
  for (const match of text.matchAll(HIGH_ENTROPY)) {
    if (looksGenerated(match[0])) return true
  }
  return false
}

export interface SecretVerdict {
  /** True when the note must not be stored at all. */
  refuse: boolean
  /** Which rule fired, for the run's report. Never the matched TEXT. */
  reason: string | null
}

/**
 * Judge a note.
 *
 * ⚠ THE REASON NEVER QUOTES THE MATCH. A log line saying `refused: matched
 * "PW- WilsonMoose@$1"` would copy the secret into a log file that is not
 * protected the way the note is. It names the RULE.
 */
export function judgeSecrets(title: string, body: string): SecretVerdict {
  const haystack = `${title}\n${body}`
  const word = CREDENTIAL.exec(haystack)
  if (word) {
    return { refuse: true, reason: `credential word: ${word[1].toLowerCase().slice(0, 24)}` }
  }
  // The entropy test runs on the text WITHOUT its links. A Drive file id is
  // not a secret; an API key sitting next to one is.
  // The entropy test runs on the text WITHOUT its links. A Drive file id is
  // not a secret; an API key sitting next to one is.
  if (hasGeneratedRun(haystack.replace(URL_LIKE, ' '))) {
    return { refuse: true, reason: 'long generated string (key or password)' }
  }
  return { refuse: false, reason: null }
}
