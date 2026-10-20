import { TriangleAlert } from 'lucide-react'

import { computeAttention, countAttention } from '@/lib/attention'
import { ATTENTION_KINDS } from '@/lib/attention-kinds'
import AttentionClient, { type AttentionRow, type DismissedRow } from '@/components/attention/AttentionClient'

export const metadata = { title: 'Attention — Ber Wilson Intelligence' }

/**
 * The surface for the attention engine.
 *
 * ⚠ IT DID NOT EXIST, AND CLAUDE.md §3 SAID IT DID. `src/lib/attention.ts` has
 * scored ten categories of falling-through-the-cracks work 0–100 since it was
 * written, and the only consumers were an API route, the sidebar badge and an
 * agent tool. The one place any of it reached a reader was the dashboard rail,
 * which truncated six of its eight sections at six items with no overflow link
 * — so **there was no way in the product to see attention item number seven.**
 *
 * ⚠ THIS IS NOT A SECOND /decide, AND THE DISTINCTION IS LOAD-BEARING. The
 * engine's own docblock insists the two must never be summed: Decide is inbound
 * work awaiting a judgement, Attention is our own work slipping. They are
 * different verbs — one needs a decision, the other needs doing — and merging
 * them is the mistake that put 197 and 1 on the same screen under one name.
 *
 * Confidential projects are filtered inside `computeAttention()` itself, at the
 * choke point, so this page cannot forget to.
 */
export default async function AttentionPage() {
  const { items, summary, dismissed } = await computeAttention()

  const rows: AttentionRow[] = items.map((i) => ({
    id: i.id,
    category: i.category,
    urgency: i.urgency,
    title: i.title,
    detail: i.detail,
    project_id: i.project_id,
    project_name: i.project_name,
    age_days: i.age_days,
    due_date: i.due_date,
  }))

  /*
    ⚠ TWO QUANTITIES, NAMED APART, NEVER SUMMED (§12) — AND BOTH READ FROM
    THEIR OWN SOURCE RATHER THAN ONE INFERRED FROM THE OTHER.

    The sidebar badge is `countAttention()`: four cheap head counts, because it
    renders in the root layout on every page and cannot afford this engine's
    dozen queries. This list is `computeAttention()`, which is wider — it also
    carries the softer signals (a thread waiting on someone, a decision with no
    follow-through, a dependency at risk) — and it is wider in a way that does
    NOT nest: the badge counts milestones already OVERDUE while the engine
    scores milestones approaching within 30 days, and the badge counts
    `certifications` where the engine reads `compliance_items`.

    ⚠ So the badge's number cannot be derived by filtering these items, and an
    earlier draft of this page did exactly that and asserted the result WAS the
    badge — it read 3 against a badge of 1. Calling `countAttention()` here is
    four head counts and makes the page agree with the chrome instead of
    guessing at it.
  */
  const badgeCount = await countAttention()

  /*
    The dismissals, already contained by `computeAttention()` (§8 — a list of
    titles somebody silenced is a cross-portfolio surface like any other).
    Narrowed to what the Dismissed view renders rather than passed whole, so a
    column added to that table later does not silently reach the browser.
  */
  const quiet: DismissedRow[] = dismissed.map((d) => ({
    item_key: d.item_key,
    category: d.category,
    title: d.title,
    project_name: d.project_name,
    dismissed_until: d.dismissed_until,
    dismissed_by: d.dismissed_by,
  }))

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <TriangleAlert size={16} className={summary.total > 0 ? 'text-caution' : 'text-muted-foreground'} />
          <h1 className="text-xl font-semibold">Attention</h1>
        </div>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Everything that is slipping, ranked by urgency rather than by when it arrived —{' '}
          <span className="text-foreground font-medium tnum">{summary.total}</span>{' '}
          {summary.total === 1 ? 'item' : 'items'} across {ATTENTION_KINDS.length} kinds. Dismiss a
          row to quiet it for two weeks, or delete the record behind it where that is what you mean.
        </p>
        {/* The sidebar's number, named as its own quantity. It is NOT a subset
            of the list: it counts overdue milestones where this scores
            approaching ones, and certifications where this reads compliance
            items. Printing one total and letting a reader find the mismatch is
            how three contradictory "needs attention" numbers happened before. */}
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">
          The sidebar badge is a narrower count —{' '}
          <span className="text-foreground font-medium tnum">{badgeCount}</span> past a hard date —
          and is measured separately so it can run on every page. Inbound things awaiting a
          decision are counted on <span className="font-medium text-foreground">Decide</span>, and
          none of these three are ever summed.
        </p>
      </header>

      <AttentionClient items={rows} dismissed={quiet} />
    </div>
  )
}
