/**
 * Whether a prompt's answer is safe to produce WITHOUT the model's reasoning
 * pass.
 *
 * ## Why this is a decision at all
 *
 * `qwen/qwen3.6-35b-a3b` reasons before it answers, and LM Studio returns that
 * reasoning in a separate `reasoning_content` field which this platform has
 * always discarded. Measured over the 30 days to 2026-10-26 (3,982 logged
 * calls), it is **87-98% of every generation** on the mechanical passes:
 *
 * | prompt | n | completion tokens | answer | discarded |
 * |---|---|---|---|---|
 * | thread-summary-1.0 | 954 | 2,486 | ~274 | 89% |
 * | doc-summary-1.0 | 612 | 2,002 | ~155 | 92% |
 * | commitments-1.0 | 366 | 3,117 | ~96 | 97% |
 * | drive-filing-1.1 | 95 | 1,378 | ~43 | 97% |
 * | commitment-chase-1.0 | 94 | 2,803 | ~43 | 98% |
 *
 * 55.3 GPU-hours in 30 days, 28.3 of them on those passes. LM Studio serves
 * ONE request at a time (§2), so that is not an abstract cost — it is the queue
 * a human waiting on Ber AI sits behind.
 *
 * ## Why it is not simply turned off everywhere
 *
 * Reasoning buys real accuracy on a judgement. Spot-measured the same day, a
 * hard classification came back WRONG with reasoning off and right with it on.
 * So this is per-prompt, and the answer comes from
 * `scripts/measure-reasoning-off.mts` replaying the real logged corpus —
 * scored, where a human later ruled on the output, against THE HUMAN's verdict
 * rather than against the old model answer (§12: a producer's gate is measured
 * by the human's dismissal rate, never by its own confidence).
 *
 * ## Why the declaration lives beside the prompt
 *
 * "Is this answer safe without thinking?" is a property of the PROMPT, not of a
 * call. A prompt usually has one call site today and two next year, and a
 * per-call answer would drift between them. So each prompt module exports its
 * own choice next to its version constant, where the two cannot be read apart.
 *
 * ⚠ `'think'` is spelled out rather than left as `undefined` on purpose: a task
 * that has never been measured and a task measured as needing reasoning must
 * not look the same, and an explicit value is greppable where an omission is
 * not. `grep -rn "PromptReasoning" src/lib` is the coverage list.
 */
export type PromptReasoning =
  /**
   * Keep the reasoning pass. The default for anything unmeasured, and the
   * permanent answer for judgement and prose: fit assessment, lead triage, the
   * agent loop, `/jobs`, document composition.
   */
  | 'think'
  /**
   * Skip it — cleared by replay against the decided corpus. Record the date and
   * what was measured at the declaration site, because the next person to read
   * it will want to know whether the evidence predates a prompt rewrite.
   */
  | 'none'

/**
 * Translate a prompt's declaration into the wire parameter.
 *
 * `'think'` becomes `undefined`, which omits `reasoning_effort` from the request
 * entirely and leaves it byte-for-byte what this codebase sent before the option
 * existed. The mapping is one-way on purpose: there is no way to spell "think"
 * as an explicit wire value here, so an unmeasured prompt cannot accidentally
 * pin a server default that later changes.
 */
export function wireReasoning(choice: PromptReasoning): 'none' | undefined {
  return choice === 'none' ? 'none' : undefined
}
