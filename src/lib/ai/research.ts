/**
 * Research client — Gemini 2.5 Flash with Google Search grounding.
 * Returns a grounded answer plus source citations (ResearchResult).
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

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

/**
 * Run a grounded web-search query and return the answer + source URLs.
 * Uses Google Search grounding so the model cites live web results.
 *
 * Web research cannot run on a local model — it always goes out to Gemini +
 * Google Search. In local AI mode (AI_PROVIDER=local) it is therefore blocked
 * unless LOCAL_ALLOW_WEB_RESEARCH=true opts back in (only the search query
 * leaves the machine, never platform data).
 */
export async function researchQuery(query: string): Promise<ResearchResult> {
  if (process.env.AI_PROVIDER === 'local' && process.env.LOCAL_ALLOW_WEB_RESEARCH !== 'true') {
    throw new Error(
      'Web research is disabled in local AI mode. Set LOCAL_ALLOW_WEB_RESEARCH=true to allow outbound search queries (platform data never leaves the machine — only the search query is sent to Google).'
    )
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

  return { text, sources, model: MODEL, latencyMs }
}
