/**
 * Constants + math for the Dino module — the revenue ledger split by SOURCE
 * (internal = Ber Wilson work vs external = Dino's existing clients) and the
 * payment-obligation schedule. Source type is plain text in the DB (no Postgres
 * enum), so this file is the source of truth for allowed values + rollup math.
 *
 * All date handling is on 'YYYY-MM-DD' strings (revenue_date / due_date are
 * date-only) to sidestep the UTC-midnight bug class — never `new Date('YYYY-MM-DD')`.
 */

// ─── Revenue source ──────────────────────────────────────────────────────────

export type DinoSource = 'internal' | 'external'

export const DINO_SOURCES: DinoSource[] = ['internal', 'external']

export const DINO_SOURCE_LABELS: Record<DinoSource, string> = {
  internal: 'Ber Wilson',
  external: 'External client',
}

export const DINO_SOURCE_BADGE: Record<DinoSource, string> = {
  internal: 'bg-primary/10 text-primary ring-primary/20 dark:bg-primary/15 dark:text-primary dark:ring-primary/30',
  external: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:ring-slate-400/25',
}

export function dinoSource(value: string | null | undefined): DinoSource {
  return value === 'external' ? 'external' : 'internal'
}

// ─── Minimal shapes the math operates on ─────────────────────────────────────

export interface RevenueEntry {
  source_type: string
  amount: number | null
  revenue_date: string
}

export interface PaymentEntry {
  amount: number | null
  due_date: string | null
  paid: boolean
}

// ─── Date-range selection for the rollup ─────────────────────────────────────

export type RevenueRange = 'ttm' | 'ytd' | 'all'

export const REVENUE_RANGES: { value: RevenueRange; label: string }[] = [
  { value: 'ttm', label: 'Trailing 12 mo' },
  { value: 'ytd', label: 'This year' },
  { value: 'all', label: 'All time' },
]

export function revenueRange(value: string | null | undefined): RevenueRange {
  return value === 'ytd' || value === 'all' ? value : 'ttm'
}

/** Inclusive lower-bound date ('YYYY-MM-DD') for a range, or null for all-time. */
export function rangeStart(range: RevenueRange, today = new Date()): string | null {
  if (range === 'all') return null
  if (range === 'ytd') return `${today.getFullYear()}-01-01`
  // ttm — 12 months back from today, same day
  const d = new Date(today.getFullYear(), today.getMonth() - 12, today.getDate())
  return isoDate(d)
}

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// ─── Revenue rollup — the internal-vs-external split (the persuasion metric) ──

export interface RevenueRollup {
  total: number
  internal: number
  external: number
  /** Ber Wilson share of revenue, 0-100 (0 when there's no revenue). */
  internalPct: number
}

export function revenueRollup(entries: RevenueEntry[], range: RevenueRange = 'all', today = new Date()): RevenueRollup {
  const start = rangeStart(range, today)
  let internal = 0
  let external = 0
  for (const e of entries) {
    if (start && e.revenue_date < start) continue
    const amt = e.amount ?? 0
    if (dinoSource(e.source_type) === 'internal') internal += amt
    else external += amt
  }
  const total = internal + external
  return { total, internal, external, internalPct: total > 0 ? Math.round((internal / total) * 100) : 0 }
}

// ─── Trend: internal vs external by period ───────────────────────────────────

export type Granularity = 'month' | 'quarter'

export interface PeriodBucket {
  key: string
  label: string
  internal: number
  external: number
  total: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Period key for a date string — 'YYYY-MM' (month) or 'YYYY-Qn' (quarter). */
function periodKey(dateStr: string, g: Granularity): string {
  const year = dateStr.slice(0, 4)
  const month = parseInt(dateStr.slice(5, 7), 10) // 1-12
  if (g === 'month') return `${year}-${String(month).padStart(2, '0')}`
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
}

function periodLabel(key: string, g: Granularity): string {
  if (g === 'month') {
    const m = parseInt(key.slice(5, 7), 10)
    return MONTHS[m - 1] ?? key
  }
  const yy = key.slice(2, 4)
  const q = key.slice(5) // "Q1" (the 'Q' + digit after 'YYYY-')
  return `${q} '${yy}`
}

/**
 * The last `count` periods up to today, each with internal/external sums (zero
 * when empty), oldest → newest — a stable trend bar regardless of gaps.
 */
export function splitByPeriod(
  entries: RevenueEntry[],
  g: Granularity,
  count: number,
  today = new Date()
): PeriodBucket[] {
  // Build the ordered set of period keys ending at the current period.
  const keys: string[] = []
  const y = today.getFullYear()
  const m = today.getMonth() // 0-11
  if (g === 'month') {
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(y, m - i, 1)
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
  } else {
    const currentQ = Math.floor(m / 3) // 0-3
    for (let i = count - 1; i >= 0; i--) {
      const qAbs = y * 4 + currentQ - i
      const yr = Math.floor(qAbs / 4)
      const q = (qAbs % 4) + 1
      keys.push(`${yr}-Q${q}`)
    }
  }

  const buckets = new Map<string, PeriodBucket>()
  for (const key of keys) {
    buckets.set(key, { key, label: periodLabel(key, g), internal: 0, external: 0, total: 0 })
  }
  for (const e of entries) {
    const key = periodKey(e.revenue_date, g)
    const bucket = buckets.get(key)
    if (!bucket) continue
    const amt = e.amount ?? 0
    if (dinoSource(e.source_type) === 'internal') bucket.internal += amt
    else bucket.external += amt
    bucket.total += amt
  }
  return keys.map((k) => buckets.get(k)!)
}

/** Sensible granularity + window for a selected range. */
export function trendSettings(range: RevenueRange): { granularity: Granularity; count: number } {
  if (range === 'all') return { granularity: 'quarter', count: 8 }
  return { granularity: 'month', count: 12 }
}

// ─── Payment obligation helpers ──────────────────────────────────────────────

export function totalOwed(payments: PaymentEntry[]): number {
  return payments.filter((p) => !p.paid).reduce((sum, p) => sum + (p.amount ?? 0), 0)
}

export function totalPaid(payments: PaymentEntry[]): number {
  return payments.filter((p) => p.paid).reduce((sum, p) => sum + (p.amount ?? 0), 0)
}

export function paymentsTotal(payments: PaymentEntry[]): number {
  return payments.reduce((sum, p) => sum + (p.amount ?? 0), 0)
}

/** Whole days from today until `dateStr` (negative = past). Null → null. */
export function daysUntil(dateStr: string | null, today = new Date()): number | null {
  if (!dateStr) return null
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const target = new Date(`${dateStr}T00:00:00`).getTime()
  return Math.round((target - t) / 86_400_000)
}

/** An unpaid installment whose due date is in the past. */
export function isPaymentOverdue(p: PaymentEntry, today = new Date()): boolean {
  if (p.paid || !p.due_date) return false
  const d = daysUntil(p.due_date, today)
  return d !== null && d < 0
}
