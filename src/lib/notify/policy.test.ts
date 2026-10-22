/**
 * The outbound policy — what may leave, and what happens to a kind nobody
 * listed.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  OUTBOUND,
  heldKinds,
  heldSummary,
  isHeld,
  liveKinds,
  outboundAllowed,
  type OutboundKind,
} from './policy'

test('a kind nobody listed does not send', () => {
  // The whole reason `kind` is required and this table is default-deny: the
  // pass somebody writes next year is silent until it is listed, rather than
  // sending whatever it likes.
  for (const unknown of ['', 'morning_note', 'newsletter', 'PEPPER_NOTE']) {
    const v = outboundAllowed(unknown)
    assert.equal(v.allowed, false, `"${unknown}" must not be allowed`)
    assert.match(v.reason, /not a kind/)
  }
})

test('an absent kind does not send either', () => {
  // What a JavaScript caller outside TypeScript's reach hands it.
  const v = outboundAllowed(undefined)
  assert.equal(v.allowed, false)
  assert.match(v.reason, /held/)
})

test('every verdict carries a reason in words', () => {
  for (const kind of Object.keys(OUTBOUND) as OutboundKind[]) {
    const v = outboundAllowed(kind)
    assert.ok(v.reason.trim().length > 0, `${kind} has no reason`)
    assert.equal(v.allowed, !isHeld(kind), `${kind} disagrees with isHeld`)
  }
})

test('a held pass says why — the type makes it impossible not to', () => {
  for (const kind of heldKinds()) {
    const pass = OUTBOUND[kind]
    assert.equal(pass.live, false)
    assert.ok(
      'held' in pass && pass.held.trim().length > 10,
      `${kind} is held with no usable explanation`
    )
  }
})

test("Richard's 2026-10-21 decision is what the table says", () => {
  // The decision, asserted rather than described: of the things that send on a
  // SCHEDULE — the ones that arrive whether or not anybody asked — only the two
  // task reminders may be live. That is the whole of what he said, and it is
  // the property worth locking: a new scheduled sender has to be named here
  // deliberately, which is the conversation this test exists to force.
  const scheduledAndLive = liveKinds().filter((k) => OUTBOUND[k].trigger === 'scheduled')
  assert.deepEqual(scheduledAndLive.sort(), ['task_due_today', 'task_week'])

  // Every channel he held, named one by one. Flipping any of these back on
  // fails here, which is the point — the table is one word per row.
  for (const kind of [
    'pepper_note',
    'pepper_text',
    'pepper_answer',
    'meeting_prep',
    'daily_digest',
    'weekly_brief',
    'activity_broadcast',
    'lead_digest',
  ] as OutboundKind[]) {
    assert.equal(isHeld(kind), true, `${kind} should be held`)
  }

  // ⚠ A `human` OR `event` TRIGGER IS NOT ASSERTED EXHAUSTIVELY, ON PURPOSE.
  // "Hold off on the messaging" is about what arrives unasked; a reply to
  // something somebody pressed or sent is the §11 distinction the whole
  // platform already turns on (automatic vs. human confirm), and a new one of
  // those is ordinary work rather than a reversal of this decision. What they
  // may not be is scheduled, which the first assertion covers.
  for (const kind of liveKinds()) {
    if (OUTBOUND[kind].trigger === 'scheduled') continue
    assert.ok(
      OUTBOUND[kind].what.trim().length > 0,
      `${kind} is live with no description of what it sends`
    )
  }
})

test('ad_hoc is held, so a send that does not name itself is silent', () => {
  // It used to be the DEFAULT for a text with no kind. A message nobody can
  // attribute is one nobody can turn off.
  assert.equal(isHeld('ad_hoc'), true)
})

test('the summary names the held channels rather than counting them', () => {
  const s = heldSummary()
  assert.match(s, /morning note/)
  // §12: a number that can only grow tells the reader they are behind and
  // nothing else. No bare "8 channels held".
  assert.doesNotMatch(s, /^\d+ channels?/)
})

/**
 * ⚠ THE RATCHET THAT MAKES THE TABLE THE REAL CHOKE POINT.
 *
 * `notify()` requires a `kind`, so `tsc` already catches a caller that omits
 * one — but it cannot catch a caller that passes a kind while routing AROUND
 * notify(), which is how every other seam in this repo has leaked (§12: a
 * one-table CRUD route is where the check goes missing). So: nothing outside
 * the notify layer may call a transport directly.
 */
test('nothing outside the notify layer calls a transport directly', () => {
  const root = join(process.cwd(), 'src')
  const offenders: string[] = []

  const allowed = new Set([
    // The layer itself, and the two modules it is made of.
    'lib/notify/index.ts',
    'lib/notify/chat.ts',
    'lib/notify/text.ts',
    'lib/notify/text-delivery.ts',
    // The Gmail client sendMail lives in, plus the lead-reply drafting path,
    // which creates DRAFTS and sends nothing.
    'lib/integrations/google-workspace.ts',
  ])

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
      if (entry.name.endsWith('.test.ts')) continue
      const rel = full.slice(root.length + 1)
      if (allowed.has(rel)) continue

      // ⚠ COMMENTS STRIPPED FIRST. §12: a test that scans the source tree and
      // does not strip comments measures its own documentation — the only two
      // hits for `focus:` in this repo are docblocks explaining why it is
      // banned.
      const src = readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      if (/\bsendMail\s*\(/.test(src) || /\bsendChat\s*\(/.test(src) || /\bsendText\s*\(/.test(src)) {
        offenders.push(rel)
      }
    }
  }
  walk(root)

  assert.deepEqual(
    offenders,
    [],
    `these call a transport without passing through notify() and its policy: ${offenders.join(', ')}`
  )
})

/**
 * ⚠ THE TEXT LEDGER'S KINDS LIVE IN TWO PLACES AND BOTH MUST AGREE.
 *
 * `pepper_outbound_texts.kind` is a CHECK in the schema; `OutboundTextRow['kind']`
 * in src/lib/provenance/db.ts is a TypeScript union mirroring it, and its own
 * comment says it "MUST MOVE WITH IT". A value in the union but not the
 * constraint fails the whole INSERT (§12 — a value outside an enum fails the
 * QUERY, not the row), and because that insert is the self-loop guard row,
 * `sendText` then refuses to send at all. So the symptom of forgetting the
 * migration is a channel that is silently off — the exact failure this file
 * exists to prevent, arriving by the back door.
 *
 * ⚠ THIS IS NOT THE SAME NAMESPACE AS `OUTBOUND` ABOVE, and writing it as
 * though it were is how the first version of this test failed: a POLICY kind is
 * one pass, and `pepper_text` sends two LEDGER kinds, `morning` and
 * `week_ahead`. Two vocabularies on purpose. The pair that can drift is the
 * union and the CHECK.
 *
 * Read from source and the migrations rather than a live database, so it runs
 * in `npm test`. The LAST migration to define the constraint is the one in
 * force, exactly as Postgres sees it.
 */
test('every text kind in the TypeScript union is in the schema CHECK', () => {
  const unionSrc = readFileSync(join(process.cwd(), 'src', 'lib', 'provenance', 'db.ts'), 'utf8')
  const unionBlock = unionSrc.slice(unionSrc.indexOf('interface OutboundTextRow'))
  const kindDecl = unionBlock.slice(unionBlock.indexOf('kind:'))
  // Up to the next field or the closing brace — the union is the run of
  // quoted members immediately after `kind:`.
  const members = Array.from(
    kindDecl.slice(0, kindDecl.search(/\n\s*(\w+[?]?:|})/)).matchAll(/'([a-z_]+)'/g),
    (m) => m[1]
  )
  assert.ok(members.length >= 5, `read only ${members.length} union members — the parse is wrong`)

  const dir = join(process.cwd(), 'supabase', 'migrations')
  const defining = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => /pepper_outbound_texts_kind_check/.test(readFileSync(join(dir, f), 'utf8')))
  assert.ok(defining.length > 0, 'no migration defines the text-kind constraint')

  const sql = readFileSync(join(dir, defining[defining.length - 1]), 'utf8')
  const block = sql.slice(sql.lastIndexOf('pepper_outbound_texts_kind_check'))
  const allowed = new Set(Array.from(block.matchAll(/'([a-z_]+)'/g), (m) => m[1]))

  for (const kind of members) {
    assert.ok(
      allowed.has(kind),
      `'${kind}' is in OutboundTextRow['kind'] but not in the schema CHECK — add a migration, or its first send writes no guard row and silently refuses`
    )
  }
})
