/**
 * The staging bar — the gate that decides whether a cluster of correspondence
 * is put in front of a human at all.
 *
 * ⚠ THESE CASES ARE THE MEASUREMENT, NOT AN ILLUSTRATION. Each shape below was
 * counted in the staged corpus on 2026-10-20 (225 sessions, 251 decided, 4
 * confirmed), and the figures in `clusterStagingVerdict`'s docblock come from
 * the same query. §12 warns that a worked example whose figures coincide cannot
 * distinguish two readings of a rule — so the single-thread cases here pull the
 * two conditions apart deliberately: attachment-without-reply and
 * reply-without-attachment must BOTH fail, and each is asserted on its own.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clusterStagingVerdict } from './stage-phase'

type T = { message_count: number | null; attachment_count: number | null }
const thread = (messages: number, attachments = 0): T => ({
  message_count: messages,
  attachment_count: attachments,
})

describe('clusterStagingVerdict', () => {
  it('stages a cluster spanning more than one thread, whatever is in them', () => {
    // 49 of the 225 staged sessions, carrying 2 of the 4 confirmations. The
    // weakest of the three accepted shapes and still kept: a deal discussed
    // across two separate threads is a deal somebody is working.
    const v = clusterStagingVerdict([thread(1), thread(1)])
    assert.equal(v.stage, true)
    assert.match(v.reason, /2 threads/)
  })

  it('stages a single thread that has both a reply and an attachment', () => {
    const v = clusterStagingVerdict([thread(4, 2)])
    assert.equal(v.stage, true)
    assert.match(v.reason, /4 messages/)
    assert.match(v.reason, /2 attachments/)
  })

  it('HOLDS a lone unanswered message with nothing attached', () => {
    // The dominant shape in the dismissed pile: 111 clusters whose busiest
    // thread was one message produced exactly one confirmation between them.
    const v = clusterStagingVerdict([thread(1)])
    assert.equal(v.stage, false)
    assert.match(v.reason, /^held:/)
    assert.match(v.reason, /nothing attached/)
  })

  it('HOLDS an attachment nobody replied to — a notice, not a negotiation', () => {
    // Pulls the two conditions apart: this one satisfies "paper moved" and
    // fails "somebody here engaged". A bid invitation with the RFP attached is
    // exactly this, and it belongs on /leads rather than as a candidate project.
    const v = clusterStagingVerdict([thread(1, 3)])
    assert.equal(v.stage, false)
    assert.match(v.reason, /nobody replied/)
  })

  it('HOLDS a back-and-forth with no paper', () => {
    // The mirror case: "somebody engaged" without "paper moved". 103 clusters
    // had no attachment anywhere and produced ZERO confirmations.
    const v = clusterStagingVerdict([thread(6)])
    assert.equal(v.stage, false)
    assert.match(v.reason, /nothing attached/)
  })

  it('reads a null count as zero rather than throwing', () => {
    // `message_count` and `attachment_count` are nullable with a default of 0,
    // so a row written before the column existed reads as null. §12: a column
    // that still exists but holds nothing reads as an empty answer — here that
    // is the SAFE direction (held, not staged), which is why it is asserted
    // rather than assumed.
    const v = clusterStagingVerdict([{ message_count: null, attachment_count: null }])
    assert.equal(v.stage, false)
  })

  it('sums attachments across threads but takes the BUSIEST thread, not the sum', () => {
    // A reply is a property of ONE conversation. Summing message counts would
    // let three separate unanswered notices total 3 and read as a discussion —
    // but this shape stages anyway on thread_count, so the assertion that
    // matters is the reason it gives: the multi-thread rule, not a fake reply.
    const v = clusterStagingVerdict([thread(1, 1), thread(1, 1), thread(1, 1)])
    assert.equal(v.stage, true)
    assert.match(v.reason, /3 threads/)
  })

  it('never stages an empty cluster', () => {
    // Unreachable through the sweep — a cluster with no threads is dismissed
    // before the verdict runs — but a gate whose default is "yes" on no
    // evidence is the wrong default to leave lying around.
    assert.equal(clusterStagingVerdict([]).stage, false)
  })
})
