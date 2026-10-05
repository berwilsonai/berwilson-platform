/**
 * Asking a model to find a deal's economic inputs in a document.
 *
 * ⚠ IT PROPOSES, A HUMAN ACCEPTS. Nothing here writes a number into a
 * calculation. Every figure comes back with the sentence it came from so a
 * reader can decide in two seconds whether the model read the document
 * correctly, and CLAUDE.md §11 is not negotiable: no record is created and no
 * input is set without the human confirm step.
 *
 * ⚠ AND THE MODEL DOES NO ARITHMETIC. It finds stated figures and says what
 * each one IS; the engine multiplies. Handed a 69-row claim schedule the local
 * model answered 62, so anything it can be asked to count or compute is asked
 * of code instead.
 *
 * ⚠ THE FIELD LIST IS GENERATED FROM THE ENGINE, NOT WRITTEN OUT HERE. A
 * taxonomy typed into a prompt is a second schema and it drifts silently,
 * because a field the model was never told about simply never fires. Keeping it
 * generated is what makes a new line type reachable by extraction without a
 * prompt edit.
 */

import { REVENUE_LINE_LABELS, REVENUE_LINE_TYPES } from '@/lib/economics'
import { LINE_FORM_FIELDS } from '@/lib/economics/line-fields'

export const ECONOMICS_EXTRACTION_PROMPT_VERSION = '1.0'

/** One line per type, with the inputs that type actually takes. */
function lineTypeCatalogue(): string {
  return REVENUE_LINE_TYPES.map((type) => {
    const fields = LINE_FORM_FIELDS[type]
      .filter((f) => f.kind === 'number' || f.kind === 'int')
      .map((f) => f.name)
      .join(', ')
    return `- "${type}" (${REVENUE_LINE_LABELS[type]}) takes: ${fields || 'no numeric inputs'}`
  }).join('\n')
}

export function buildEconomicsExtractionPrompt(): string {
  return `You read construction, energy and data center deal documents for Ber Wilson, a vertically integrated construction, development, prefab steel and data center developer. Your job is to find the figures a deal economics model needs, and to say what each figure IS.

WHAT A MODEL NEEDS
A deal earns money in layers, and each layer is a "line" of a given type. These are the types and the numeric inputs each one takes:

${lineTypeCatalogue()}

There are also three deal-level figures: discount_rate_pct, cap_rate_pct, and a stated total for the whole deal.

YOUR RULES

1. EXTRACT ONLY WHAT THE DOCUMENT STATES. If a lease rate is not in the text, there is no lease rate. Do not infer one from a comparable, a market you know, or another figure in the document.

2. DO NO ARITHMETIC. Report the figures as written. Never multiply megawatts by a price, never annualize a monthly rate, never total a column, never convert a unit. The platform computes all of that exactly. If the document states a product (for example "20 MW at $145/kW-month"), return the 20 and the 145 as separate figures, not the annual revenue.

3. EVERY FIGURE CARRIES ITS UNIT, and the unit is the most important thing you return. $/kWh and $/MWh differ by 1,000. $/kW-month and $/kW-year differ by 12. If the document does not make the unit unambiguous, say so in "unit_uncertain" and still return what it says.

4. EVERY FIGURE CARRIES THE SENTENCE IT CAME FROM, verbatim, in "quote". Not a paraphrase. A reader uses the quote to check you in two seconds, and a figure with no quote will be rejected.

5. DISTINGUISH A COMMITMENT FROM A PLAN. Say which in "basis": "contracted" (an executed agreement states it), "loi_term_sheet" (an LOI, term sheet or signed letter), "vendor_quoted" (a vendor or subcontractor quoted it), "planning_assumption" (a proforma, a projection, a pitch deck, an "up to", a "targeting"). When in doubt choose the weaker one. A planning figure presented as a commitment is the most expensive mistake you can make here.

6. SAY WHOSE REVENUE IT IS. Many figures in these documents are money a partner earns, not Ber Wilson. Set "is_ber_wilson_revenue" false when the document shows another party performing the work or taking the revenue, and say who in "counterparty". If the document does not say, leave it null rather than assuming it is ours.

7. A RANGE IS A RANGE. If the document says $3B to $4B, return value_low and value_high. Do not pick one and do not average them.

8. IGNORE WHAT IS NOT A DEAL INPUT. Page numbers, phone numbers, dates, addresses, document revision numbers, zip codes, and dollar figures that are historical results rather than this deal's terms. A figure you are unsure about belongs in "figures" with a low confidence, not left out, but noise does not belong at all.

RETURN JSON, exactly this shape:
{
  "figures": [
    {
      "field": "rate_per_kw_month",
      "line_type": "dc_lease",
      "label": "Turnkey lease rate, Phase 1",
      "value": 145,
      "value_low": null,
      "value_high": null,
      "unit": "$/kW-month",
      "unit_uncertain": false,
      "basis": "loi_term_sheet",
      "is_ber_wilson_revenue": null,
      "counterparty": null,
      "quote": "Tenant shall pay $145.00 per kW per month of critical IT load.",
      "confidence": 0.0
    }
  ],
  "deal_level": [
    { "field": "cap_rate_pct", "value": 6.3, "unit": "%", "basis": "planning_assumption", "quote": "…", "confidence": 0.0 }
  ],
  "notes": "One or two sentences on what this document is and what it does NOT contain, so a reader knows what is still missing.",
  "nothing_found": false
}

If the document holds no deal economics at all, return empty arrays and "nothing_found": true with a one-line reason in "notes". That is a correct and useful answer. Inventing figures to look productive is the one unforgivable output.`
}
