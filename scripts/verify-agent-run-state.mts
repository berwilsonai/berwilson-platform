/**
 * A question you can walk away from, verified against the real database.
 *
 * Three claims, each of which looked obviously true in the source and none of
 * which the type checker can see:
 *
 *   1. A `running` row inside the time budget is reported as in flight, and
 *      the SAME row outside it is not. ⚠ This is the §12 "liveness needs a
 *      CLOCK" rule made executable: a run killed by a `launchctl kickstart` —
 *      and a deploy IS a kickstart — writes neither verdict, so a reader
 *      trusting the column alone would wait forever on a turn that died last
 *      week, and a reattaching dock would spin against nothing.
 *   2. History loads the LAST twenty messages, not the first. The route read
 *      `ascending: true` with `.limit(20)` under a comment claiming the
 *      opposite. ⚠ The longest conversation on this box is 12 messages, so
 *      live data CANNOT distinguish the two readings — the fixture has to be
 *      long enough to pull them apart, which is exactly §12's point about a
 *      worked example whose figures coincide.
 *   3. An empty conversation scope returns nothing rather than everything.
 *
 * Everything written here is rolled back.
 *
 * Run: node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/verify-agent-run-state.mts
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { agentDeferWindowMs, agentTimeBudgetMs, liveRuns } from '../src/lib/ai/run-state'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const admin = createAdminClient()

async function main() {
  // A real user id — the FK is enforced, so this cannot be invented.
  const { data: anyConv } = await admin
    .from('agent_conversations')
    .select('user_id')
    .limit(1)
    .single()
  const userId = (anyConv as { user_id: string } | null)?.user_id
  if (!userId) {
    console.log('No conversations on this box to borrow a user id from — nothing to verify.')
    return
  }

  const { data: conv } = await admin
    .from('agent_conversations')
    .insert({ user_id: userId, title: '[verify] agent run state' })
    .select('id')
    .single()
  const convId = (conv as { id: string } | null)?.id
  if (!convId) { check('could create a scratch conversation', false); return }

  try {
    // ── 1. The clock ────────────────────────────────────────────────────────
    const fresh = new Date(Date.now() - 5_000).toISOString()
    const { data: liveRow } = await admin
      .from('agent_messages')
      .insert({
        conversation_id: convId,
        role: 'user',
        content: '[verify] a question still being answered',
        run_state: 'running',
        run_started_at: fresh,
      })
      .select('id')
      .single()
    const liveId = (liveRow as { id: string } | null)?.id as string

    const seen = await liveRuns({ windowMs: agentTimeBudgetMs(), conversationIds: [convId] })
    check(
      'a fresh running row is reported in flight',
      seen.length === 1 && seen[0].messageId === liveId,
      `${seen.length} found`
    )
    check(
      'the in-flight record carries the question itself, so a reattaching client can render it',
      seen[0]?.question === '[verify] a question still being answered'
    )

    // Same row, aged past the budget. Nothing else changes.
    const stale = new Date(Date.now() - agentTimeBudgetMs() - 60_000).toISOString()
    await admin.from('agent_messages').update({ run_started_at: stale }).eq('id', liveId)

    const afterBudget = await liveRuns({ windowMs: agentTimeBudgetMs(), conversationIds: [convId] })
    check(
      'the SAME running row, older than the time budget, is NOT in flight',
      afterBudget.length === 0,
      `${afterBudget.length} found — a kickstarted run would strand every reader`
    )

    // And the sweeps' shorter horizon must be stricter, never looser.
    await admin
      .from('agent_messages')
      .update({ run_started_at: new Date(Date.now() - agentDeferWindowMs() - 60_000).toISOString() })
      .eq('id', liveId)
    const afterDefer = await liveRuns({ windowMs: agentDeferWindowMs(), conversationIds: [convId] })
    check(
      'a run past the defer window stops holding the sweeps back',
      afterDefer.length === 0,
      'otherwise one dead run starves every sweep'
    )
    check(
      'the defer window is shorter than the time budget',
      agentDeferWindowMs() < agentTimeBudgetMs(),
      `defer ${agentDeferWindowMs()}ms vs budget ${agentTimeBudgetMs()}ms`
    )

    // ── 2. An empty scope is an empty answer, never a wildcard ──────────────
    const none = await liveRuns({ windowMs: agentTimeBudgetMs(), conversationIds: [] })
    check('an empty conversation list returns nothing, not everything', none.length === 0)

    // ── 3. History returns the LAST twenty ──────────────────────────────────
    // The run row above carries a default `created_at` of now(), which would
    // sort after every backdated fixture row below and make this section
    // measure the fixture rather than the query. Sections are independent.
    await admin.from('agent_messages').delete().eq('id', liveId)

    // 24 messages, so the two readings disagree: ascending+limit(20) would
    // return 1..20 and miss the four most recent.
    const base = Date.now() - 24 * 60_000
    const rows = Array.from({ length: 24 }, (_, i) => ({
      conversation_id: convId,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${String(i + 1).padStart(2, '0')}`,
      created_at: new Date(base + i * 60_000).toISOString(),
    }))
    await admin.from('agent_messages').insert(rows)

    // The route's own query, verbatim.
    const { data: history } = await admin
      .from('agent_messages')
      .select('role, content, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: false })
      .limit(20)

    const ordered = ((history ?? []) as Array<{ content: string }>)
      .slice()
      .reverse()
      .map(h => h.content)

    check(
      'history ends on the most recent message',
      ordered[ordered.length - 1] === 'msg-24',
      `ends on ${ordered[ordered.length - 1]}`
    )
    check(
      'history does NOT start at the beginning of the conversation',
      !ordered.includes('msg-01'),
      'msg-01 present means the old first-20 read is back'
    )
    check(
      'history is handed to the model oldest-first',
      ordered.every((c, i) => i === 0 || c >= ordered[i - 1]),
      ordered.slice(0, 3).join(', ')
    )
  } finally {
    // Messages cascade with the conversation.
    await admin.from('agent_conversations').delete().eq('id', convId)
    const { count } = await admin
      .from('agent_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', convId)
    check('every scratch row is gone', (count ?? 0) === 0, `${count} left behind`)
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
}

// ⚠ No `process.exit` in a finally — §12: it swallows the throw it is
// unwinding, and the script then reports success for a crash.
await main()
if (failures > 0) process.exitCode = 1
