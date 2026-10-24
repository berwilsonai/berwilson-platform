/**
 * The agentic tool loop against the local model — ONE copy, two callers.
 *
 * Lifted out of `agent.ts` on 2026-10-24 when the Jobs runner needed the same
 * loop with a different tool set, a much larger round budget and a checkpoint
 * after every round. Copying it was the obvious move and the wrong one: §12's
 * hardest-to-see fork is two SIBLING MODULES written days apart, neither of
 * which looks like a copy of the other, and the tell is exactly this — a second
 * module answering the same question for a second caller. Everything here was
 * paid for by a real failure in the agent (the empty turn, the context
 * overflow, the narration shipped as the answer), and a second copy would have
 * had to pay for each of them again.
 *
 * What the loop guarantees, and why each one is here:
 *
 *   - IT ALWAYS ENDS ON AN ANSWER. The last round binds no tools, so a function
 *     call is not a reply the model can give. Falling out of the bottom of the
 *     loop once shipped the NARRATION as the answer — three consecutive turns
 *     of a real conversation burned 6, 6 and 9 tool calls and answered nothing.
 *   - IT NEVER RETURNS EMPTY. Qwen's thinking variants can spend a whole
 *     generation inside <think> and emit no visible token; one un-tooled retry
 *     follows, and then a stated admission rather than silence.
 *   - IT SHRINKS THE OLDEST TOOL RESULTS RATHER THAN THE QUESTION, because the
 *     answer is written from what the model looked at LAST. Messages are never
 *     removed, only their content replaced: an OpenAI-format `tool` message must
 *     keep following the `assistant` message whose `tool_calls` it answers.
 *   - IT APPENDS AND NEVER REWRITES, because the KV prefix cache is why a round
 *     is normally fast (§12 — 3.2s warm against 68.3s cold, 21x).
 *
 * The caller supplies the tool executor, so this module knows nothing about
 * `agent-tools.ts` and a job can bind a different set.
 */

import { localChatModel, localChatStream, type LocalChatMessage, type LocalToolCall } from './local'

export interface ToolLoopDeclaration {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

export interface ToolLoopCallbacks {
  /** Fired when the loop starts executing a tool call. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  /** Fired for each chunk of generated answer text, in order. */
  onTextDelta?: (delta: string) => void
  /**
   * Fired when the text streamed so far turned out to be narration before more
   * tool work rather than the answer. The reader should SEE that narration —
   * it is the only evidence the loop is still working — but it must not survive
   * into the finished message, or the stored answer and the live view disagree
   * the moment the page reloads.
   */
  onTextReset?: () => void
}

export interface ToolLoopRoundState {
  round: number
  /** Every tool call made so far this run, in order. */
  toolCalls: ToolLoopCall[]
  tokensIn: number
  tokensOut: number
  /** Text produced by the round that just finished — narration, usually. */
  roundText: string
}

export interface ToolLoopCall {
  name: string
  args: Record<string, unknown>
  result: unknown
}

export interface ToolLoopOptions {
  systemPrompt: string
  /** The seed conversation AFTER the system prompt — normally one user turn. */
  messages: LocalChatMessage[]
  tools: ToolLoopDeclaration[]
  /** Run one tool. Expected to RETURN an error rather than throw; throws are caught anyway. */
  runTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  maxRounds: number
  /** Wall clock after which the NEXT round becomes the closing one. */
  budgetMs: number
  /** Conversation chars (excluding the system prompt) before old results are stubbed. */
  contextBudgetChars: number
  closingInstruction: string
  noAnswerFallback: string
  callbacks?: ToolLoopCallbacks
  /**
   * Called after every round, before the next one starts.
   *
   * ⚠ THE WHOLE REASON A JOB CAN SURVIVE A DEPLOY. Work fired off after a route
   * handler returns dies with the next kickstart and a deploy IS a kickstart
   * (§12), so a long run must store what it has as it goes. The agent passes
   * nothing here — a chat turn that dies is simply re-asked.
   *
   * A throw is swallowed and logged: a checkpoint that fails must not take down
   * the run it exists to protect.
   */
  onRoundComplete?: (state: ToolLoopRoundState) => Promise<void>
  /** Prefix for this run's console lines, e.g. `agent` or `job 3f2a`. */
  label?: string
}

export interface ToolLoopResult {
  content: string
  toolCalls: ToolLoopCall[]
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
  /** Rounds actually used — the signal for whether a budget needs raising. */
  rounds: number
  /** True when the budget ended the run rather than the model finishing. */
  hitBudget: boolean
}

/** Most recent tool results always kept in full — the evidence being reasoned from. */
const KEEP_RECENT_TOOL_RESULTS = 6

function messageChars(m: LocalChatMessage): number {
  const body = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  return body.length + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)
}

const DROPPED =
  '[dropped from context to stay within the model\'s window — this result was already read. Re-request it if you need it again.]'

/**
 * Shrink the oldest tool results until the conversation fits the budget.
 * Mutates in place and returns how many were shrunk, for the log.
 */
export function trimToolHistory(messages: LocalChatMessage[], budget: number): number {
  // Index 0 is the system prompt; it is fixed cost, not conversation.
  let total = messages.reduce((n, m, i) => n + (i === 0 ? 0 : messageChars(m)), 0)
  if (total <= budget) return 0

  const toolIdx = messages
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'tool' && typeof m.content === 'string' && !m.content.startsWith('[dropped'))
    .map(({ i }) => i)

  let shrunk = 0
  // Oldest first, stopping before the results the answer will be written from.
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - KEEP_RECENT_TOOL_RESULTS))) {
    if (total <= budget) break
    const before = messageChars(messages[i])
    if (before < 400) continue // already small — dropping it buys nothing
    messages[i] = { ...messages[i], content: DROPPED }
    total -= before - messageChars(messages[i])
    shrunk++
  }
  return shrunk
}

/** Run a tool and turn any throw into a normal error result. */
async function safeTool(
  run: ToolLoopOptions['runTool'],
  name: string,
  args: Record<string, unknown>,
  label: string
): Promise<unknown> {
  try {
    return await run(name, args)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[${label}] tool ${name} threw:`, message)
    // The model can recover from an error result; it cannot recover from a dead run.
    return { error: `Tool ${name} failed: ${message}` }
  }
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const {
    systemPrompt, tools, runTool, maxRounds, budgetMs, contextBudgetChars,
    closingInstruction, noAnswerFallback, callbacks, onRoundComplete,
  } = options
  const label = options.label ?? 'tool-loop'
  const model = localChatModel()

  const messages: LocalChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...options.messages,
  ]

  const start = Date.now()
  const toolCalls: ToolLoopCall[] = []
  let finalText = ''
  let tokensIn = 0
  let tokensOut = 0
  let rounds = 0
  let hitBudget = false

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1
    const outOfTime = Date.now() - start > budgetMs
    const closing = round === maxRounds - 1 || outOfTime
    if (closing) {
      hitBudget = true
      messages.push({ role: 'user', content: closingInstruction })
    }

    const shrunk = trimToolHistory(messages, contextBudgetChars)
    if (shrunk > 0) {
      console.log(`[${label}] round ${round}: shrank ${shrunk} old tool result(s) to stay inside the context window`)
    }

    let roundText = ''
    const result = await localChatStream({
      model,
      messages,
      // No tools on the closing round: the model cannot ask for more evidence,
      // so the only thing it can emit is the answer.
      ...(closing ? {} : { tools }),
      onTextDelta: (delta) => {
        roundText += delta
        callbacks?.onTextDelta?.(delta)
      },
    })

    tokensIn += result.tokensIn
    tokensOut += result.tokensOut

    if (closing || result.toolCalls.length === 0) {
      finalText = roundText
      hitBudget = closing
      await checkpoint(onRoundComplete, { round, toolCalls, tokensIn, tokensOut, roundText }, label)
      break
    }

    // Narration before more work — never part of the answer.
    if (roundText.trim()) callbacks?.onTextReset?.()

    messages.push({ role: 'assistant', content: result.text, tool_calls: result.toolCalls })

    for (const tc of result.toolCalls as LocalToolCall[]) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        // malformed args from the model — run the tool with none
      }
      callbacks?.onToolCall?.(tc.function.name, args)
      const toolResult = await safeTool(runTool, tc.function.name, args, label)
      toolCalls.push({ name: tc.function.name, args, result: toolResult })
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolResult) })
    }

    await checkpoint(onRoundComplete, { round, toolCalls, tokensIn, tokensOut, roundText }, label)
  }

  // A run must never come back empty.
  if (!finalText.trim()) {
    callbacks?.onTextReset?.()
    try {
      const retry = await localChatStream({
        model,
        messages: [...messages, { role: 'user', content: closingInstruction }],
        onTextDelta: (delta) => callbacks?.onTextDelta?.(delta),
      })
      tokensIn += retry.tokensIn
      tokensOut += retry.tokensOut
      finalText = retry.text
    } catch (err) {
      console.error(`[${label}] forced close failed:`, err)
    }
    if (!finalText.trim()) {
      // Emit it rather than only returning it: a caller that streamed nothing
      // treats the run as a failed request, so a fallback that is stored but
      // never sent shows up as an error instead of as the admission it is.
      finalText = noAnswerFallback
      callbacks?.onTextDelta?.(finalText)
    }
  }

  return {
    content: finalText,
    toolCalls,
    model,
    tokensIn,
    tokensOut,
    latencyMs: Date.now() - start,
    rounds,
    hitBudget,
  }
}

/** A checkpoint that fails must not take down the run it exists to protect. */
async function checkpoint(
  fn: ToolLoopOptions['onRoundComplete'],
  state: ToolLoopRoundState,
  label: string
): Promise<void> {
  if (!fn) return
  try {
    await fn(state)
  } catch (err) {
    console.error(`[${label}] checkpoint after round ${state.round} failed:`, err)
  }
}
