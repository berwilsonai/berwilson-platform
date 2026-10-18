import { TriangleAlert } from 'lucide-react'

import { computeAttention } from '@/lib/attention'
import type { AttentionCategory } from '@/lib/attention-kinds'
import AttentionClient, { type AttentionRow } from '@/components/attention/AttentionClient'

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
  const { items, summary } = await computeAttention()

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
    ⚠ TWO QUANTITIES, NAMED APART, NEVER SUMMED (§12).

    The sidebar badge is four CHEAP HEAD COUNTS — the things past a hard date —
    because it renders in the root layout on every page and cannot afford this
    engine's dozen queries. This list is wider: it also carries the softer
    signals (a thread waiting on someone, a decision with no follow-through, a
    dependency at risk). So the badge will read lower than the list is long,
    and the only safe thing to do with that is SAY SO rather than print one
    total and let the reader discover the contradiction.

    Derived from the items already in hand, so it costs no extra query. The
    badge's own vocabulary differs slightly again — it counts `certifications`
    where this counts `compliance_items`, which COUNTED_ATTENTION_KINDS records.
  */
  const PAST_A_DATE: AttentionCategory[] = [
    'overdue_action',
    'critical_dd',
    'approaching_milestone',
    'expiring_compliance',
  ]
  const pastDue = items.filter((i) => PAST_A_DATE.includes(i.category)).length
  const softer = summary.total - pastDue

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <TriangleAlert size={16} className={pastDue > 0 ? 'text-caution' : 'text-muted-foreground'} />
          <h1 className="text-xl font-semibold">Attention</h1>
        </div>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Work that is slipping, ranked by urgency rather than by when it arrived.{' '}
          <span className="text-foreground font-medium tnum">{pastDue}</span>{' '}
          {pastDue === 1 ? 'item is' : 'items are'} past a date — that is the number on the sidebar
          badge
          {softer > 0 && (
            <>
              {' '}— and{' '}
              <span className="text-foreground font-medium tnum">{softer}</span> more are softer
              signals: waiting on someone, a decision adrift, a dependency at risk
            </>
          )}
          . Inbound things awaiting a decision are counted separately on{' '}
          <span className="font-medium text-foreground">Decide</span>, and the two are never summed.
        </p>
      </header>

      <AttentionClient items={rows} />
    </div>
  )
}
