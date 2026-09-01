/**
 * Business-card intake — photo in, a drafted contact out.
 *
 * The point of the feature is speed at the moment of meeting someone: photograph
 * the card on a phone, and the platform reads it, works out what the company
 * actually does, and says where they might fit Ber Wilson.
 *
 * Three stages, in order:
 *   1. OCR          — Apple Vision, on-device (see card-ocr.ts). No image ever
 *                     leaves the machine and none is stored.
 *   2. Parse        — the local model turns raw recognized lines into fields.
 *   3. Research+fit — grounded web search on the COMPANY (only the company name
 *                     and website leave, exactly as the Enrich Profile buttons
 *                     already do), then the local model writes the summary and
 *                     the fit read against the real company profile.
 *
 * Stage 3 degrades: with web research off or failing, the draft is still built
 * from the card alone and says so. Nothing here writes to the database — the
 * caller stages a draft the human confirms.
 */

import { callGemini } from '@/lib/ai/gemini'
import { researchQuery, type ResearchSource } from '@/lib/ai/research'
import { getCompanyContext } from '@/lib/ai/company-context'

export interface CardFields {
  full_name: string | null
  title: string | null
  company: string | null
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
}

export interface CardScanDraft extends CardFields {
  /** Two or three sentences on what the company does. */
  company_summary: string | null
  /** Where they might fit Ber Wilson — or plainly that they might not. */
  fit_notes: string | null
  /** Suggested directory tags, always including `business-card`. */
  tags: string[]
  /** Raw recognized text, kept so a bad parse can be checked against it. */
  raw_text: string
  sources: ResearchSource[]
  /** False when web research was unavailable — the draft is card-only. */
  researched: boolean
  /** Set when research was attempted and failed, for the reviewer to see. */
  research_error: string | null
}

// ── Stage 2: parse the recognized text ───────────────────────────────────────

const PARSE_SYSTEM =
  'You read the text recognized from a photograph of a business card and return it as structured fields. ' +
  'The lines arrive in reading order and may include noise, logo words, or slogans. ' +
  'Extract only what is actually present — never invent, complete, or guess a value. ' +
  'Return ONLY valid JSON. No explanation. No markdown fences.'

function parsePrompt(rawText: string): string {
  return `Return JSON with exactly these keys:
- full_name (string) — the PERSON on the card, not the company. Keep credentials that follow the name (e.g. "Marcus Delgado, P.E."). Null for a card with no individual named.
- title (string) — their job title
- company (string) — the organization name. Cards are often printed in capitals: normalize an ALL-CAPS name to Title Case ("SUMMIT RIDGE ENGINEERING" -> "Summit Ridge Engineering"), but leave genuine acronyms and initialisms capitalized (IHC, AECOM, HDR, JV suffixes).
- email (string)
- phone (string) — if several are printed, prefer a direct or mobile line over a main switchboard
- website (string) — a domain or URL. If absent but an email domain is present and is not a generic mail provider (gmail, outlook, yahoo, hotmail, icloud, aol), derive it from that domain.
- address (string) — the full mailing address on one line

Set any key you cannot fill to null. Do not carry a slogan into a field.

CARD TEXT:
${rawText}`
}

export async function parseCardText(rawText: string, userId: string): Promise<CardFields> {
  const result = await callGemini<Partial<CardFields>>({
    task: 'extract',
    systemPrompt: PARSE_SYSTEM,
    userMessage: parsePrompt(rawText),
    userId,
    promptVersion: 'card-intake-1.0',
  })

  const d = (typeof result.data === 'object' && result.data !== null ? result.data : {}) as Partial<CardFields>
  const s = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : ''
    return t && t.toLowerCase() !== 'null' ? t : null
  }

  return {
    full_name: s(d.full_name),
    title: s(d.title),
    company: s(d.company),
    email: s(d.email),
    phone: s(d.phone),
    website: s(d.website),
    address: s(d.address),
  }
}

// ── Stage 3: research the company, then judge fit ────────────────────────────

interface FitResult {
  company_summary?: string | null
  fit_notes?: string | null
  tags?: string[] | null
}

const FIT_SYSTEM =
  'You are a senior construction-industry executive at Ber Wilson assessing a new contact met in person. ' +
  'You will be given what their business card said, what web research found about their company, and Ber Wilson\'s own profile. ' +
  'Be concrete and short. Ground every claim in the material given — where the research is thin, say so plainly rather than filling the gap. ' +
  'It is a useful and expected answer that a contact has no obvious fit; never manufacture one. ' +
  'Return ONLY valid JSON. No explanation. No markdown fences.'

function fitPrompt(fields: CardFields, research: string, companyContext: string | null): string {
  const card = [
    fields.full_name && `Name: ${fields.full_name}`,
    fields.title && `Title: ${fields.title}`,
    fields.company && `Company: ${fields.company}`,
    fields.website && `Website: ${fields.website}`,
    fields.address && `Address: ${fields.address}`,
  ]
    .filter(Boolean)
    .join('\n')

  return `=== BUSINESS CARD ===
${card || '(no fields parsed)'}

=== WEB RESEARCH ON THEIR COMPANY ===
${research.trim() ? research.slice(0, 8000) : '(no research available — judge from the card alone and say the research is thin)'}

=== BER WILSON ===
${companyContext ?? '(company profile unavailable — keep the fit read general)'}

Return JSON with exactly these keys:
- company_summary (string) — 2-3 sentences on what their company actually does: its line of work, market, and scale where known. Describe the company, not the person.
- fit_notes (string) — 2-4 sentences on where this contact might be useful to Ber Wilson: as a subcontractor, vendor, design partner, client, teaming partner on a pursuit, or capital source. Name the specific Ber Wilson sector or capability the overlap runs through. If there is no evident fit, say that directly and briefly.
- tags (array of 1-4 short lowercase strings) — directory tags describing their line of work and their likely role to us, e.g. ["structural-engineering", "subcontractor"]. Use hyphens, no spaces. Tag what they DO — never tag your own confidence or the quality of the research ("unverified", "needs-research" and the like are not tags).

Set a key to null if you genuinely cannot answer it.`
}

/**
 * One retry on a transient upstream failure. Gemini returns 503 "high demand"
 * often enough that a single scan can come back research-less for no reason
 * worth showing the user, and the whole value of the feature is the research.
 */
async function researchWithRetry(query: string) {
  try {
    return await researchQuery(query)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const transient = /\b(429|503|500|overloaded|high demand|timed? out|ECONNRESET)\b/i.test(msg)
    if (!transient) throw err
    await new Promise((r) => setTimeout(r, 2500))
    return researchQuery(query)
  }
}

/** Company research only — the person is not searched. That is Enrich Profile's job. */
async function researchCompany(fields: CardFields): Promise<{ text: string; sources: ResearchSource[]; error: string | null }> {
  const company = fields.company
  if (!company) {
    return { text: '', sources: [], error: null }
  }

  const site = fields.website ? ` ${fields.website}` : ''
  const queries = [
    `${company}${site} — what does this company do, services, markets, size, location`,
    `${company} construction projects clients news`,
  ]

  const results = await Promise.allSettled(queries.map((q) => researchWithRetry(q)))

  const texts: string[] = []
  const sources: ResearchSource[] = []
  let firstError: string | null = null

  for (const r of results) {
    if (r.status === 'fulfilled') {
      texts.push(r.value.text)
      sources.push(...r.value.sources)
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
      firstError ??= msg
      console.error('[card-intake] company research failed:', msg)
    }
  }

  return {
    text: texts.join('\n\n---\n\n'),
    // Dedupe by URL — the two queries overlap heavily.
    sources: sources.filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i),
    error: texts.length > 0 ? null : firstError,
  }
}

function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const cleaned = list
    .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-'))
    .filter((t) => t.length > 1 && t.length <= 40)
  // `business-card` marks the provenance — how this contact got here.
  return [...new Set(['business-card', ...cleaned])].slice(0, 6)
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Run the whole pipeline over already-recognized card text. Never throws for a
 * research failure: a contact drafted from the card alone is still worth having.
 */
export async function buildCardDraft(rawText: string, userId: string): Promise<CardScanDraft> {
  const fields = await parseCardText(rawText, userId)

  const [research, companyContext] = await Promise.all([
    researchCompany(fields),
    getCompanyContext().catch(() => null),
  ])

  let fit: FitResult = {}
  try {
    const result = await callGemini<FitResult>({
      task: 'synthesize',
      systemPrompt: FIT_SYSTEM,
      userMessage: fitPrompt(fields, research.text, companyContext?.text ?? null),
      userId,
      promptVersion: 'card-intake-1.0',
    })
    if (typeof result.data === 'object' && result.data !== null) fit = result.data
  } catch (err) {
    console.error('[card-intake] fit assessment failed:', err)
  }

  const str = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : ''
    return t && t.toLowerCase() !== 'null' ? t : null
  }

  return {
    ...fields,
    company_summary: str(fit.company_summary),
    fit_notes: str(fit.fit_notes),
    tags: normalizeTags(fit.tags),
    raw_text: rawText,
    sources: research.sources,
    researched: research.text.length > 0,
    research_error: research.error,
  }
}
