/**
 * Construction Executive Agent — Gemini-backed agentic loop.
 *
 * Uses gemini-2.5-pro for the main reasoning and gemini-2.5-flash for tool preprocessing.
 */

import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclaration } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { AGENT_SYSTEM_PROMPT, projectContextPreamble } from './prompts/agent'
import { agentTools, executeToolCall } from './agent-tools'
import { getCompanyContext } from './company-context'
import { isLocalAI, localChatModel, localChatStream, type LocalChatMessage } from './local'

const AGENT_MODEL = 'gemini-2.5-pro'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  return _client
}

export interface AgentContext {
  userId: string
  projectId?: string
  conversationId: string
}

export interface AgentResponse {
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result: unknown }>
  model: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

/** Optional live-progress hooks — used by the streaming API route. */
export interface AgentStreamCallbacks {
  /** Fired when the agent starts executing a tool call. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  /** Fired for each chunk of generated answer text, in order. */
  onTextDelta?: (delta: string) => void
}

/**
 * Run the agent loop: send user message, execute any tool calls, return final response.
 * Pass `callbacks` to receive tool-call and text-delta events as they happen.
 */
export async function runAgent(
  userMessage: string,
  context: AgentContext,
  history: Content[] = [],
  callbacks?: AgentStreamCallbacks
): Promise<AgentResponse> {
  const supabase = createAdminClient()

  // Build system prompt: start with base, append company qualifications, then optional project context
  let systemPrompt = AGENT_SYSTEM_PROMPT

  // Always inject the company profile + pursuit criteria so the agent knows
  // Ber Wilson's qualifications and appetite without needing a tool call.
  const company = await getCompanyContext()
  if (company) {
    systemPrompt += `\n\n${company.text}\n\nUse get_company_qualifications for the full detail including expiry dates and cert numbers.`
  }

  if (context.projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('name, sector, status, stage, location, client_entity, estimated_value, parent_project_id')
      .eq('id', context.projectId)
      .single()

    if (project) {
      // Resolve parent name and child count for hierarchy context
      let parentName: string | null = null
      let childCount = 0

      const [parentResult, childCountResult] = await Promise.all([
        project.parent_project_id
          ? supabase.from('projects').select('name').eq('id', project.parent_project_id).single()
          : Promise.resolve({ data: null }),
        supabase.from('projects').select('id', { count: 'exact', head: true }).eq('parent_project_id', context.projectId!),
      ])

      if (parentResult.data) parentName = (parentResult.data as { name: string }).name
      childCount = childCountResult.count ?? 0

      systemPrompt += projectContextPreamble({
        ...project,
        parent_name: parentName,
        child_count: childCount,
      })
    }
  }

  if (isLocalAI()) {
    return runAgentLocal(userMessage, systemPrompt, context, history, callbacks)
  }

  const client = getClient()
  const model = client.getGenerativeModel({
    model: AGENT_MODEL,
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: agentTools as unknown as FunctionDeclaration[] }],
  })

  const contents: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const start = Date.now()
  const toolCallLog: AgentResponse['toolCalls'] = []

  // Agentic loop — up to 5 tool-call rounds
  let finalText = ''
  let totalTokensIn = 0
  let totalTokensOut = 0

  for (let round = 0; round < 5; round++) {
    // Stream each round so answer tokens reach the client as they're generated.
    const result = await model.generateContentStream({ contents })

    for await (const chunk of result.stream) {
      let delta = ''
      try { delta = chunk.text() } catch { /* chunk holds a functionCall, not text */ }
      if (delta) {
        finalText += delta
        callbacks?.onTextDelta?.(delta)
      }
    }

    const response = await result.response

    totalTokensIn += response.usageMetadata?.promptTokenCount ?? 0
    totalTokensOut += response.usageMetadata?.candidatesTokenCount ?? 0

    const candidate = response.candidates?.[0]
    if (!candidate) break

    const parts = candidate.content.parts

    // Check for function calls
    const functionCalls = parts.filter((p: Part) => 'functionCall' in p)

    if (functionCalls.length === 0) break // no tool calls — the streamed text is the answer

    // Execute tool calls
    const toolResponseParts: Part[] = []

    for (const fc of functionCalls) {
      const call = (fc as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall
      callbacks?.onToolCall?.(call.name, call.args)
      const result = await executeToolCall(call.name, call.args, context)
      toolCallLog.push({ name: call.name, args: call.args, result })

      toolResponseParts.push({
        functionResponse: {
          name: call.name,
          response: { result },
        },
      } as unknown as Part)
    }

    // Add assistant response + tool results to conversation
    contents.push({ role: 'model', parts })
    contents.push({ role: 'user', parts: toolResponseParts })
  }

  const latencyMs = Date.now() - start

  return {
    content: finalText,
    toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
    model: AGENT_MODEL,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    latencyMs,
  }
}

// ---------------------------------------------------------------------------
// Local provider (AI_PROVIDER=local) — same loop against the LM Studio
// OpenAI-compatible endpoint. agentTools declarations are plain JSON Schema,
// so they map straight into OpenAI tool format.
// ---------------------------------------------------------------------------

const localToolDeclarations = agentTools.map((t) => ({
  type: 'function' as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters as unknown,
  },
}))

/** Convert stored Gemini-format history into OpenAI-format messages. */
function historyToLocalMessages(history: Content[]): LocalChatMessage[] {
  return history
    .map((c): LocalChatMessage | null => {
      const text = (c.parts ?? [])
        .map((p) => ('text' in p && typeof p.text === 'string' ? p.text : ''))
        .join('')
      if (!text) return null
      return { role: c.role === 'model' ? 'assistant' : 'user', content: text }
    })
    .filter((m): m is LocalChatMessage => m !== null)
}

async function runAgentLocal(
  userMessage: string,
  systemPrompt: string,
  context: AgentContext,
  history: Content[],
  callbacks?: AgentStreamCallbacks
): Promise<AgentResponse> {
  const model = localChatModel()

  const messages: LocalChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyToLocalMessages(history),
    { role: 'user', content: userMessage },
  ]

  const start = Date.now()
  const toolCallLog: NonNullable<AgentResponse['toolCalls']> = []

  let finalText = ''
  let totalTokensIn = 0
  let totalTokensOut = 0

  // Agentic loop — up to 5 tool-call rounds, matching the Gemini path
  for (let round = 0; round < 5; round++) {
    const result = await localChatStream({
      model,
      messages,
      tools: localToolDeclarations,
      onTextDelta: (delta) => {
        finalText += delta
        callbacks?.onTextDelta?.(delta)
      },
    })

    totalTokensIn += result.tokensIn
    totalTokensOut += result.tokensOut

    if (result.toolCalls.length === 0) break

    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: result.toolCalls,
    })

    for (const tc of result.toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        // malformed args from the model — run the tool with none
      }
      callbacks?.onToolCall?.(tc.function.name, args)
      const toolResult = await executeToolCall(tc.function.name, args, context)
      toolCallLog.push({ name: tc.function.name, args, result: toolResult })

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      })
    }
  }

  return {
    content: finalText,
    toolCalls: toolCallLog.length > 0 ? toolCallLog : undefined,
    model,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    latencyMs: Date.now() - start,
  }
}
