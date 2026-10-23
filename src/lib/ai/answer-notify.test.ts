/**
 * When an answer is worth sending, what the subject says, and what survives
 * the trip to a phone.
 *
 * The threshold is the whole behavioural contract Richard chose: notify when a
 * question ran long enough that you stopped watching, stay silent when you
 * were still looking at it. It was picked against measured latency on this box
 * (2026-10-21: median 73s, p90 455s, 22 of 68 answers over two minutes), not
 * guessed — so a change to it should have to break a test and read these
 * numbers on the way past.
 *
 * ⚠ The fast-answer path returns BEFORE touching the database or the network,
 * which is what makes it testable here at all. Keep it that way: the moment
 * the threshold check moves below the claim insert, this test starts needing
 * a live Postgres and stops being run.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TLDR_MAX_CHARS,
  clip,
  notifyAfterMs,
  notifyAnswer,
  plainText,
  subjectFor,
  tookPhrase,
} from './answer-notify'

const base = {
  messageId: '00000000-0000-0000-0000-000000000001',
  conversationId: '00000000-0000-0000-0000-000000000002',
  to: 'moose@berwilson.com',
  question: 'What is the Steelton closing date?',
  answer: 'The PSA says 17 October.',
  origin: 'https://richards-mac-studio.tail9acc02.ts.net',
  // A real uuid, because `ai_queries.user_id` is a NOT NULL uuid and the log
  // insert is fire-and-forget — a placeholder fails 22P02 in silence.
  userId: '00000000-0000-0000-0000-000000000003',
}

describe('notifyAfterMs', () => {
  it('defaults to 90s — above the 73s median, below the 455s p90', () => {
    assert.equal(notifyAfterMs(), 90_000)
  })
})

describe('notifyAnswer threshold', () => {
  it('sends nothing for an answer the asker watched arrive', async () => {
    const r = await notifyAnswer({ ...base, latencyMs: 20_000 })
    assert.equal(r.emailed, false)
    assert.equal(r.texted, false)
    assert.match(r.reason, /fast enough/)
    // The reason must carry the measurement, not just a verdict — a log line
    // saying "skipped" tells a reader nothing about why.
    assert.match(r.reason, /20s/)
  })

  it('is exclusive at the boundary, so the threshold means what it says', async () => {
    const r = await notifyAnswer({ ...base, latencyMs: notifyAfterMs() - 1 })
    assert.equal(r.emailed, false, 'one millisecond under the threshold must not email')
    assert.equal(r.texted, false, 'one millisecond under the threshold must not text')
  })

  it('refuses without an address rather than guessing one', async () => {
    const r = await notifyAnswer({ ...base, to: '', latencyMs: 600_000 })
    assert.equal(r.emailed, false)
    assert.equal(r.texted, false)
    assert.match(r.reason, /no address/)
  })
})

describe('subjectFor', () => {
  it('names the question, so two answers are told apart in a mailbox', () => {
    assert.equal(subjectFor('What is the Steelton closing date?'),
      'Ber AI: What is the Steelton closing date?')
  })

  it('collapses the newlines a pasted question carries', () => {
    assert.equal(subjectFor('What is\n\n  the date?'), 'Ber AI: What is the date?')
  })

  it('truncates a long question without leaving a dangling space', () => {
    const subject = subjectFor('x'.repeat(50) + ' ' + 'y'.repeat(50))
    assert.ok(subject.length < 90, `subject was ${subject.length} chars`)
    assert.ok(subject.endsWith('…'))
    assert.doesNotMatch(subject, / …$/, 'trailing space before the ellipsis')
  })
})

/**
 * ⚠ THE PART THAT GOES TO A PHONE, WHICH IS THE PART WITH NO UNDO.
 *
 * Measured 2026-10-23: the median assistant message is 3,046 characters, the
 * longest 17,145, and the longest body `pepper_outbound_texts` records as
 * actually delivered is 357. Everything below exists because the gap between
 * those two numbers is where a text gets truncated by a carrier rather than
 * by us — and a figure cut in half reads as complete.
 */
describe('plainText', () => {
  it('takes the markdown off, because a carrier renders none of it', () => {
    const md = '## Steelton\n\nThe PSA closes **17 October** for `$13M`.\n\n- one\n- two\n'
    const out = plainText(md)
    assert.equal(out, 'Steelton\nThe PSA closes 17 October for $13M.\n• one\n• two')
  })

  it('keeps a link’s words and drops its url, which is noise on a lock screen', () => {
    assert.equal(plainText('See [the PSA](https://example.com/a/b/c) for terms.'),
      'See the PSA for terms.')
  })

  it('drops a fenced block whole rather than unwrapping it', () => {
    const out = plainText('Here:\n\n```sql\nselect 1;\n```\n\nThat is all.')
    assert.doesNotMatch(out, /select/)
    assert.match(out, /That is all\./)
  })

  it('drops table rows, which arrive as a wall of pipes', () => {
    const out = plainText('Totals:\n\n| Deal | MW |\n| --- | --- |\n| Delta | 200 |\n\nDone.')
    assert.doesNotMatch(out, /\|/)
    assert.match(out, /Totals:/)
    assert.match(out, /Done\./)
  })
})

describe('clip', () => {
  it('leaves a short line exactly as it is', () => {
    assert.equal(clip('The PSA closes 17 October.', 240), 'The PSA closes 17 October.')
  })

  it('prefers a sentence boundary, so the text ends on a finished thought', () => {
    // ⚠ MEASURED AT THE REAL BUDGET. The first version of this test used 60
    // characters and asserted a cut 25 characters in — which the rule rightly
    // refuses, because ending there would throw away three-fifths of a message
    // that had room for it. A boundary is only better than a word break when
    // it keeps most of the window, and a toy budget cannot show that.
    const text =
      'Ber Wilson nets roughly $26.25M a year on the internals commission. ' +
      'The Steelton PSA closed on 17 October and both milestones are still open. ' +
      'Nothing in the correspondence settles whether the extension was agreed. ' +
      'That is the open question for Cleveland-Cliffs.'
    const out = clip(text, TLDR_MAX_CHARS)
    assert.ok(out.length <= TLDR_MAX_CHARS, `clipped to ${out.length}`)
    assert.ok(out.endsWith('.'), `ended on "${out.slice(-20)}"`)
    assert.ok(!out.endsWith('…'), 'a clean sentence end needs no ellipsis')
    // It kept the sentences that fit rather than stopping at the first one.
    assert.match(out, /17 October/)
  })

  it('falls back to a word break when the only sentence end is far too early', () => {
    // The other side of the same rule, which the 60-character version was
    // actually testing without saying so.
    const out = clip('Yes. ' + 'detail '.repeat(100), 120)
    assert.ok(out.length <= 120)
    assert.ok(out.endsWith('…'), 'a mid-thought cut has to say it is one')
    assert.ok(out.length > 100, `stopped at ${out.length} with 120 available`)
  })

  it('never cuts mid-word, because a half figure reads as a whole one', () => {
    // §12: a money figure must carry its shape. "$13" out of "$13.4M" is the
    // failure this exists to prevent.
    const text = 'Ber Wilson nets ' + '$13,400,000 on the Steelton transaction '.repeat(20)
    const out = clip(text, 40)
    assert.ok(out.length <= 40, `clipped to ${out.length}`)
    assert.ok(out.endsWith('…'))
    assert.doesNotMatch(out, /\d…$/, 'cut in the middle of a number')
  })

  it('collapses the newlines markdown leaves behind', () => {
    assert.equal(clip('a\n\nb', 240), 'a b')
  })
})

describe('tookPhrase', () => {
  it('reads in seconds under two minutes and in minutes above', () => {
    assert.equal(tookPhrase(95_000), '95 seconds')
    assert.equal(tookPhrase(240_000), '4 minutes')
  })
})

describe('the text budget', () => {
  it('leaves room for the link inside what this channel has actually delivered', () => {
    // The longest body ever sent from this box is 357 characters (record_alert,
    // 2026-10-19). The TLDR plus two newlines plus a tailnet conversation link
    // (~95 chars: https://richards-mac-studio.tail9acc02.ts.net/intel?conversation=<uuid>)
    // must stay under it, or the first real answer is the one that finds out.
    const linkLen = 'https://richards-mac-studio.tail9acc02.ts.net/intel?conversation='.length + 36
    assert.ok(
      TLDR_MAX_CHARS + 2 + linkLen <= 357,
      `budget is ${TLDR_MAX_CHARS + 2 + linkLen}, above the 357 this channel has proven`
    )
  })
})
