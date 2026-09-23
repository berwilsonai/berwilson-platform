/**
 * Commitment extraction — turning an email's loose ends into a dated ledger.
 *
 * The sweep's summary pass already produces `open_items`: short strings like
 * "Mike Ostermiller to sign NDA" or "Attend Friday 1:00 PM EST meeting". Good
 * material, and until now nothing read it. Three things are missing before it
 * can drive a reminder:
 *
 *   1. WHICH SIDE OWES IT. "We owe them pricing" and "they owe us a signed NDA"
 *      demand opposite actions — one is work, the other is a follow-up. A flat
 *      list cannot tell them apart, and that distinction is most of the value.
 *   2. A REAL DATE. "Friday" is only a date relative to when the mail was sent,
 *      so the thread's own date is supplied and the model resolves against it.
 *   3. WHETHER IT IS STILL OPEN. A commitment made three weeks ago may have
 *      been met in a later message in the same thread.
 *
 * The prompt is deliberately told to return NOTHING rather than to guess. A
 * ledger that invents deadlines is worse than an empty one: it produces
 * reminders about obligations nobody agreed to, and after two of those nobody
 * reads the reminders again.
 */

export const COMMITMENT_PROMPT_VERSION = 'commitments-1.0'

export interface ExtractedCommitment {
  /** The obligation, in the correspondence's own terms. One line. */
  what: string
  /** 'us' = Ber Wilson owes it. 'them' = the counterparty owes it. */
  side: 'us' | 'them'
  /** The named person who owes it, when the mail names one. */
  owner_name: string | null
  /** Resolved calendar date, YYYY-MM-DD. Null when no date was actually stated. */
  due_date: string | null
  /** False when a later message in the same thread already settled it. */
  still_open: boolean
  confidence: number
}

export interface CommitmentExtraction {
  commitments: ExtractedCommitment[]
}

export const COMMITMENT_SYSTEM_PROMPT = `You read one email conversation and extract the COMMITMENTS still outstanding in it.

A commitment is a specific obligation somebody took on or was asked for: send a document, sign something, return pricing, attend a meeting, make an introduction, answer a question, pay an invoice.

WHO IS "US": Ber Wilson. Anyone with a @berwilson.com address is us. Everyone else is them.

Return JSON in exactly this shape:
{
  "commitments": [
    {
      "what": "Return the countersigned MNDA",
      "side": "them",
      "owner_name": "Mike Ostermiller",
      "due_date": "2026-09-26",
      "still_open": true,
      "confidence": 0.9
    }
  ]
}

RULES — the refusals matter more than the extractions:

- "side" is who OWES the thing, never who asked for it. If they asked us for pricing, the side is "us".
- "due_date" is ONLY a date the correspondence actually states or clearly implies ("by Friday", "before the 15th", "end of month"). Resolve relative dates against the CONVERSATION DATE given to you. If no date was stated, return null. NEVER estimate a date because one would be useful — an invented deadline is the single worst thing you can produce here.
- "still_open" is false when a later message in this same conversation shows the thing was already done ("signed and returned", "sent this morning", "thanks, received"). Read the whole conversation before deciding.
- Skip anything vague. "Next steps are pending", "continue discussions", "follow up as needed" are NOT commitments — they name no deliverable and no owner. Return them as nothing at all.
- Skip routine automated chatter: calendar invitations, e-signature system notifications, read receipts, out-of-office replies.
- "what" is one short line, specific enough to act on without opening the email. No preamble.
- "owner_name" is a person's name when the mail names one, otherwise null. Never guess a name.
- "confidence" is 0-1: how sure you are this is a real, specific, still-outstanding obligation.
- If the conversation contains no genuine commitments, return {"commitments": []}. That is a correct and common answer — most email contains none.`
