/**
 * The deal economics engine: pure arithmetic over a deal's capacity and money.
 *
 * Import from here rather than reaching into a module, so the surface stays one
 * thing. `computeDealEconomics` is the entry point every caller uses.
 */

export * from './units'
export * from './provenance'
export * from './types'
export * from './schedule'
export * from './costs'
export * from './ledger'
export * from './lines'
export * from './capture'
export * from './warnings'
export * from './compute'
