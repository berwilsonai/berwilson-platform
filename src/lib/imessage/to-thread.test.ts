import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chatToThreads, isIMessageThread, SESSION_GAP_MS, splitSessions } from './to-thread'
import type { ChatRow } from './read'
import type { ChatVerdict } from './classify'

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0)
const MIN = 60_000

/** read.ts returns newest-first, so tests build that way deliberately. */
function chat(offsetsMinutesAgo: number[], over: Partial<ChatRow> = {}): ChatRow {
  const messages = offsetsMinutesAgo.map((m, i) => ({
    text: `message ${i}`,
    at: new Date(NOW - m * MIN),
    fromMe: i % 2 === 0,
  }))
  return {
    chatId: 7,
    guid: 'iMessage;-;+18015550100',
    handles: ['+18015550100'],
    displayName: null,
    messages,
    sentByMe: messages.filter((m) => m.fromMe).length,
    total: messages.length,
    lastAt: messages[0]?.at ?? null,
    ...over,
  }
}

const BUSINESS: ChatVerdict = {
  business: true,
  score: 3,
  reason: 'test',
  signals: { knownParty: true, namedRecords: [], namedBy: [], dealTerms: [], bigMoney: false, automated: false },
  internal: false,
}

const DIR = { nameByPhone: new Map(), emailByPhone: new Map(), ownerName: 'Richard White' }

test('a burst of messages is one session', () => {
  // 48h ago, five minutes apart — long closed.
  const sessions = splitSessions(chat([2890, 2885, 2880]), NOW)
  assert.equal(sessions.length, 1)
  assert.equal(sessions[0].length, 3)
})

test('a gap longer than the threshold starts a new session', () => {
  const gapMinutes = SESSION_GAP_MS / MIN
  const sessions = splitSessions(chat([2880 + gapMinutes + 10, 2885, 2880]), NOW)
  assert.equal(sessions.length, 2)
})

test('sessions and their messages come back OLDEST first, whatever order they were read in', () => {
  // deltaFor counts rendered `### ` headings in order, so a session rendered
  // newest-first would post the conversation backwards onto the record.
  const sessions = splitSessions(chat([2890, 2880, 2885]), NOW)
  const times = sessions[0].map((m) => m.at.getTime())
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
})

test('⚠ a session still being written is NOT emitted', () => {
  // The cost of emitting it is re-summarizing the same conversation every run
  // at 30-60s of local model each, and LM Studio serves one request at a time —
  // so that queue is paid by whoever is waiting on Ber AI.
  const open = splitSessions(chat([10, 5, 1]), NOW)
  assert.deepEqual(open, [], 'last message is inside the gap')

  const closed = splitSessions(chat([2890, 2885, 2880]), NOW)
  assert.equal(closed.length, 1)
})

test('an open session does not suppress the closed ones behind it', () => {
  // one burst two days ago, one happening right now
  const sessions = splitSessions(chat([2880, 2875, 5, 1]), NOW)
  assert.equal(sessions.length, 1, 'the old burst is still written')
  assert.equal(sessions[0].length, 2)
})

test('⚠ a session fingerprint is stable as the session grows', () => {
  // storeFetchedThreads keys on fingerprint to decide insert-vs-refresh. If it
  // moved when a message arrived, every run would insert a duplicate row for
  // the same conversation.
  const first = chatToThreads(chat([2890, 2885]), BUSINESS, DIR, NOW)
  const grown = chatToThreads(chat([2890, 2885, 2882]), BUSINESS, DIR, NOW)
  assert.equal(first.length, 1)
  assert.equal(grown.length, 1)
  assert.equal(grown[0].fingerprint, first[0].fingerprint, 'same session, same identity')
  assert.equal(grown[0].messages.length, 3, 'and the message count grew, so it is seen as grown')
})

test('two different sessions of one chat get different fingerprints', () => {
  const gapMinutes = SESSION_GAP_MS / MIN
  const threads = chatToThreads(chat([2880 + gapMinutes + 10, 2885, 2880]), BUSINESS, DIR, NOW)
  assert.equal(threads.length, 2)
  assert.notEqual(threads[0].fingerprint, threads[1].fingerprint)
  assert.notEqual(threads[0].threadId, threads[1].threadId)
})

test('a conversation that is not business produces nothing', () => {
  const threads = chatToThreads(chat([2890, 2885]), { ...BUSINESS, business: false }, DIR, NOW)
  assert.deepEqual(threads, [])
})

test('⚠ the thread is marked by gmail_thread_id, which can never be a real Gmail id', () => {
  const [t] = chatToThreads(chat([2890, 2885]), BUSINESS, DIR, NOW)
  assert.equal(isIMessageThread(t.threadId), true)
  assert.equal(isIMessageThread('18f2c4a9b1d3e5f7'), false, 'a real Gmail thread id')
  assert.equal(isIMessageThread(null), false)
  assert.equal(isIMessageThread(undefined), false)
})

test('the mailbox is the owner’s real one, so attribution and chase can resolve it', () => {
  const [t] = chatToThreads(chat([2890, 2885]), BUSINESS, DIR, NOW)
  assert.match(t.mailbox, /@/, 'not a phone number')
  assert.ok(t.participants.includes(t.mailbox))
})

test('a handle with no directory entry still carries a domain, so clustering can group it', () => {
  // externalParticipants() drops any participant with no `@`, so a bare phone
  // number carries no grouping signal and two sessions with the same person on
  // the same deal would never share a participant.
  const [t] = chatToThreads(chat([2890, 2885]), BUSINESS, DIR, NOW)
  const synthetic = t.participants.filter((p) => p.endsWith('@imessage.local'))
  assert.equal(synthetic.length, 1)
  assert.equal(synthetic[0], '8015550100@imessage.local')
})

test('a known contact’s real email is used instead, which reaches the shared-contact bar', () => {
  const dir = {
    nameByPhone: new Map([['8015550100', 'Scott Hunsaker']]),
    emailByPhone: new Map([['8015550100', 'scott@highlandtitle.com']]),
    ownerName: 'Richard White',
  }
  const [t] = chatToThreads(chat([2890, 2885]), BUSINESS, dir, NOW)
  assert.ok(t.participants.includes('scott@highlandtitle.com'))
  assert.match(t.subject, /Scott Hunsaker/)
})

test('the subject names the counterparty and the day, never a bare phone number', () => {
  const [t] = chatToThreads(chat([2890, 2885]), BUSINESS, DIR, NOW)
  // A subject is read by a human AND matched on by bestMatch; a raw number
  // helps neither.
  assert.match(t.subject, /^Texts with …0100 — \d{4}-\d{2}-\d{2}$/)
})

test('firstAt and lastAt bound the session, not the whole chat', () => {
  const gapMinutes = SESSION_GAP_MS / MIN
  const threads = chatToThreads(chat([2880 + gapMinutes + 10, 2885, 2880]), BUSINESS, DIR, NOW)
  for (const t of threads) {
    assert.ok(new Date(t.firstAt) <= new Date(t.lastAt))
    for (const m of t.messages) {
      assert.ok(new Date(m.receivedAt) >= new Date(t.firstAt))
      assert.ok(new Date(m.receivedAt) <= new Date(t.lastAt))
    }
  }
})

test('an empty conversation produces no session rather than an empty one', () => {
  assert.deepEqual(splitSessions(chat([]), NOW), [])
  assert.deepEqual(chatToThreads(chat([]), BUSINESS, DIR, NOW), [])
})

test('⚠ the rendered session is splittable by deltaFor — the contract across three modules', async () => {
  // to-thread builds MailMessages so that renderThread emits `### <ts> — <who>`
  // headings, which is the only thing deltaFor can count. Hand-rolling the
  // markdown here instead would work until someone changed the renderer, and
  // then every update would silently re-post the whole conversation onto the
  // record. Nothing else asserts that these three agree.
  const { renderThread } = await import('@/lib/integrations/gmail-search')
  const { deltaFor } = await import('@/lib/email-sweep/apply-phase')

  const [t] = chatToThreads(chat([2890, 2888, 2886, 2884]), BUSINESS, DIR, NOW)
  const md = renderThread(t)

  assert.equal(deltaFor(md, 0, t.messages.length)?.newCount, 4, 'all four are new')

  const partial = deltaFor(md, 2, t.messages.length)
  assert.equal(partial?.newCount, 4)
  assert.equal(partial?.text.match(/^### /gm)?.length, 2, 'only the two unposted messages')
  assert.ok(!partial?.text.includes('message 0'), 'and not the ones already posted')

  assert.equal(deltaFor(md, 4, t.messages.length), null, 'nothing new is null, not empty text')
})
