/**
 * Person enrichment from outside the platform — Google Contacts + grounded web
 * search, structured by the model.
 *
 * Lifted out of `api/parties/[id]/enrich` unchanged in behaviour so People
 * Intake can run the same pass over a person it has just read out of the mail.
 * Two copies of this would drift, and the drifting half would be the one nobody
 * was looking at (§12: never fork a shared pass — add a target).
 *
 * Nothing here writes to the database, and nothing here is authoritative: mail
 * evidence beats web evidence at every call site, because a signature block is
 * the person telling you their own title and the web is a guess about it.
 */

import { callGemini } from '@/lib/ai/gemini'
import { researchQuery, type ResearchSource } from '@/lib/ai/research'

// ── Google Contacts ──────────────────────────────────────────────────────────

export interface DirectoryContactResult {
  displayName?: string
  jobTitle?: string
  companyName?: string
  businessPhones?: string[]
  mobilePhone?: string
}

/**
 * Look the person up in the mailbox's Google Contacts, including "other
 * contacts" — people corresponded with but never saved, which is where most
 * counterparties actually live. Silent null on any failure: this is one
 * optional signal among several the enrichment blends.
 */
export async function lookupDirectoryContact(email: string): Promise<DirectoryContactResult | null> {
  try {
    // Dynamic import so an unconfigured integration can't break the build.
    const { lookupContactByEmail } = await import('@/lib/integrations/google-workspace')
    const contact = await lookupContactByEmail(email)
    if (!contact) return null
    return {
      displayName: contact.displayName,
      jobTitle: contact.jobTitle,
      companyName: contact.companyName,
      mobilePhone: contact.phone,
    }
  } catch {
    return null
  }
}

/** The best phone a directory hit offers, preferring a direct line. */
export function directoryPhone(d: DirectoryContactResult | null): string | null {
  return d?.mobilePhone ?? d?.businessPhones?.[0] ?? null
}

// ── Model structuring ────────────────────────────────────────────────────────

export interface StructuredEnrichment {
  linkedin_url?: string | null
  years_of_experience?: string | null
  past_projects?: string[] | null
  government_contract_history?: string | null
  certifications?: string[] | null
  news_mentions?: string[] | null
  notable_affiliations?: string[] | null
  phone?: string | null
  address?: string | null
  litigation_history?: string[] | null
  personal_credentials?: string[] | null
}

export async function structurePersonResearch(
  personTexts: string[],
  companyTexts: string[],
  userId: string
): Promise<StructuredEnrichment> {
  const personSection = personTexts.length > 0
    ? `=== PERSON SEARCH RESULTS (PRIMARY) ===\n${personTexts.join('\n\n---\n\n').slice(0, 6000)}`
    : ''
  const companySection = companyTexts.length > 0
    ? `\n\n=== COMPANY CONTEXT (SECONDARY — use only to fill gaps about the person's role) ===\n${companyTexts.join('\n\n---\n\n').slice(0, 2000)}`
    : ''
  const combined = personSection + companySection

  const result = await callGemini<StructuredEnrichment>({
    task: 'extract',
    systemPrompt:
      'You are a data extraction engine focused on extracting information about a SPECIFIC PERSON — not their company. ' +
      'Prioritize personal details: their individual phone number, address, professional licenses, certifications they personally hold, litigation they are personally named in, and their career history. ' +
      'Company information should only be included to contextualize the person\'s role or tenure. ' +
      'Return ONLY valid JSON. No explanation. No markdown fences.',
    userMessage: `Extract information about this specific person from the text below. Prioritize the PERSON SEARCH RESULTS section. Use COMPANY CONTEXT only to fill gaps about the person's role.\n\nReturn as JSON with these keys:\n- linkedin_url (string)\n- years_of_experience (string)\n- past_projects (array of project names they personally worked on)\n- government_contract_history (string — their personal involvement)\n- certifications (array — professional certs like PE, PMP, LEED AP, etc.)\n- personal_credentials (array — licenses, security clearances, degrees)\n- litigation_history (array — lawsuits, liens, court cases they are named in)\n- phone (string — personal or direct phone number)\n- address (string — personal or business address)\n- news_mentions (array)\n- notable_affiliations (array — boards, associations, memberships)\n\nIf a field is not found, set it to null.\n\nText:\n${combined}`,
    userId,
    promptVersion: 'enrich-v2',
  })
  return (result.data ?? {}) as StructuredEnrichment
}

// ── The whole pass ───────────────────────────────────────────────────────────

export interface PersonWebResearch {
  structured: StructuredEnrichment
  sources: ResearchSource[]
  /** False when web research was unavailable or every query failed. */
  researched: boolean
  /** Set when research was attempted and could not run, for the reviewer. */
  error: string | null
}

/**
 * Three person-focused grounded searches plus one company query for context,
 * structured into fields.
 *
 * Degrades rather than throws: with `LOCAL_ALLOW_WEB_RESEARCH` off, or with
 * Google Search unreachable, this returns `researched: false` and the caller
 * keeps whatever it already had. A counterparty at a private firm often has no
 * web footprint at all, and that is a normal result here, not a failure.
 */
export async function researchPersonWeb(opts: {
  fullName: string
  company?: string | null
  userId: string
}): Promise<PersonWebResearch> {
  const { fullName, userId } = opts
  const company = opts.company?.trim() ?? ''
  const empty: PersonWebResearch = { structured: {}, sources: [], researched: false, error: null }
  if (!fullName.trim()) return empty

  const personQueries = [
    // LinkedIn + professional profile
    `"${fullName}"${company ? ` "${company}"` : ''} site:linkedin.com OR site:usaspending.gov OR site:sam.gov`,
    // Contact info + credentials
    `"${fullName}"${company ? ` "${company}"` : ''} phone address license credentials certification`,
    // Litigation + court records
    `"${fullName}"${company ? ` ${company}` : ''} litigation lawsuit lien court records`,
  ]
  const companyQuery = company ? `${company} government contracts construction history` : null

  const sources: ResearchSource[] = []
  const personTexts: string[] = []
  const companyTexts: string[] = []
  let firstError: string | null = null

  const personResults = await Promise.allSettled(personQueries.map((q) => researchQuery(q)))
  for (const result of personResults) {
    if (result.status === 'fulfilled') {
      personTexts.push(result.value.text)
      sources.push(...result.value.sources)
    } else {
      const message = result.reason instanceof Error ? result.reason.message : 'search failed'
      firstError ??= message
      console.error('[web-enrichment] person query failed:', message)
    }
  }

  if (companyQuery) {
    try {
      const companyRes = await researchQuery(companyQuery)
      companyTexts.push(companyRes.text)
      sources.push(...companyRes.sources)
    } catch (err) {
      console.error('[web-enrichment] company query failed', err)
    }
  }

  if (personTexts.length === 0 && companyTexts.length === 0) {
    return { ...empty, error: firstError }
  }

  let structured: StructuredEnrichment = {}
  try {
    structured = await structurePersonResearch(personTexts, companyTexts, userId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'structuring failed'
    console.error('[web-enrichment] structuring failed:', message)
    return { structured: {}, sources: dedupeSources(sources), researched: false, error: message }
  }

  return { structured, sources: dedupeSources(sources), researched: true, error: null }
}

export function dedupeSources(sources: ResearchSource[], limit = 20): ResearchSource[] {
  return sources.filter((s, i, arr) => arr.findIndex((x) => x.url === s.url) === i).slice(0, limit)
}
