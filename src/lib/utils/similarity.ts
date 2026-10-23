/**
 * Token-set similarity — the one home.
 *
 * ⚠ THIS EXISTED TWICE BEFORE IT EXISTED ONCE. `jaccard` was written in
 * `src/lib/email-sweep/cluster-phase.ts` for grouping deal names, then written
 * again, byte-identical, inside `src/components/commitments/CommitmentsLedger.tsx`
 * — because that is a client component and cannot import the sweep phase, which
 * drags `@/lib/integrations/google-workspace` into the bundle behind it. Neither
 * copy looked like a copy (§12: the hardest fork to see is two sibling modules
 * written days apart). This module has NO imports for exactly that reason: it is
 * pure set arithmetic with no opinion about any corpus, so a client component, a
 * cron and an agent tool can all reach it.
 *
 * What does NOT belong here is a tokenizer tuned to one corpus or a threshold.
 * `cluster-phase.tokenize` drops deal-name noise ('project', 'proposal', 'bid')
 * and is right only for deal names; every bar has to be measured against the
 * corpus it judges (§12), so it is declared next to the thing it judges.
 */

/**
 * Jaccard similarity over two token sets — shared / union, 0..1.
 *
 * ⚠ DELIBERATELY NOT THE OVERLAP COEFFICIENT (`shared / min`), which scores a
 * short phrase a perfect 1.0 against every longer phrase that contains it. That
 * is right for dedupe WITHIN one thread and wrong across them (§12).
 */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

/**
 * Words of a free-text phrase, for comparing one sentence of prose to another.
 *
 * No stopword list: these are phrases a human or a model wrote as prose, not
 * names drawn from a register, and the generic words carry as much signal as
 * anything else once both sides are compared the same way. Single characters go
 * because they are punctuation fallout, not words.
 */
export function phraseTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length > 1)
  )
}
