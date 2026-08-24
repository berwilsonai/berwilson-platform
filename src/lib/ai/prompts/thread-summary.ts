/**
 * Thread summary prompt — the MAP phase of the mailbox sweep.
 *
 * A full-history sweep of moose@ and tuaone@ is thousands of threads, and on
 * the local model (qwen3.6-35b-a3b, 64k context) each one costs ~25-50s. So the
 * sweep never feeds raw email to the record-building prompt. Instead:
 *
 *   MAP    — this prompt, once per thread: triage + a compact structured
 *            summary. Small input (one thread), small output.
 *   REDUCE — email-intake.ts, once per CLUSTER of related threads, reading
 *            these summaries rather than the original mail. Stays far inside
 *            context no matter how big the deal got.
 *
 * The triage verdict is what makes a full backfill affordable: most of any real
 * mailbox is newsletters, receipts, and scheduling noise, and `noise` threads
 * are never clustered and never reach the reduce phase.
 */

export const THREAD_SUMMARY_PROMPT_VERSION = 'thread-summary-1.0'

export interface ThreadSummaryPerson {
  name: string
  email: string | null
  company: string | null
  title: string | null
  role: string | null
  is_organization: boolean
}

export interface ThreadSummary {
  /**
   * deal        — about a specific pursuit, project, bid, or transaction.
   * operational — real business correspondence with no single deal attached
   *               (hiring, accounting, vendor admin, internal coordination).
   * noise       — newsletters, marketing, receipts, automated alerts,
   *               calendar chatter, personal mail.
   */
  relevance: 'deal' | 'operational' | 'noise'
  /** Canonical deal name — the key the clusterer groups on. Null unless relevance is "deal". */
  deal_name: string | null
  /** The primary external organization on the other side. */
  counterparty: string | null
  /** government | infrastructure | real_estate | prefab | institutional | technology | health */
  sector: string | null
  location: string | null
  estimated_value: number | null
  /** Free text signal of where the deal stood in THIS thread (e.g. "RFP received", "priced, awaiting award"). */
  stage_signal: string | null
  people: ThreadSummaryPerson[]
  /** Hard facts worth carrying into the record: figures, dates, terms, decisions. */
  key_facts: string[]
  /** Unresolved asks, commitments, and next steps as of the last message. */
  open_items: string[]
  /** 2-4 sentences. This is what the reduce phase actually reads. */
  summary: string
  confidence: number
}

export const THREAD_SUMMARY_SYSTEM_PROMPT = `You are triaging email for Ber Wilson, a vertically integrated construction, development, and prefab steel manufacturing company. You are given ONE email thread in full.

Your first job is to classify it:
- "deal" — the thread concerns a specific construction/development pursuit, project, bid, quote, proposal, contract, or corporate transaction. Anything that belongs in a CRM pipeline.
- "operational" — genuine business correspondence with no single deal behind it: hiring, insurance, accounting, banking, software vendors, internal scheduling, general company admin.
- "noise" — newsletters, marketing blasts, sales prospecting aimed AT Ber Wilson, order receipts, shipping notices, automated alerts, password resets, social media notifications, personal or family mail.

Be strict. A vendor cold-emailing Ber Wilson to sell software is "noise", not a deal. A generic "let's connect sometime" with no project attached is "noise". Most email in any real mailbox is noise, and mislabeling it as a deal pollutes the CRM.

If and only if relevance is "deal", set "deal_name" to the canonical name for the underlying pursuit — the name a person would use for it in conversation ("Fort Bliss barracks", "Kirtland AFB hangar re-roof", "Sandia prefab panel supply"). Use the SAME name you would use for any other thread about the same pursuit: prefer the project/site/facility name over the email subject line, strip "RE:"/"FW:" prefixes, and drop incidental words. This name is how separate threads get grouped into one deal, so consistency matters more than elegance.

Extract every distinguishable person and organization into "people" (is_organization=true for companies), each with a short role describing how they relate to the thread. Put concrete figures, dates, terms, and decisions in "key_facts". Put unresolved asks, commitments, and next steps in "open_items".

Use only these enumerations:
- sector: government | infrastructure | real_estate | prefab | institutional | technology | health

Ground everything in the thread — never invent parties, figures, dates, or scope. If a fact is uncertain, leave it out. For "noise" threads, keep it cheap: set the other fields to null or empty arrays and write a one-line summary.

Return ONLY valid JSON matching exactly this shape (no markdown, no commentary):
{
  "relevance": "deal" | "operational" | "noise",
  "deal_name": string|null,
  "counterparty": string|null,
  "sector": string|null,
  "location": string|null,
  "estimated_value": number|null,
  "stage_signal": string|null,
  "people": [{ "name": string, "email": string|null, "company": string|null, "title": string|null, "role": string|null, "is_organization": boolean }],
  "key_facts": [string],
  "open_items": [string],
  "summary": string,
  "confidence": 0.0
}`
