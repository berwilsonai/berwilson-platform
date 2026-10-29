/**
 * Running one job.
 *
 * ⚠ THE LOOP IS NOT HERE — it is `src/lib/ai/tool-loop.ts`, shared with the
 * agent. Everything in that loop was paid for by a real failure in /intel (the
 * empty turn, the context overflow, the narration shipped as the answer), and a
 * second copy here would have had to pay for each of them again (§12: a fork is
 * hardest to see as two sibling modules written days apart). What this file
 * adds is the three things a JOB needs and a chat turn does not:
 *
 *   1. A CHECKPOINT AFTER EVERY ROUND. Work fired off after a route handler
 *      returns dies with the next kickstart, and `npm run build` IS the deploy
 *      (§12). A job that has run 40 minutes must not lose it because somebody
 *      shipped. The heartbeat also moves on every round, which is what lets a
 *      reader tell a long healthy job from a dead one — a count that has
 *      stopped growing is indistinguishable from a quiet inbox.
 *   2. A PROPOSAL TOOL rather than write access. The model's operations are
 *      validated the moment it proposes them and the refusal goes back into the
 *      conversation, so a bad proposal costs one round instead of being
 *      discovered by the human at review time.
 *   3. A MUCH larger round budget, because an audit over twenty records is
 *      twenty reads and that is the job rather than a sign of trouble.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { agentTools, executeToolCall } from '@/lib/ai/agent-tools'
import { getCompanyContext } from '@/lib/ai/company-context'
import { runToolLoop, type ToolLoopDeclaration } from '@/lib/ai/tool-loop'
import type { JsonIn } from '@/lib/supabase/types'
import {
  MAX_OPERATIONS,
  OPERATION_KINDS,
  describeOperation,
  validateOperations,
  type JobOperation,
} from './operations'
import { JOB_CLOSING_INSTRUCTION, JOB_NO_ANSWER_FALLBACK, JOB_SYSTEM_PROMPT } from './prompt'

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

/**
 * Rounds and wall clock for one job. Both far above the agent's, deliberately:
 * a chat turn is answering somebody who is waiting, and a job is not.
 */
export const jobMaxRounds = () => envInt('JOB_MAX_TOOL_ROUNDS', 60)
export const jobBudgetMs = () => envInt('JOB_TIME_BUDGET_MS', 60 * 60 * 1000)
const jobContextBudgetChars = () =>
  envInt('JOB_CONTEXT_BUDGET_CHARS', envInt('AGENT_CONTEXT_BUDGET_CHARS', 120_000))

/**
 * How long a `working` job may go without a heartbeat before a reader calls it
 * abandoned. The CLOCK half of the liveness test — there is deliberately no DB
 * latch, because a kickstart would make one immortal and the job could never be
 * re-run (§12, the same reasoning as `COMPOSE_STALE_MS`).
 */
export const jobStaleMs = () => envInt('JOB_STALE_MS', 10 * 60 * 1000)

const PROPOSE_TOOL: ToolLoopDeclaration = {
  type: 'function',
  function: {
    name: 'propose_operations',
    description:
      'Propose changes to the platform for the executive to review and apply. You cannot write to the database; this is how a change gets made. ' +
      'Call it once with everything you propose, or several times as you work — proposals accumulate. ' +
      'Each operation is validated immediately and anything refused comes back with the reason, so you can correct it. ' +
      'Propose nothing if the job was a question or an audit: an empty list is a complete answer.',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description:
            `Each item must have a "kind" of ${OPERATION_KINDS.join(', ')} plus that kind's own fields. ` +
            'update_field: table, record_id, field, value, evidence, record_label. ' +
            'create_contact: full_name, title, company, email, phone, notes, tags. ' +
            'create_task: title, what, why, due_date (YYYY-MM-DD), project_id or opportunity_id. ' +
            'add_note: target (party|project|opportunity), record_id, body. ' +
            'tag_records: table (parties), record_ids, add, remove. ' +
            'link_thread: thread_id (from search_correspondence), record_kind (project|opportunity), record_id, record_label, evidence — evidence is REQUIRED and must name what in the thread places it on that deal. ' +
            'add_player: party_id, record_kind, record_id, role, record_label, party_label. ' +
            'create_record: record_kind (project|opportunity), name, description, location, sector, stage, client_entity, estimated_value, evidence — evidence is REQUIRED. ' +
            'Every id must have come back from a tool — never invent one.',
          items: { type: 'object' },
        },
      },
      required: ['operations'],
    },
  },
}

const jobToolDeclarations: ToolLoopDeclaration[] = [
  ...agentTools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters as unknown },
  })),
  PROPOSE_TOOL,
]

export interface RunJobResult {
  report: string
  operations: JobOperation[]
  rounds: number
  hitBudget: boolean
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

export async function runJob(args: {
  db: SupabaseClient<Database>
  jobId: string
  instruction: string
  userId: string
}): Promise<RunJobResult> {
  const { db, jobId, instruction, userId } = args
  const label = `job ${jobId.slice(0, 8)}`

  let systemPrompt = JOB_SYSTEM_PROMPT
  const company = await getCompanyContext()
  if (company) systemPrompt += `\n\n${company.text}`

  // Proposals accumulate across calls, deduped on their rendered description —
  // a model asked to propose twice in one run will repeat itself, and the same
  // change applied twice is the bug the reviewer would have to catch.
  const proposed: JobOperation[] = []
  const seen = new Set<string>()
  let seq = 0

  async function event(kind: 'tool' | 'note' | 'error', labelText: string, detail?: unknown) {
    await db.from('job_events').insert({
      job_id: jobId,
      seq: seq++,
      kind,
      label: labelText.slice(0, 300),
      detail: (detail ?? null) as JsonIn,
    })
  }

  const result = await runToolLoop({
    systemPrompt,
    messages: [{ role: 'user', content: instruction }],
    tools: jobToolDeclarations,
    maxRounds: jobMaxRounds(),
    budgetMs: jobBudgetMs(),
    contextBudgetChars: jobContextBudgetChars(),
    closingInstruction: JOB_CLOSING_INSTRUCTION,
    noAnswerFallback: JOB_NO_ANSWER_FALLBACK,
    label,

    runTool: async (name, toolArgs) => {
      if (name === 'propose_operations') {
        const { operations, rejected } = validateOperations(toolArgs.operations)
        let added = 0
        let duplicates = 0
        for (const op of operations) {
          if (proposed.length >= MAX_OPERATIONS) break
          const key = describeOperation(op)
          if (seen.has(key)) { duplicates++; continue }
          seen.add(key)
          proposed.push(op)
          added++
        }
        await event('note', `proposed ${added} operation(s)`, {
          added, duplicates, rejected: rejected.length, total: proposed.length,
        })
        // ⚠ The refusals go BACK to the model with their reasons, which is the
        // whole point of validating at proposal time rather than at apply time.
        return {
          accepted: added,
          duplicates_ignored: duplicates,
          total_proposed_so_far: proposed.length,
          refused: rejected.map((r) => r.reason),
          note: rejected.length
            ? 'Some operations were refused. Fix them and propose again, or explain in your report why that change cannot be made.'
            : 'Accepted. Continue the job, or write your report if it is done.',
        }
      }

      // Every other tool is one of the agent's — all read-only, and they apply
      // the confidentiality filter at their own choke point.
      return executeToolCall(name, toolArgs, { userId, conversationId: jobId })
    },

    callbacks: {
      onToolCall: (name, toolArgs) => {
        // Fire-and-forget: a step log that blocks the work it describes is worse
        // than one that lands a moment late.
        void event('tool', name, toolArgs)
      },
    },

    // ── The checkpoint. See the header. ──────────────────────────────────────
    onRoundComplete: async (state) => {
      await db
        .from('jobs')
        .update({
          status: 'working',
          heartbeat_at: new Date().toISOString(),
          rounds: state.round + 1,
          tokens_in: state.tokensIn,
          tokens_out: state.tokensOut,
          operations: proposed as unknown as JsonIn,
        })
        .eq('id', jobId)
    },
  })

  return {
    report: result.content,
    operations: proposed,
    rounds: result.rounds,
    hitBudget: result.hitBudget,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    latencyMs: result.latencyMs,
  }
}
