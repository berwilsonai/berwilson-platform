/**
 * Research client — currently backed by Gemini 2.5 Flash with Google Search grounding.
 * Interface is designed to swap to Perplexity sonar-pro when the API key is added.
 *
 * To migrate to Perplexity: replace the body of `researchQuery` with a POST to
 * https://api.perplexity.ai/chat/completions using model "sonar-pro".
 * The return shape (ResearchResult) stays identical.
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
 */
export async function researchQuery(query: string): Promise<ResearchResult> {
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
