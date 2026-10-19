import type { WaitingOnItem, RiskItem, DecisionItem } from '@/types/domain'
import { chipTone, type StatusTone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

/**
 * What the extraction found, rendered the same way wherever it was found.
 *
 * ⚠ ONE RENDERER, BECAUSE IT IS ONE SHAPE. `updates` and `opportunity_notes`
 * carry identical `waiting_on` / `risks` / `decisions` columns (the latter
 * gained them 2026-10-18), so a project update's card and an opportunity
 * note's card were about to be two copies of the same 60 lines — §12: a shared
 * renderer wired to one surface is worse than no shared renderer, so grep for
 * one before building one and for every surface that should call it after.
 *
 * Severity goes through `chipTone`, not a local colour map: there were five of
 * those, all spelling the same four levels with the theme-blind `slate` ramp.
 */

function safeArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

/** Severity → tone. An unknown value reads as `info` rather than rendering bare. */
const SEVERITY_TONE: Record<string, StatusTone> = {
  info: 'neutral',
  watch: 'caution',
  critical: 'critical',
  blocker: 'severe',
}

/** True when there is anything at all to show — so a caller can skip the border. */
export function hasExtractedItems(row: {
  waiting_on?: unknown
  risks?: unknown
  decisions?: unknown
}): boolean {
  return (
    safeArray(row.waiting_on).length > 0 ||
    safeArray(row.risks).length > 0 ||
    safeArray(row.decisions).length > 0
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="label-caps text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

export default function ExtractedItems({
  waitingOn: waitingOnRaw,
  risks: risksRaw,
  decisions: decisionsRaw,
}: {
  waitingOn?: unknown
  risks?: unknown
  decisions?: unknown
}) {
  const waitingOn = safeArray<WaitingOnItem>(waitingOnRaw)
  const risks = safeArray<RiskItem>(risksRaw)
  const decisions = safeArray<DecisionItem>(decisionsRaw)

  if (waitingOn.length === 0 && risks.length === 0 && decisions.length === 0) return null

  return (
    <div className="space-y-3">
      {waitingOn.length > 0 && (
        <Group label="Waiting On">
          {waitingOn.map((item, idx) => (
            <div key={idx} className="text-sm">
              <span>{item.text}</span>
              {item.party && <span className="ml-1 text-xs text-muted-foreground">[{item.party}]</span>}
            </div>
          ))}
        </Group>
      )}

      {risks.length > 0 && (
        <Group label="Risks">
          {risks.map((item, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <span
                className={cn(
                  'shrink-0 mt-0.5 inline-flex rounded px-1 py-0.5 text-xs font-semibold uppercase ring-1 ring-inset',
                  chipTone(SEVERITY_TONE[item.severity] ?? 'neutral'),
                )}
              >
                {item.severity}
              </span>
              <span>{item.text}</span>
            </div>
          ))}
        </Group>
      )}

      {decisions.length > 0 && (
        <Group label="Decisions">
          {decisions.map((item, idx) => (
            <div key={idx} className="text-sm">
              <span>{item.text}</span>
              {item.made_by && <span className="ml-1 text-xs text-muted-foreground">— {item.made_by}</span>}
            </div>
          ))}
        </Group>
      )}
    </div>
  )
}
