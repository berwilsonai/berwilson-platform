/**
 * Construction Executive Agent — Gemini-backed agentic loop.
 *
 * Uses gemini-2.5-pro for the main reasoning and gemini-2.5-flash for tool preprocessing.
 */

import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclaration } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { AGENT_SYSTEM_PROMPT, projectContextPreamble } from './prompts/agent'
import { agentTools, executeToolCall } from './agent-tools'

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

/**
 * Run the agent loop: send user message, execute any tool calls, return final response.
 */
export async function runAgent(
  userMessage: string,
  context: AgentContext,
  history: Content[] = []
): Promise<AgentResponse> {
  const client = getClient()
  const supabase = createAdminClient()

  // Build system prompt: start with base, append company qualifications, then optional project context
  let systemPrompt = AGENT_SYSTEM_PROMPT

  // Always inject company profile so the agent knows Ber Wilson's qualifications without needing a tool call
  const { data: companyProfile } = await supabase
    .from('company_profile')
    .select('legal_name, capabilities, naics_codes, dbe_certified, mbe_certified, wbe_certified, sbe_certified, bonding_capacity, aggregate_bonding')
    .limit(1)
    .single()

  const { data: activeCerts } = await supabase
    .from('certifications')
    .select('name, issuing_body, expiration_date, is_active')
    .eq('is_active', true)
    .order('name')

  if (companyProfile) {
    const certList = (activeCerts ?? [])
      .map(c => `  - ${c.name}${c.issuing_body ? ` (${c.issuing_body})` : ''}${c.expiration_date ? `, expires ${c.expiration_date}` : ''}`)
      .join('\n')

    const diversityFlags = [
      companyProfile.dbe_certified && 'DBE',
      companyProfile.mbe_certified && 'MBE',
      companyProfile.wbe_certified && 'WBE',
      companyProfile.sbe_certified && 'SBE',
    ].filter(Boolean).join(', ')

    systemPrompt += `\n\n## BER WILSON COMPANY QUALIFICATIONS
- **Legal Name:** ${companyProfile.legal_name}
- **NAICS Codes:** ${(companyProfile.naics_codes ?? []).join(', ') || 'Not set'}
- **Diversity Status:** ${diversityFlags || 'None certified'}
- **Bonding:** Single project $${companyProfile.bonding_capacity ? (companyProfile.bonding_capacity / 1_000_000).toFixed(1) + 'M' : 'TBD'} | Aggregate $${companyProfile.aggregate_bonding ? (companyProfile.aggregate_bonding / 1_000_000).toFixed(1) + 'M' : 'TBD'}
- **Capabilities:** ${companyProfile.capabilities ? companyProfile.capabilities.slice(0, 500) : 'Not set'}
- **Active Certifications (${(activeCerts ?? []).length}):**
${certList || '  (none on file)'}

Use get_company_qualifications for the full detail including expiry dates and cert numbers.`
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
    const response = await model.generateContent({ contents })

    totalTokensIn += response.response.usageMetadata?.promptTokenCount ?? 0
    totalTokensOut += response.response.usageMetadata?.candidatesTokenCount ?? 0

    const candidate = response.response.candidates?.[0]
    if (!candidate) break

    const parts = candidate.content.parts

    // Check for function calls
    const functionCalls = parts.filter((p: Part) => 'functionCall' in p)

    if (functionCalls.length === 0) {
      // No tool calls — extract text and we're done
      finalText = parts
        .filter((p: Part) => 'text' in p)
        .map((p: Part) => (p as { text: string }).text)
        .join('')
      break
    }

    // Execute tool calls
    const toolResponseParts: Part[] = []

    for (const fc of functionCalls) {
      const call = (fc as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall
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
