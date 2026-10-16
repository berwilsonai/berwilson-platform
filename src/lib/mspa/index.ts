/**
 * The TensorIQ MSPA calculation layer.
 *
 * Import from here rather than reaching into a module, so the surface stays one
 * thing. `assessOpportunity` is the entry point every caller uses.
 *
 * ⚠ TWO HALVES AT TWO CONFIDENCES, AND THEY MUST NEVER BE BLENDED.
 * `fees.ts` and `protection.ts` compute what Ber Wilson is contractually OWED,
 * exactly, from the signed agreement. `sizing.ts` and `returns.ts` estimate
 * what a deal might cost and earn, as scenarios, from TensorIQ's own model.
 * Anything presenting the second at the confidence of the first is wrong.
 */

export * from './capacity'
export * from './fees'
export * from './protection'
export * from './sizing'
export * from './returns'
export * from './flags'
export * from './pipeline-data'
export * from './assess'
export * from './register'
export * from './params'
