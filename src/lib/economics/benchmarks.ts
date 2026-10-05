/**
 * The market benchmark library: rows, not constants.
 *
 * ⚠ NOT HARDCODED IN TYPESCRIPT, AND `STEEL_PRICE_FLOOR_PER_SQFT = 30` IS WHY.
 * A market figure baked into source needs a code change, a build and a deploy
 * every time the market moves, and it carries no source and no date, so nobody
 * can tell a current figure from a two-year-old one. Benchmarks grow with the
 * market rather than with the code, which by the rule in CLAUDE.md §12 makes
 * them a TABLE.
 *
 * ⚠ READ THROUGH A SHORT TTL, NOT A PERMANENT CACHE. `next start` loads the
 * build at boot and holds it for days, so a permanently cached library would
 * mean an edit in settings did not take effect until the next deploy.
 *
 * ⚠ AND IT THROWS RATHER THAN DEGRADING. A 42703 from a renamed column comes
 * back on `error` with `data` null, and silently returning an empty library
 * would leave every input reading as unsourced while reporting nothing. An
 * empty result is NOT an error here, though: an unseeded library is a real and
 * expected state, unlike an unseeded lead taxonomy.
 *
 * Server-only: holds the service-role client. Never import from a 'use client'
 * file. Pure label and tone helpers live in src/lib/economics/provenance.ts.
 */

import { calcDb, num, type BenchmarkRow } from './db'

export interface Benchmark {
  id: string
  key: string
  label: string
  valueLow: number | null
  valueHigh: number | null
  unit: string
  geography: string | null
  source: string | null
  asOf: string | null
  notes: string | null
  tone: string
  needsReview: boolean
  active: boolean
  sortOrder: number
}

const TTL_MS = 60_000
let cache: { at: number; rows: Benchmark[] } | null = null

export function invalidateBenchmarkCache(): void {
  cache = null
}

function toBenchmark(row: BenchmarkRow): Benchmark {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    valueLow: num(row.value_low),
    valueHigh: num(row.value_high),
    unit: row.unit,
    geography: row.geography,
    source: row.source,
    asOf: row.as_of,
    notes: row.notes,
    tone: row.tone,
    needsReview: row.needs_review,
    active: row.active,
    sortOrder: row.sort_order,
  }
}

export async function listBenchmarks(): Promise<Benchmark[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows

  const { data, error } = await calcDb()
    .from('economics_benchmarks')
    .select('*')
    .order('sort_order')
    .order('label')
  if (error) {
    throw new Error(`Could not read the benchmark library: ${error.message}`)
  }

  const rows = ((data ?? []) as BenchmarkRow[]).map(toBenchmark)
  cache = { at: Date.now(), rows }
  return rows
}

export async function listActiveBenchmarks(): Promise<Benchmark[]> {
  return (await listBenchmarks()).filter((b) => b.active)
}

export async function getBenchmark(key: string): Promise<Benchmark | null> {
  return (await listBenchmarks()).find((b) => b.key === key) ?? null
}

/**
 * The figure to use from a benchmark, and whether it is a point or a band.
 *
 * ⚠ THE MIDPOINT OF A BAND IS A DERIVED NUMBER AND IS LABELLED AS ONE. A range
 * is the honest form for most market data, and quietly collapsing $3B to $4B
 * into "$3.5B" loses the fact that nobody knows which end of it applies. The
 * caller gets both ends and the midpoint, and the UI says which it filled.
 */
export interface BenchmarkFigure {
  value: number | null
  isMidpointOfBand: boolean
  display: string
}

export function benchmarkFigure(benchmark: Benchmark): BenchmarkFigure {
  const { valueLow: low, valueHigh: high, unit } = benchmark
  if (low != null && high != null && low !== high) {
    return {
      value: (low + high) / 2,
      isMidpointOfBand: true,
      display: `${low.toLocaleString('en-US')} to ${high.toLocaleString('en-US')} ${unit}`,
    }
  }
  const value = low ?? high
  return {
    value,
    isMidpointOfBand: false,
    display: value == null ? `no figure yet (${unit})` : `${value.toLocaleString('en-US')} ${unit}`,
  }
}

/**
 * How stale a benchmark is in days, or null when undated.
 *
 * An undated benchmark is not treated as fresh OR as old; the warning layer
 * says "undated" instead of inventing a clock it does not have.
 */
export function benchmarkAgeDays(benchmark: Benchmark, now: Date = new Date()): number | null {
  if (!benchmark.asOf) return null
  const asOf = Date.parse(`${benchmark.asOf}T00:00:00Z`)
  if (!Number.isFinite(asOf)) return null
  return Math.floor((now.getTime() - asOf) / 86_400_000)
}

/** The tones a benchmark row may carry, declared literally so Tailwind sees them. */
export const BENCHMARK_TONES = ['slate', 'sky', 'violet', 'amber', 'emerald'] as const

export function isBenchmarkTone(value: unknown): boolean {
  return typeof value === 'string' && (BENCHMARK_TONES as readonly string[]).includes(value)
}
