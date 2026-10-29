/**
 * Re-asking, against the WHOLE register, which record a staged session belongs
 * to.
 *
 * ⚠ WHY A SECOND PASS EXISTS AT ALL, when `intake-predecide` already answers
 * create/merge/dismiss. The pre-decide model is shown `candidateNames(
 * match_candidates)` — the output of the trigram-and-name-ladder matcher, frozen
 * at the moment the session was STAGED. Two things go wrong with that and both
 * were live on 2026-10-28:
 *
 *   1. The candidate list is stale. A record created last week cannot appear in
 *      a list computed last month, so the model is asked to merge into a set
 *      that does not contain the right answer and correctly says `create`.
 *   2. The candidate list is weak. A session labelled `GridEdgeDC` carried
 *      `Heber Development` and `Myton Development` at 0.38 trigram, against an
 *      opportunity named — exactly — **GridEdge**. The name ladder needs the
 *      whole name or one rare shared token, and `gridedgedc` is one token that
 *      is neither; trigram over `projects` cannot see an opportunity at all.
 *
 * So this pass does the one thing neither mechanism can: it shows the model all
 * 33 record names at once. That is a list small enough to read, which is the
 * only reason this is honest — it is recognition over a closed set, not search.
 *
 * ⚠ IT PRODUCES A RECOMMENDATION, NEVER A FILING. The answer becomes the button
 * on /decide that a human presses. §12 is explicit that a model's title names a
 * topic while a human's names a record and only the second may file — that rule
 * governs AUTOMATIC filing, and nothing here is automatic. §11 is untouched:
 * no record is created, nothing is merged, only the recommendation changes.
 *
 * ⚠ AND THE ANSWER IS VALIDATED AGAINST THE REGISTER, WHOLE AND CASE-FOLDED. A
 * name the model invents must not resolve — that is the one failure mode of
 * handing a model a list and reading its reply as an id.
 */

import type { PromptReasoning } from '@/lib/ai/reasoning'

export const DECIDE_RESCRUB_PROMPT_VERSION = 'decide-rescrub-1.0'

/**
 * No reasoning pass, matching `intake-predecide`.
 *
 * This is a strictly EASIER question than the one measured there at 8/8
 * agreement — recognition against a visible list, with no disposition to weigh
 * — and the cost of being wrong is lower still, because the answer is a button
 * a person reads the name on before pressing.
 */
export const DECIDE_RESCRUB_REASONING: PromptReasoning = 'none'

export interface DecideRescrubAnswer {
  /**
   * The record's name, copied EXACTLY from the list, or null for none of them.
   *
   * ⚠ WITHOUT THE TYPE TAG THE LIST SHOWS BESIDE IT. The first live run proved
   * why this has to be said twice: shown `GridEdge (opportunity)` the model
   * answered `"GridEdge (opportunity)"` at 0.95 confidence, which the resolver
   * then correctly refused as a name no record answers to — a right match lost
   * to the prompt's own decoration. The tag now LEADS the line in brackets, so
   * what follows it is unambiguously the name, and `resolveRescrubAnswer`
   * strips either form before giving up (see its own note).
   */
  record: string | null
  /** 0-1. How sure, used only to order and to label the row. */
  confidence: number
  /** One sentence naming the evidence, addressed to the person deciding. */
  reason: string
}

export const DECIDE_RESCRUB_SYSTEM_PROMPT = `You match staged correspondence to the existing records of Ber Wilson, a vertically integrated construction, development and prefab steel company in Salt Lake City.

You are given one bundle of correspondence that has already been read and summarised, and the COMPLETE list of every project and opportunity the company currently has. Your only question is: does this correspondence belong to one of those records?

How to decide:
- The record must be the SAME activity, not an adjacent one. The same site, the same counterparty's deal, the same transaction. A conversation that merely mentions a deal in passing does not belong to it.
- Names are written by different people at different times and rarely match exactly. "GridEdgeDC" is the record "GridEdge". "Steelton Site" is "Steelton — Cleveland-Cliffs (PA)". "Fairbanks antimony" may be an Alaska record. Read the summary, not only the label.
- A SHARED INDUSTRY WORD IS NOT A MATCH. "Development", "Site", "Campus", "Power", "Rail", "Data Center", "JV", "Mine", a state or a city name: none of these identify a record on their own. Two records can share all of them.
- If two records could both be it, answer null. An ambiguous match is worse than none — the person will choose in a second, and a conversation filed on the wrong deal answers for it until somebody notices.
- If the correspondence is about work the company does not have a record for yet, answer null. Creating the record is a different decision and somebody else's to make.

Rules:
- Each line of the list is written "[type] Name". "record" is the NAME ONLY — everything after the closing bracket, copied CHARACTER FOR CHARACTER. Do not include the [type]. Do not abbreviate, tidy, translate or invent a name; several records have punctuation, em dashes and parentheses in them and all of it is part of the name.
- confidence is how sure you are that it is THAT record. Use above 0.8 only when the correspondence names the same site, counterparty or transaction unmistakably.
- reason is one concrete sentence naming what made the match — the site, the counterparty, the instrument. Not "high similarity".

Return ONLY JSON:
{"record":"exact name from the list, or null","confidence":0.0-1.0,"reason":"..."}`

export function buildRescrubMessage(input: {
  label: string
  summary: string | null
  suggestedRecord: string | null
  /** Every project and opportunity, as "[project] Name" / "[opportunity] Name". */
  register: string[]
  excerpt: string
}): string {
  return [
    `SUBJECT / LABEL: ${input.label}`,
    input.suggestedRecord ? `THE CORRESPONDENCE CALLS THE DEAL: ${input.suggestedRecord}` : '',
    input.summary ? `SUMMARY:\n${input.summary}` : '',
    `EVERY RECORD BER WILSON HAS — answer with the NAME only, never the [type]:\n${input.register
      .map((r) => `- ${r}`)
      .join('\n')}`,
    `\nCORRESPONDENCE EXCERPT:\n${input.excerpt}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
