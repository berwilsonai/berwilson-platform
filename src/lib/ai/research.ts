/**
 * Research client — Gemini 2.5 Flash with Google Search grounding.
 * Returns a grounded answer plus source citations (ResearchResult).
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { guardOutboundText } from '@/lib/security/egress'
import { SYSTEM_USER_ID } from '@/lib/system-user'

const MODEL = 'gemini-2.5-flash'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    _client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }
  return _client
}

export interface ResearchSource {
  url: string
  title?: string
}

export interface ResearchResult {
  text: string
  sources: ResearchSource[]
  model: string
  latencyMs: number
}

export interface ResearchOptions {
  /**
   * Who asked. Logged against the outbound query.
   *
   * Defaulted rather than required so the existing callers keep compiling, but
   * every one of them should pass a real user where it has one — this column is
   * the only record of who sent text off the machine.
   */
  userId?: string
}

/**
 * Record that text left the box.
 *
 * ⚠ THIS IS THE AUDIT TRAIL THAT DID NOT EXIST. Until 2026-10-11 `researchQuery`
 * logged nothing anywhere, so there was no way to answer "what has been sent to
 * Google?" — not for a security review and not for a CMMC assessment. Refusals
 * are logged too: a blocked attempt is the more interesting row.
 *
 * Fire-and-forget, like `logAiQuery` in gemini.ts — an audit write must never
 * fail the caller, and `ai_queries` is append-only in practice.
 */
function logEgress(input: {
  userId: string
  query: string
  response: string
  latencyMs: number
}): void {
  createAdminClient()
    .from('ai_queries')
    .insert({
      user_id: input.userId,
      query_text: input.query.slice(0, 2000),
      response_text: input.response.slice(0, 10000),
      model_used: `${MODEL} (web-search egress)`,
      prompt_version: 'research-egress-v1',
      latency_ms: input.latencyMs,
    })
    .then(() => {})
}

/**
 * Run a grounded web-search query and return the answer + source URLs.
 * Uses Google Search grounding so the model cites live web results.
 *
 * Web research cannot run on a local model — it always goes out to Gemini +
 * Google Search. In local AI mode (AI_PROVIDER=local) it is therefore blocked
 * unless LOCAL_ALLOW_WEB_RESEARCH=true opts back in (only the search query
 * leaves the machine, never platform data).
 */
export async function researchQuery(
  query: string,
  opts: ResearchOptions = {}
): Promise<ResearchResult> {
  const userId = opts.userId ?? SYSTEM_USER_ID

  if (process.env.AI_PROVIDER === 'local' && process.env.LOCAL_ALLOW_WEB_RESEARCH !== 'true') {
    throw new Error(
      'Web research is disabled in local AI mode. Set LOCAL_ALLOW_WEB_RESEARCH=true to allow outbound search queries (platform data never leaves the machine — only the search query is sent to Google).'
    )
  }

  /**
   * ⚠ THE CONTAINMENT CHECK ON THE WAY OUT.
   *
   * This is the only place platform text has ever been able to reach an
   * external model, and it had no check at all. `run_research` hands this
   * function a string the MODEL wrote, so the caller cannot be trusted to have
   * kept a protected name out of it.
   */
  const verdict = await guardOutboundText(query)
  if (!verdict.ok) {
    logEgress({ userId, query, response: `REFUSED: ${verdict.reason}`, latencyMs: 0 })
    throw new Error(`This query was not sent out because ${verdict.reason}`)
  }

  const client = getClient()

  const model = client.getGenerativeModel({
    model: MODEL,
    // @ts-expect-error — googleSearch tool type not yet reflected in SDK typedefs
    tools: [{ googleSearch: {} }],
  })

  const start = Date.now()

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: query }] }],
  })

  const latencyMs = Date.now() - start
  const text = result.response.text()

  // Extract grounding sources — type cast required because SDK types lag behind
  type GroundingChunk = { web?: { uri?: string; title?: string } }
  type CandidateWithGrounding = {
    groundingMetadata?: { groundingChunks?: GroundingChunk[] }
  }
  const candidates = (result.response as unknown as { candidates?: CandidateWithGrounding[] }).candidates ?? []
  const chunks: GroundingChunk[] = candidates[0]?.groundingMetadata?.groundingChunks ?? []

  const sources: ResearchSource[] = chunks
    .filter((c) => c.web?.uri)
    .map((c) => ({ url: c.web!.uri!, title: c.web!.title ?? undefined }))
    // deduplicate by URL
    .filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i)

  logEgress({ userId, query, response: text, latencyMs })

  return { text, sources, model: MODEL, latencyMs }
}
