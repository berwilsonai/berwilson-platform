import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { StatTile, StatGrid } from '@/components/ui/stat'
import { formatValue } from '@/lib/utils/constants'
import type { Delta } from '@/lib/records/snapshot'

interface HealthPanelProps {
  activeProjects: number
  pipelineValue: number
  weightedPipelineValue: number
  /** The Decide queue. Stated separately, NEVER added to the total. */
  pendingReview: number
  /** Overdue milestones. */
  overdueCount: number
  /** Overdue open tasks. */
  overdueTaskCount: number
  criticalDdCount: number
  expiringCertsCount: number
  /**
   * What the pipeline total is made of, when it is made of more than one kind
   * of figure. Null when every contributing project is modelled, or every one
   * is a hand-entered estimate.
   *
   * ⚠ A TOTAL THAT COVERS PART OF THE PORTFOLIO MUST SAY WHICH PART. "$1.2B"
   * over 30 deals means something else when 29 of them are blank.
   */
  pipelineNote?: string | null
  /** Active projects nobody has priced, so the tile's denominator is honest. */
  unpricedCount?: number
  /** Programs held out of the total because their sub-projects carry it. */
  rolledUpCount?: number
  /**
   * Movement against the last weekly snapshot, per figure.
   *
   * ⚠ EVERY ONE IS OPTIONAL AND NULL MEANS "SAY NOTHING". `portfolio_snapshots`
   * starts empty, so for the first weeks after this ships there is no prior to
   * compare against and the tiles render exactly as they did before. That is
   * the correct behaviour and must not be papered over with a 0% (§12).
   */
  deltas?: {
    pipelineValue?: Delta | null
    weightedPipelineValue?: Delta | null
    activeProjects?: Delta | null
  }
}

/**
 * Executive KPI band: the state of the portfolio in four calm numbers.
 * Real figures only — no synthetic score. Detail and navigation live in the
 * Needs Attention rail below.
 *
 * ⚠ THE FOUR PASTEL ICON CHIPS ARE GONE (2026-10-27). Each tile carried a 36px
 * rounded square in its own hue — primary, violet, emerald, amber — and between
 * them they put four decorative colours across the top of the morning read.
 * §12: when every row is red, red has stopped signifying; four tiles in four
 * colours is the same failure wearing pastel, and it meant the ONE tile that
 * was genuinely warning could not be picked out from the three that were fine.
 * The tiles are plain now, and `tone` colours the FIGURE only when the figure
 * itself is the problem — so colour in this band means exactly one thing.
 */
export default function HealthPanel({
  activeProjects,
  pipelineValue,
  weightedPipelineValue,
  pendingReview,
  overdueCount,
  overdueTaskCount,
  criticalDdCount,
  expiringCertsCount,
  pipelineNote,
  unpricedCount,
  rolledUpCount,
  deltas,
}: HealthPanelProps) {
  /*
    TWO QUANTITIES, NEVER ONE NUMBER.

    "Needs attention" is work falling through the cracks — an overdue task, a
    critical diligence item, a certification about to lapse. The Decide queue
    is a backlog of inbound things waiting on a call, and it is an order of
    magnitude larger (197 against 1 when this was written). Summing them made
    the tile read 197 while the sidebar's own Dashboard badge read 1, so the
    two numbers on one screen contradicted each other and neither could be
    trusted. The queue now gets its own line and its own link.
  */
  // The same four things countAttention() counts for the sidebar badge.
  const totalAlerts = criticalDdCount + overdueCount + overdueTaskCount + expiringCertsCount

  /*
    ⚠ `overdue` WAS `text-orange-600 dark:text-orange-400`, THE ONE PLACE A
    CategoryTone WAS DOING A STATUS JOB. tone.ts declares orange as a category
    — "this kind differs from that kind" — so it carries no token, no measured
    contrast and no theme guarantee, and it was being asked here to mean
    "late". Late is caution. Critical is critical. Two meanings, two measured
    tones, and no third colour in between that means neither.
  */
  const breakdown = [
    { count: criticalDdCount, label: 'critical', plural: 'critical', className: 'text-critical' },
    { count: overdueCount, label: 'overdue milestone', plural: 'overdue milestones', className: 'text-caution' },
    { count: overdueTaskCount, label: 'overdue task', plural: 'overdue tasks', className: 'text-caution' },
    { count: expiringCertsCount, label: 'cert expiry', plural: 'cert expiries', className: 'text-caution' },
  ].filter((b) => b.count > 0)

  // A KPI tile with no value is not a KPI tile. Weighted pipeline is unset
  // until someone puts a win probability on a project; until then it is an
  // instruction, and an instruction does not belong beside real money.
  const showWeighted = weightedPipelineValue > 0

  return (
    <StatGrid className={showWeighted ? undefined : 'lg:grid-cols-3'}>
      <StatTile
        label="Pipeline Value"
        value={pipelineValue > 0 ? formatValue(pipelineValue) : null}
        empty="No active project carries a value yet"
        delta={deltas?.pipelineValue}
        hint={pipelineNote ? `Across active projects · ${pipelineNote}` : 'Across active projects'}
        footer={
          <span className="block space-y-0.5 text-muted-foreground">
            {unpricedCount && unpricedCount > 0 ? (
              <span className="block">
                {unpricedCount} active {unpricedCount === 1 ? 'project has' : 'projects have'} no value yet
              </span>
            ) : null}
            {/* A total over 50 deals that silently covers 44 is the kind of
                unexplained figure this tile exists to stop. */}
            {rolledUpCount && rolledUpCount > 0 ? (
              <span className="block">
                {rolledUpCount} {rolledUpCount === 1 ? 'program counts' : 'programs count'} through its
                sub-projects, not twice
              </span>
            ) : null}
          </span>
        }
      />

      {showWeighted && (
        <StatTile
          label="Weighted Pipeline"
          value={formatValue(weightedPipelineValue)}
          delta={deltas?.weightedPipelineValue}
          hint="Adjusted for win probability"
        />
      )}

      <StatTile
        label="Active Projects"
        value={activeProjects}
        delta={deltas?.activeProjects}
        href="/projects"
        hint="View pipeline"
      />

      <StatTile
        label="Needs Attention"
        value={totalAlerts}
        tone={totalAlerts > 0 ? 'caution' : 'default'}
        hint={
          totalAlerts === 0 ? (
            <span className="inline-flex items-center gap-1 font-medium text-positive">
              <CheckCircle2 size={12} /> All clear
            </span>
          ) : (
            <span>
              {breakdown.map((b, i) => (
                <span key={b.label}>
                  {i > 0 ? ' · ' : null}
                  <span className={`tnum font-medium ${b.className}`}>{b.count}</span>{' '}
                  {b.count === 1 ? b.label : b.plural}
                </span>
              ))}
            </span>
          )
        }
        footer={
          /* The Decide backlog, stated as itself and linked to its own page —
             never added into the number above. */
          pendingReview > 0 ? (
            <Link href="/decide" className="text-muted-foreground transition-colors hover:text-foreground">
              <span className="tnum font-medium text-caution">{pendingReview}</span> waiting to decide →
            </Link>
          ) : null
        }
      />
    </StatGrid>
  )
}
