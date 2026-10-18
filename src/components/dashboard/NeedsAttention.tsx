import Link from 'next/link'
import { AlertTriangle, CalendarClock, ClipboardCheck, ListChecks, TrendingUp, HandCoins, MailWarning, BadgeAlert, Wrench, Radar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTOR_BADGE, SECTOR_SHORT } from '@/lib/utils/sectors'
import { SEVERITY_BADGE, SEVERITY_LABELS } from '@/lib/utils/constants'
import type { DdSeverity } from '@/lib/supabase/types'
import { reviewReasonLabel } from '@/lib/utils/review'
import { Chip } from '@/components/ui/chip'
import type { TaskSummary } from '@/lib/tasks/queries'

type ReviewWithProject = {
  id: string
  reason: string
  source_table: string
  confidence: number | null
  created_at: string | null
  project_id: string | null
  project: { id: string; name: string; sector: string } | null
}

type MilestoneWithProject = {
  id: string
  label: string
  target_date: string | null
  stage: string
  project_id: string
  project: { id: string; name: string } | null
}

type DdWithProject = {
  id: string
  item: string
  severity: DdSeverity
  category: string
  project_id: string
  project: { id: string; name: string } | null
}

function daysOverdue(targetDate: string): number {
  return Math.floor((Date.now() - new Date(targetDate).getTime()) / 86_400_000)
}

export type InvestorFollowUp = {
  id: string
  name: string
  stage: string
  next_step: string | null
  next_step_date: string | null
}

export type ExpiringCert = {
  id: string
  name: string
  expiration_date: string | null
  issuing_body: string | null
}

export type LeadDue = {
  id: string
  title: string
  sender_company: string | null
  bid_due_date: string | null
  fit_recommendation: string | null
}

export type DinoPaymentDue = {
  id: string
  label: string | null
  amount: number
  due_date: string | null
}

interface NeedsAttentionProps {
  /**
   * ⚠ THESE THREE ARRIVE ALREADY SLICED TO 6 (dashboard/page.tsx), so their
   * `.length` is a display cap and NOT a count. Every number shown about them
   * must come from the `*Count` props beside them. The other lists below
   * arrive whole and are sliced at render, so for those `.length` is the truth.
   */
  reviewItems: ReviewWithProject[]
  overdueItems: MilestoneWithProject[]
  ddItems: DdWithProject[]
  /** True totals for the three sliced lists above. */
  overdueCount: number
  ddCount: number
  reviewCount: number
  overdueTasks?: TaskSummary[]
  investorFollowUps?: InvestorFollowUp[]
  /** Mailbox connection is broken — calendar/email features are offline. */
  mailboxAlert?: { email: string; reason?: string | null } | null
  expiringCerts?: ExpiringCert[]
  dinoPayments?: DinoPaymentDue[]
  /** Inbound leads with a bid date closing and no decision yet. */
  leads?: LeadDue[]
}

export default function NeedsAttention({ reviewItems, overdueItems, ddItems, reviewCount, overdueCount, ddCount, overdueTasks = [], investorFollowUps = [], mailboxAlert = null, expiringCerts = [], dinoPayments = [], leads = [] }: NeedsAttentionProps) {
  const hasCritical = !!mailboxAlert || expiringCerts.length > 0
  const hasAttention = hasCritical || reviewItems.length > 0 || overdueItems.length > 0 || ddItems.length > 0 || overdueTasks.length > 0 || investorFollowUps.length > 0 || dinoPayments.length > 0 || leads.length > 0

  /**
   * What this card's badge counts.
   *
   * ⚠ IT USED TO SUM `.length` OF THREE ALREADY-SLICED LISTS, so the header
   * capped each of those contributions at 6 and the card under-reported itself
   * by construction — a badge cap inventing a third quantity (§12). It now
   * reads the true totals.
   *
   * ⚠ AND IT NO LONGER ADDS THE REVIEW QUEUE. That is the Decide backlog, an
   * order of magnitude larger and counted by `countDecideItems()`; folding it
   * in here is the exact mistake HealthPanel's docblock records making once
   * already (the tile read 197 while the sidebar read 1). The review section
   * still renders below with its own count — it is shown, not summed.
   */
  const attentionTotal =
    overdueCount +
    ddCount +
    overdueTasks.length +
    investorFollowUps.length +
    dinoPayments.length +
    leads.length +
    expiringCerts.length +
    (mailboxAlert ? 1 : 0)

  return (
    <div className="rounded-lg border border-border bg-card elev-1">
      {/* The header is the way out. This card is a ranked-ish SLICE — six per
          section — and /attention is the whole thing, ordered by urgency. */}
      <Link
        href="/attention"
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border transition-colors hover:bg-accent/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <AlertTriangle size={13} className={cn(hasAttention ? 'text-caution' : 'text-muted-foreground')} />
        <h2 className="label-caps text-muted-foreground">Needs Attention</h2>
        {hasAttention && (
          <span className="ml-auto text-xs font-medium tnum bg-caution-surface text-caution ring-1 ring-inset ring-caution-edge rounded px-1.5 py-0.5">
            {attentionTotal}
          </span>
        )}
      </Link>

      {!hasAttention ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">All clear</p>
          <p className="text-xs text-muted-foreground/70 mt-1">No items require immediate attention.</p>
        </div>
      ) : (
        <div className="p-3 space-y-3">

          {/* Critical — system + compliance items that outrank everything below */}
          {hasCritical && (
            <div className="rounded-md bg-critical-surface/60 ring-1 ring-inset ring-critical-edge p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-critical shrink-0" />
                <span className="label-caps text-critical">Critical</span>
              </div>
              <div className="space-y-1">
                {mailboxAlert && (
                  <Link
                    href="/settings/health"
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-critical-surface transition-colors"
                  >
                    <MailWarning size={13} className="text-critical shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">Mailbox sweep failing ({mailboxAlert.email})</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {mailboxAlert.reason
                          ? `New email is no longer reaching the CRM — ${mailboxAlert.reason}`
                          : 'New email is no longer reaching the CRM — check the error on System Health.'}
                      </p>
                    </div>
                  </Link>
                )}
                {expiringCerts.map((cert) => {
                  const days = cert.expiration_date
                    ? Math.ceil((new Date(cert.expiration_date).getTime() - Date.now()) / 86_400_000)
                    : null
                  const isExpired = days !== null && days < 0
                  return (
                    <Link
                      key={cert.id}
                      href="/company"
                      className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-critical-surface transition-colors"
                    >
                      <BadgeAlert size={13} className="text-critical shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {isExpired ? 'Cert expired: ' : `Cert expiring in ${days}d: `}
                          {cert.name}
                        </p>
                        {cert.issuing_body && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{cert.issuing_body}</p>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {/* Overdue tasks (from the team task system) */}
          {overdueTasks.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-critical shrink-0" />
                <ListChecks size={12} className="text-red-500 dark:text-red-400 shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Overdue Tasks
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{overdueTasks.length}</span>
              </div>
              <div className="space-y-1">
                {overdueTasks.slice(0, 6).map((t) => (
                  <Link
                    key={t.id}
                    href="/tasks"
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{t.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {[t.assignee, t.project_name].filter(Boolean).join(' · ') || 'Unassigned'}
                      </p>
                    </div>
                    {t.due_date && (
                      <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 tnum">
                        {daysOverdue(t.due_date)}d
                      </span>
                    )}
                  </Link>
                ))}
                {overdueTasks.length > 6 && (
                  <Link
                    href="/tasks"
                    className="block px-2 py-1 text-xs text-primary hover:underline"
                  >
                    +{overdueTasks.length - 6} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Investor follow-ups (overdue next steps on the capital raise) */}
          {investorFollowUps.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-critical shrink-0" />
                <HandCoins size={12} className="text-red-500 dark:text-red-400 shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Investor Follow-ups
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{investorFollowUps.length}</span>
              </div>
              <div className="space-y-1">
                {investorFollowUps.slice(0, 6).map((inv) => (
                  <Link
                    key={inv.id}
                    href={`/investors/${inv.id}`}
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{inv.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {inv.next_step ?? 'Next step overdue'}
                      </p>
                    </div>
                    {inv.next_step_date && (
                      <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 tnum">
                        {daysOverdue(inv.next_step_date)}d
                      </span>
                    )}
                  </Link>
                ))}
                {investorFollowUps.length > 6 && (
                  <Link href="/investors" className="block px-2 py-1 text-xs text-primary hover:underline">
                    +{investorFollowUps.length - 6} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Dino payments coming due (money we owe Dino Service Pros) */}
          {dinoPayments.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-caution shrink-0" />
                <Wrench size={12} className="text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Dino Payments
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{dinoPayments.length}</span>
              </div>
              <div className="space-y-1">
                {dinoPayments.slice(0, 6).map((p) => {
                  const overdue = p.due_date ? p.due_date < new Date().toISOString().slice(0, 10) : false
                  return (
                    <Link
                      key={p.id}
                      href="/dino"
                      className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {p.label ?? 'Installment'} · ${Math.round(p.amount).toLocaleString()}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {overdue ? 'Overdue' : 'Coming due'}
                        </p>
                      </div>
                      {p.due_date && (
                        <span className={cn('shrink-0 text-xs font-medium tnum', overdue ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
                          {overdue ? `${daysOverdue(p.due_date)}d` : ''}
                        </span>
                      )}
                    </Link>
                  )
                })}
                {dinoPayments.length > 6 && (
                  <Link href="/dino" className="block px-2 py-1 text-xs text-primary hover:underline">
                    +{dinoPayments.length - 6} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Inbound leads with a bid date closing */}
          {leads.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-caution shrink-0" />
                <Radar size={12} className="text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Inbound Leads
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{leads.length}</span>
              </div>
              <div className="space-y-1">
                {leads.slice(0, 6).map((l) => {
                  const overdue = l.bid_due_date
                    ? l.bid_due_date < new Date().toISOString().slice(0, 10)
                    : false
                  return (
                    <Link
                      key={l.id}
                      href="/leads"
                      className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{l.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {overdue ? 'Bid closed — never decided' : 'Bid closing'}
                          {l.sender_company ? ` · ${l.sender_company}` : ''}
                        </p>
                      </div>
                      {l.bid_due_date && (
                        <span
                          className={cn(
                            'shrink-0 text-xs font-medium tnum',
                            overdue
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                          )}
                        >
                          {overdue ? `${daysOverdue(l.bid_due_date)}d` : ''}
                        </span>
                      )}
                    </Link>
                  )
                })}
                {leads.length > 6 && (
                  <Link href="/leads" className="block px-2 py-1 text-xs text-primary hover:underline">
                    +{leads.length - 6} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Review queue items */}
          {reviewItems.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-caution shrink-0" />
                <ClipboardCheck size={12} className="text-muted-foreground shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Review Queue
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{reviewCount}</span>
              </div>
              <div className="space-y-1">
                {reviewItems.map((item) => (
                  <Link
                    key={item.id}
                    href="/review"
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {item.project?.name ?? 'Unknown project'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {reviewReasonLabel(item.reason)}
                        {item.confidence != null && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">
                            {Math.round(item.confidence * 100)}%
                          </span>
                        )}
                      </p>
                    </div>
                    {item.project?.sector && (
                      <span className={cn(
                        'shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                        SECTOR_BADGE[item.project.sector as keyof typeof SECTOR_BADGE]
                      )}>
                        {SECTOR_SHORT[item.project.sector as keyof typeof SECTOR_SHORT]}
                      </span>
                    )}
                  </Link>
                ))}
                {reviewCount > 6 && (
                  <Link
                    href="/review"
                    className="block px-2 py-1 text-xs text-primary hover:underline"
                  >
                    +{reviewCount - 6} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Overdue milestones */}
          {overdueItems.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-critical shrink-0" />
                <CalendarClock size={12} className="text-red-500 dark:text-red-400 shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Overdue Milestones
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{overdueCount}</span>
              </div>
              <div className="space-y-1">
                {overdueItems.map((m) => (
                  <Link
                    key={m.id}
                    href={`/projects/${m.project_id}/milestones`}
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{m.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {m.project?.name ?? 'Unknown project'}
                      </p>
                    </div>
                    {m.target_date && (
                      <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400 tnum">
                        {daysOverdue(m.target_date)}d
                      </span>
                    )}
                  </Link>
                ))}
                {/* These two had NO destination at all until /attention existed —
                    there is no cross-portfolio milestones or diligence page, so the
                    overflow was plain text naming a number you could not reach. */}
                {overdueCount > overdueItems.length && (
                  <Link href="/attention?kind=approaching_milestone" className="block px-2 py-1 text-xs text-primary hover:underline">
                    +{overdueCount - overdueItems.length} more →
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Critical / blocker DD items */}
          {ddItems.length > 0 && (
            <div className="rounded-md bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <span className="size-1.5 rounded-full bg-caution shrink-0" />
                <TrendingUp size={12} className="text-red-500 dark:text-red-400 shrink-0" />
                <span className="label-caps text-muted-foreground">
                  Due Diligence
                </span>
                <span className="ml-auto text-xs text-muted-foreground tnum">{ddCount}</span>
              </div>
              <div className="space-y-1">
                {ddItems.map((dd) => (
                  <Link
                    key={dd.id}
                    href={`/projects/${dd.project_id}/diligence`}
                    className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent/70 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{dd.item}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {dd.project?.name ?? 'Unknown project'}
                      </p>
                    </div>
                    <Chip tone={SEVERITY_BADGE[dd.severity]} className="shrink-0">
                      {SEVERITY_LABELS[dd.severity]}
                    </Chip>
                  </Link>
                ))}
                {/* These two had NO destination at all until /attention existed —
                    there is no cross-portfolio milestones or diligence page, so the
                    overflow was plain text naming a number you could not reach. */}
                {ddCount > ddItems.length && (
                  <Link href="/attention?kind=critical_dd" className="block px-2 py-1 text-xs text-primary hover:underline">
                    +{ddCount - ddItems.length} more →
                  </Link>
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
