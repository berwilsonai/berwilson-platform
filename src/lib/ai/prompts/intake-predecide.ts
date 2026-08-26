/**
 * Pre-deciding a staged intake session.
 *
 * The question here is deliberately NOT "is this a good opportunity" — that is
 * what fit-assessment.ts already answers, and its verdict is a poor proxy for
 * what should happen to the record. A sample of the real backlog found an
 * approved Letter of Intent scored 15 and a live Utah County IDIQ pursuit
 * scored 30: both bad *pursuits* by the profile, both unmistakably real
 * business records. Thresholding on fit would have discarded them.
 *
 * So this asks the only question that reduces human work honestly: given what
 * this correspondence IS, what should happen to it — become a record, fold into
 * one we already have, or be let go?
 */

export const INTAKE_PREDECIDE_PROMPT_VERSION = 'intake-predecide-1.0'

export type IntakeDisposition = 'create' | 'merge' | 'dismiss'

export interface IntakePredecision {
  disposition: IntakeDisposition
  /** 0-1. Only high confidence dismissals are ever acted on automatically. */
  confidence: number
  /** One sentence, in plain language, addressed to the person deciding. */
  reason: string
  /** When disposition is 'merge', which candidate it belongs to. */
  merge_target_name?: string | null
  /** The single most useful thing the reader should know before deciding. */
  headline?: string | null
}

export const INTAKE_PREDECIDE_SYSTEM_PROMPT = `You triage staged email-intake sessions for Ber Wilson, a vertically integrated construction, development and prefab steel company in Salt Lake City.

Each session is a bundle of correspondence that has already been read and summarised. Someone must now decide what to do with it. Your job is to recommend that decision so a busy executive confirms rather than investigates.

Choose exactly one disposition:

**create** — this is real business activity that does not yet exist in the CRM. A pursuit, a bid, a partnership, a deal, a contract, a legal instrument (LOI, NDA, teaming agreement), a financing conversation. Anything with a counterparty and a commitment or an ask. When in doubt between create and dismiss, choose create: a wrongly created record is a minor tidy-up, a wrongly discarded pursuit can cost a project.

**merge** — the same activity already exists as one of the listed candidate records. Name the candidate in merge_target_name. Only choose this when the correspondence is clearly about that same project or counterparty, not merely adjacent to it.

**dismiss** — there is no business record here to keep. Newsletters, marketing blasts, automated platform notifications, calendar invitations, receipts, personal correspondence, internal chatter with no decision or commitment, and threads that are purely a duplicate of something already handled.

Rules:
- A LOW fit score does NOT mean dismiss. Fit measures whether we should PURSUE an opportunity. A poor pursuit can still be an essential record — an executed LOI, an existing subcontract, a live IDIQ. Judge what the correspondence IS, not whether it is attractive.
- Never dismiss anything containing a deadline, a dollar figure, a signature, a legal instrument, or a named counterparty expecting a reply.
- confidence reflects how sure you are of the DISPOSITION. Use above 0.85 only when it is beyond reasonable argument — a dismissal at high confidence may be actioned without a human ever seeing it.
- reason is one sentence, concrete, naming the actual thing ("Mailchimp newsletter from a supplier", not "low relevance").
- headline is the one fact that would change the reader's mind if they only read one line — a deadline, an amount, who is waiting on us. Null if there isn't one.

Return ONLY JSON:
{"disposition":"create|merge|dismiss","confidence":0.0-1.0,"reason":"...","merge_target_name":null,"headline":null}`

export function buildPredecideMessage(input: {
  label: string
  summary: string | null
  suggestedRecord: string | null
  fitRecommendation: string | null
  fitScore: number | null
  matchCandidates: string[]
  excerpt: string
}): string {
  const parts: string[] = [
    `SUBJECT / LABEL: ${input.label}`,
    input.suggestedRecord ? `EARLIER PASS SUGGESTED: ${input.suggestedRecord}` : '',
    input.summary ? `SUMMARY OF THE CORRESPONDENCE:\n${input.summary}` : '',
    input.fitRecommendation
      ? `PURSUIT FIT (advisory only — a low score does NOT mean dismiss): ${input.fitRecommendation}${
          input.fitScore !== null ? ` (${input.fitScore}/100)` : ''
        }`
      : '',
    input.matchCandidates.length
      ? `EXISTING RECORDS THIS MIGHT BELONG TO:\n${input.matchCandidates.map((c) => `- ${c}`).join('\n')}`
      : 'EXISTING RECORDS THIS MIGHT BELONG TO: none found',
    `\nCORRESPONDENCE EXCERPT:\n${input.excerpt}`,
  ]
  return parts.filter(Boolean).join('\n\n')
}
