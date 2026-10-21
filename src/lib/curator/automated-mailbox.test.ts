/**
 * Which mailboxes are machines rather than people.
 *
 * ⚠ THE SUFFIX CASE IS THE WHOLE REASON THIS EXISTS. The original test was
 * anchored at `^`, so a marker anywhere else in the local part was invisible —
 * and `drive-shares-dm-noreply@google.com` became a contact named "Merlin
 * Corbin (via Google Drive)": a Google Drive share notification stored in the
 * directory as a person. Found 2026-10-21 by reading all 57 contacts the
 * reciprocity rule had created, which is the only way it could have been found,
 * because creating a contact nobody asked for raises no error.
 *
 * §12 governs the shape of the fix in both directions at once: a substring test
 * would match `norah` and `replyall`, and the anchor missed the real case. So
 * the test is on WHOLE TOKENS, and the cases below assert both halves — the
 * ones that must match and the near-misses that must not.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAutomatedLocalPart } from './contacts'

describe('isAutomatedLocalPart', () => {
  it('catches the classic prefix forms, as it always did', () => {
    for (const local of ['noreply', 'no-reply', 'donotreply', 'postmaster', 'mailer-daemon']) {
      assert.equal(isAutomatedLocalPart(local), true, local)
    }
  })

  it('⚠ catches a marker in the LAST position, which the anchor missed', () => {
    // The live failure, verbatim.
    assert.equal(isAutomatedLocalPart('drive-shares-dm-noreply'), true)
    assert.equal(isAutomatedLocalPart('calendar-notification'), true)
    assert.equal(isAutomatedLocalPart('billing.no-reply'), true)
  })

  it('catches a marker in the MIDDLE too', () => {
    assert.equal(isAutomatedLocalPart('google-noreply-alerts'), true)
    assert.equal(isAutomatedLocalPart('docs.do-not-reply.team'), true)
  })

  it('reads an underscore and a plus as separators, like a dot', () => {
    assert.equal(isAutomatedLocalPart('shares_dm_noreply'), true)
    assert.equal(isAutomatedLocalPart('alerts+noreply'), true)
  })

  it('⚠ does NOT match a real name that merely contains the letters', () => {
    // The precision the `^` anchor was protecting, kept. A substring test
    // would fail every one of these, and each would cost a real deal contact.
    for (const local of [
      'norah.reilly',        // contains "nore"
      'replyall',            // contains "reply"
      'bouncer',             // contains "bounce"
      'systematic',          // contains "system"
      'bradmclaughlin',
      'sterling',
      'jonathan',
    ]) {
      assert.equal(isAutomatedLocalPart(local), false, local)
    }
  })

  it('leaves the ambiguous words prefix-only, because a surname can end in them', () => {
    // `support`, `sales` and `service` are caught at the front (a role mailbox)
    // and deliberately NOT as a trailing token: a person could plausibly be
    // `j.service@`, and a missed role mailbox costs one contact while a
    // wrongly-skipped person costs a counterparty nobody can find.
    assert.equal(isAutomatedLocalPart('support'), true)
    assert.equal(isAutomatedLocalPart('support.team'), true)
    assert.equal(isAutomatedLocalPart('jonathan.service'), false)
  })

  it('an empty or whitespace local part is not automated, it is nothing', () => {
    assert.equal(isAutomatedLocalPart(''), false)
    assert.equal(isAutomatedLocalPart('   '), false)
  })
})
