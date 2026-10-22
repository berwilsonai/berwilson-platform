/**
 * When an answer is worth an email, and what the subject says.
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
import { emailAnswer, notifyAfterMs, subjectFor } from './answer-email'

const base = {
  messageId: '00000000-0000-0000-0000-000000000001',
  conversationId: '00000000-0000-0000-0000-000000000002',
  to: 'moose@berwilson.com',
  question: 'What is the Steelton closing date?',
  answer: 'The PSA says 17 October.',
  origin: 'https://richards-mac-studio.tail9acc02.ts.net',
}

describe('notifyAfterMs', () => {
  it('defaults to 90s — above the 73s median, below the 455s p90', () => {
    assert.equal(notifyAfterMs(), 90_000)
  })
})

describe('emailAnswer threshold', () => {
  it('sends nothing for an answer the asker watched arrive', async () => {
    const r = await emailAnswer({ ...base, latencyMs: 20_000 })
    assert.equal(r.sent, false)
    assert.match(r.reason, /fast enough/)
    // The reason must carry the measurement, not just a verdict — a log line
    // saying "skipped" tells a reader nothing about why.
    assert.match(r.reason, /20s/)
  })

  it('is exclusive at the boundary, so the threshold means what it says', async () => {
    const r = await emailAnswer({ ...base, latencyMs: notifyAfterMs() - 1 })
    assert.equal(r.sent, false, 'one millisecond under the threshold must not send')
  })

  it('refuses without an address rather than guessing one', async () => {
    const r = await emailAnswer({ ...base, to: '', latencyMs: 600_000 })
    assert.equal(r.sent, false)
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
