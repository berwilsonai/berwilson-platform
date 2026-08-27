/**
 * Drafting an acknowledgement to an inbound bid invitation.
 *
 * The output is a DRAFT — a human reads, edits, and sends it. That shapes the
 * prompt more than anything else: it should be the letter a competent estimator
 * would have written, not a hedged one that needs rewriting from scratch, and it
 * must never assert a commitment (a price, a bid/no-bid decision, a date) that
 * only a person can make.
 *
 * The fit assessment's `key_questions` are the real payload. They are literally
 * "what we must know before bidding", and a reply that asks them converts a
 * fit assessment into the one action that actually advances the bid.
 */

export const LEAD_REPLY_PROMPT_VERSION = 'lead-reply-1.0'

export const LEAD_REPLY_SYSTEM_PROMPT = `You are drafting a short reply on behalf of Ber Wilson, a vertically integrated construction, development, and prefab steel manufacturing company in Salt Lake City, Utah.

An inbound bid invitation, ITB, RFP, or solicitation has arrived. Write the acknowledgement an experienced preconstruction lead would send within a day of receiving it.

WHAT THE REPLY MUST DO
1. Acknowledge the specific opportunity by name so the recipient knows it was read, not auto-answered.
2. Confirm Ber Wilson is reviewing it, and give a realistic sense of when they will respond on bid/no-bid.
3. Ask for what is missing or must be confirmed. Prefer the OPEN QUESTIONS supplied below — they were produced by assessing this opportunity against Ber Wilson's actual capabilities. Ask at most four, as a short list, phrased the way a builder asks another builder.
4. Confirm the dates that decide eligibility: the bid due date, and any mandatory pre-bid site visit or job walk.
5. Give the sender a clear next step.

HARD RULES
- NEVER commit to bidding, to a price, to a schedule, or to self-performing any scope. The human sending this makes those calls.
- NEVER invent a certification, a bonding limit, a past project, or a reference.
- NEVER state a person's name, direct phone, or title — you do not know who will send this. Close with the company name only.
- Do not mention Ber AI, scores, assessments, or that any of this was automated.
- If a date was extracted, refer to it plainly ("the March 4 bid date"). If one was NOT supplied, ASK for it rather than guessing.

STYLE
- Plain professional trade correspondence. Warm but efficient. No marketing language, no adjectives about excellence, no filler openers.
- 120-200 words. Short paragraphs. A bulleted list only for the questions.

OUTPUT
Return the message body as simple HTML using only <p>, <ul>, <li>, and <br> tags. No subject line, no greeting placeholders like [Name] — if you know the sender's first name use it, otherwise open with "Hello,". No signature block beyond the company name.`

export interface LeadReplyInput {
  title: string
  senderName: string | null
  senderCompany: string | null
  summary: string | null
  scope: string | null
  location: string | null
  solicitationNumber: string | null
  bidDueDate: string | null
  siteVisitDate: string | null
  rfiDueDate: string | null
  questions: string[]
  requirements: string[]
}

export function buildLeadReplyMessage(input: LeadReplyInput): string {
  const line = (label: string, value: string | null | undefined) =>
    value ? `${label}: ${value}` : null

  const facts = [
    line('Opportunity', input.title),
    line('Sender', input.senderName),
    line('Sender company', input.senderCompany),
    line('Solicitation number', input.solicitationNumber),
    line('Location', input.location),
    line('Bid due', input.bidDueDate),
    line('Mandatory site visit', input.siteVisitDate),
    line('RFI cut-off', input.rfiDueDate),
    line('Scope', input.scope),
    line('Summary', input.summary),
  ].filter(Boolean)

  const sections = [`THE OPPORTUNITY\n${facts.join('\n')}`]

  if (input.questions.length > 0) {
    sections.push(
      `OPEN QUESTIONS (pick the most important, at most four)\n${input.questions
        .map((q) => `- ${q}`)
        .join('\n')}`
    )
  }
  if (input.requirements.length > 0) {
    sections.push(
      `STATED REQUIREMENTS (context only — do not confirm we meet any of these)\n${input.requirements
        .slice(0, 12)
        .map((r) => `- ${r}`)
        .join('\n')}`
    )
  }

  sections.push('Write the reply body now.')
  return sections.join('\n\n')
}
