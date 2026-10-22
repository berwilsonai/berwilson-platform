/**
 * IS BER AI STILL THINKING? — asked in one place, by everyone who asks it.
 *
 * Two callers, deliberately sharing a definition rather than each reading the
 * column their own way (§12 — a shared renderer wired to one surface is worse
 * than no shared renderer):
 *
 *   1. The agent route's GET, so a LATER mount — another tab, a reload, the
 *      dock after it remounted crossing a record boundary — can reattach to a
 *      question already being worked on.
 *   2. The business-hour sweeps, which stand aside while somebody is waiting
 *      on an answer (LM Studio serves ONE request at a time, §2).
 *
 * ⚠ LIVENESS IS A CLOCK, NOT THE COLUMN. The run already survives the client
 * leaving — the SSE route never reads `request.signal` and nothing aborts
 * `runAgent` — but a `launchctl kickstart` kills the process outright, and a
 * deploy IS a kickstart (§12). Such a run can write neither 'answered' nor
 * 'failed', so `run_state = 'running'` is immortal on its own and a reader
 * trusting it alone would wait forever on a turn that died last Tuesday.
 * Every query here pairs the column with `run_started_at`.
 *
 * ⚠ IMPORTS NOTHING FROM `next/*`. §12: `next/server` and `next/headers` do
 * not resolve under `deploy/register.mjs`, and a top-level import of either
 * poisons a whole module for verification scripts — including its pure
 * functions. This module is imported by cron routes and by tests, so it stays
 * clean.
 */

import { createAdminClient } from '@/lib/supabase/admin'

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * How long a turn may run before the loop brings it in to land.
 *
 * ⚠ OWNED HERE, IMPORTED BY `agent.ts`. It was a private helper there, which
 * was fine while one file cared; the moment a second reader needed the same
 * number, two copies of an env read would have drifted the first time one was
 * tuned. The default matches the 2026-09-26 decision ("I don't care how long
 * it takes, I just want the most accurate answers as possible") — 30 minutes
 * is a runaway guard, not a budget.
 */
export const agentTimeBudgetMs = () => envInt('AGENT_TIME_BUDGET_MS', 1_800_000)

/**
 * How recently a turn must have started for a SWEEP to stand aside for it.
 *
 * Deliberately much shorter than the time budget. Deferral is advisory, never
 * a lock: if it used the full 30 minutes, a single run killed mid-flight by a
 * deploy would starve every sweep for half an hour, and the sweeps are how the
 * CRM fills itself. Ten minutes covers the p90 answer (455s) with margin and
 * bounds the damage of a stale row to one cron tick.
 */
export const agentDeferWindowMs = () => envInt('AGENT_DEFER_WINDOW_MS', 600_000)

/** A question whose answer is still being written. */
export interface InFlightRun {
  /** The user-message row — the job record. */
  messageId: string
  conversationId: string
  /** The question, as asked, so a reattaching client can render it. */
  question: string
  startedAt: string
}

interface RunRow {
  id: string
  conversation_id: string
  content: string
  run_started_at: string | null
}

/**
 * Every live run, newest first.
 *
 * `windowMs` is the staleness horizon and is REQUIRED — there is no safe
 * default shared by both callers, and §12's rule about explicit parameters
 * applies: the reattach wants the full budget (a 16-minute answer is real and
 * has happened), the sweep guard wants ten minutes. A single default would be
 * wrong for one of them silently.
 *
 * `conversationIds` scopes the read. Passing an empty array returns nothing
 * rather than everything — an empty scope is an empty answer, never a wildcard.
 */
export async function liveRuns(opts: {
  windowMs: number
  conversationIds?: string[]
}): Promise<InFlightRun[]> {
  if (opts.conversationIds && opts.conversationIds.length === 0) return []

  const since = new Date(Date.now() - opts.windowMs).toISOString()
  const admin = createAdminClient()

  let q = admin
    .from('agent_messages')
    .select('id, conversation_id, content, run_started_at')
    .eq('run_state', 'running')
    .gt('run_started_at', since)
    .order('run_started_at', { ascending: false })
    .limit(20)

  // ⚠ Chunked at 200 rather than handed the whole list: a filter rides in the
  // query string, so `.in()` with a thousand uuids is a 37KB GET that Kong
  // refuses outright with `URI too long` (§12). Twenty conversations is the
  // realistic ceiling here, but the cap belongs in the code, not in the
  // assumption.
  if (opts.conversationIds) {
    q = q.in('conversation_id', opts.conversationIds.slice(0, 200)) as typeof q
  }

  const { data, error } = await q
  if (error) {
    // A failed read is not evidence that nothing is running (§12). Say so and
    // return nothing — the reattach simply does not reattach, and the sweep
    // runs, which is the behaviour each had before this existed.
    console.warn('[run-state] could not read live runs:', error.message)
    return []
  }

  return ((data ?? []) as RunRow[])
    .filter((r) => r.run_started_at)
    .map((r) => ({
      messageId: r.id,
      conversationId: r.conversation_id,
      question: r.content,
      startedAt: r.run_started_at as string,
    }))
}

/**
 * Is somebody waiting on Ber AI right now?
 *
 * Called at the top of the sweeps that do model work. Returns the question's
 * age so the caller can SAY why it stood aside — a pass that skips silently is
 * indistinguishable from one that is broken, which is the failure §12 keeps
 * naming.
 */
export async function interactiveRunInFlight(): Promise<
  { busy: false } | { busy: true; since: string; waitingMs: number }
> {
  const runs = await liveRuns({ windowMs: agentDeferWindowMs() })
  if (runs.length === 0) return { busy: false }

  // Newest first, so [0] is the most recent question asked.
  const since = runs[0].startedAt
  return { busy: true, since, waitingMs: Date.now() - new Date(since).getTime() }
}

/**
 * The standard response for a sweep that stood aside, so all eight of them
 * report it the same way and a log reader never has to guess.
 */
export function deferredResponse(pass: string, run: { since: string; waitingMs: number }) {
  return {
    ok: true,
    deferred: true,
    pass,
    reason:
      `stood aside — somebody is waiting on a Ber AI answer (asked ${Math.round(run.waitingMs / 1000)}s ago). ` +
      `LM Studio serves one request at a time, so running now would be added to their wait. ` +
      `This pass checkpoints and will pick up on its next scheduled run.`,
    waitingSince: run.since,
  }
}
