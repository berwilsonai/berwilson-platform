import Link from 'next/link'
import { AlertTriangle, MailWarning } from 'lucide-react'

import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { cn } from '@/lib/utils'
import {
  attentionKind,
  attentionHref,
  urgencyBand,
  type AttentionCategory,
} from '@/lib/attention-kinds'

/**
 * The dashboard's attention rail — a SLICE OF THE ENGINE, and nothing of its
 * own.
 *
 * ⚠ IT REPLACED A SECOND ATTENTION ENGINE ON 2026-10-29, which is the whole
 * point of the file. `NeedsAttention` ran eight of its own queries — review
 * queue, overdue milestones, critical diligence, overdue tasks, investor
 * follow-ups, expiring certs, Dino payments and inbound leads — with no
 * scoring, no dismissals and a six-row cap per section, beside
 * `computeAttention()`'s nine scored and dismissable kinds on /attention. Two
 * surfaces, two definitions, one name: §12's "ONE QUANTITY, ONE DEFINITION" in
 * the shape the dashboard's own HealthPanel docblock records paying for once
 * before (1, 99+ and 197 on one screen).
 *
 * ⚠ AND THE DRIFT WAS NOT COSMETIC BY THE END. On 10-21 inbound leads were
 * removed from `ATTENTION_KINDS` with a note at the foot of that file saying
 * the middle option — *keeping only the leads whose bid closes inside N days* —
 * is WORSE than either extreme, because it puts a third threshold on rows
 * /leads and /decide already rank. Three days later this rail was still
 * selecting `bid_due_date <= today + 14` with a `fit_recommendation` filter: a
 * ⚠ comment in one file did not reach the sibling component, which is itself a
 * §12 rule. Leads reach a reader on /leads, which is where Richard put them.
 *
 * So: no queries here, no filters here, no totals computed here. The page hands
 * over what `computeAttention()` already scored, ordered and contained.
 *
 * ⚠ IT IS CALLED "What's slipping", NOT "Needs Attention", AND THAT IS NOT A
 * WORDING PREFERENCE. Two quantities live on this page and they are genuinely
 * different numbers:
 *
 *   · the KPI tile and the sidebar badge print `countAttention()` — four cheap
 *     head counts, because the badge renders in the root layout on EVERY page
 *     and cannot afford a dozen queries;
 *   · this rail prints `computeAttention().summary.total` — ten scored kinds
 *     with human dismissals applied.
 *
 * They coincide today (both 3) and they will not always: the engine also scores
 * a thread waiting on someone, a decision with no follow-through, a dependency
 * at risk. §12 is explicit that two different quantities must be NAMED APART
 * and never summed — so the one that is "needs attention" keeps the name, and
 * the ranked list says what it actually is. Putting the same words over both
 * was the original 1-99+-197 failure, and it would have come back here.
 */

/** One already-scored row. A structural subset of `AttentionItem`. */
export interface AttentionRailItem {
  id: string
  category: AttentionCategory
  urgency: number
  title: string
  detail: string
  project_id: string | null
  project_name: string
}

interface AttentionRailProps {
  /** The top rows by urgency — the page slices, this renders what it is given. */
  items: AttentionRailItem[]
  /**
   * The engine's own total, NOT `items.length`.
   *
   * ⚠ THE OLD CARD'S BADGE SUMMED ALREADY-SLICED LISTS, so it capped its own
   * contributions at six and under-reported by construction — a badge cap
   * inventing a third quantity (§12). A display cap and a count are two
   * different numbers and they arrive here separately for that reason.
   */
  total: number
  /**
   * Mail is no longer reaching the CRM.
   *
   * Deliberately NOT an attention kind. Everything the engine produces is a
   * piece of WORK somebody has to do; this is an instrument failure, and the
   * answer to it is on /settings/health rather than on any record. It outranks
   * the list and says why in place — during an outage "why" is the whole
   * question, and making the reader open another page to find it is how a red
   * banner gets ignored.
   */
  mailboxAlert?: { email: string; reason?: string | null } | null
}

export default function AttentionRail({ items, total, mailboxAlert = null }: AttentionRailProps) {
  const hasAnything = total > 0 || !!mailboxAlert

  return (
    <Panel className="overflow-hidden">
      {/* The header is the way out: this is the top of a ranked list and
          /attention is all of it, with the chips, the dismissals and the undo. */}
      <Link
        href="/attention"
        className="flex items-center gap-2 border-b border-border px-4 py-2.5 outline-none transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        <AlertTriangle
          size={13}
          className={cn(total > 0 ? 'text-caution' : 'text-muted-foreground')}
        />
        <h2 className="label-caps text-muted-foreground">What&apos;s slipping</h2>
        {total > 0 && (
          <span className="ml-auto rounded bg-caution-surface px-1.5 py-0.5 text-xs font-medium tnum text-caution ring-1 ring-inset ring-caution-edge">
            {total}
          </span>
        )}
      </Link>

      {!hasAnything ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">All clear</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Nothing is falling through the cracks that we can see.
          </p>
        </div>
      ) : (
        <>
          {mailboxAlert && (
            <Link
              href="/settings/health"
              className="flex items-start gap-2 border-b border-critical-edge bg-critical-surface/60 px-4 py-3 outline-none transition-colors hover:bg-critical-surface focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <MailWarning size={13} className="mt-0.5 shrink-0 text-critical" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">
                  Mailbox sweep failing ({mailboxAlert.email})
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {mailboxAlert.reason
                    ? `New email is no longer reaching the CRM — ${mailboxAlert.reason}`
                    : 'New email is no longer reaching the CRM — check the error on System Health.'}
                </p>
              </div>
            </Link>
          )}

          <div>
            {items.map((row) => {
              const kind = attentionKind(row.category)
              const band = urgencyBand(row.urgency)
              return (
                <Link
                  key={row.id}
                  href={attentionHref(row.category, row.project_id)}
                  className={cn(
                    'block border-l-2 px-4 py-2.5 outline-none transition-colors',
                    // Only `now` is tinted. When every row is red, red has
                    // stopped signifying (§12) — `soon` gets the border alone
                    // and `watch` gets nothing. Same bands as /attention, so
                    // the two surfaces cannot disagree about what is urgent.
                    band === 'now'
                      ? 'border-l-critical bg-critical-surface/40'
                      : band === 'soon'
                        ? 'border-l-caution'
                        : 'border-l-transparent',
                    // ⚠ A RING, NOT A BACKGROUND. `cn()` is tailwind-merge, so
                    // a hover `bg-*` would silently delete the band tint above
                    // — the exact bug /attention's list paid for, where the
                    // most urgent row lost its colour on navigation.
                    'hover:ring-2 hover:ring-inset hover:ring-ring/30 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Chip tone={kind.tone}>{kind.label}</Chip>
                    <span className="truncate text-xs text-muted-foreground">
                      {row.project_name}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{row.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                </Link>
              )
            })}
          </div>

          {total > items.length && (
            <Link
              href="/attention"
              className="block border-t border-border px-4 py-2.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              {/* ⚠ NAMES BOTH NUMBERS. "See all" alone leaves the reader
                  unable to tell a six-row cap from a six-row list, which is
                  how the old rail hid item number seven for months. */}
              Showing {items.length} of {total} — see the ranked list →
            </Link>
          )}
        </>
      )}
    </Panel>
  )
}
