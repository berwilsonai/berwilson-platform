import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, accessibleProjectIds, canAccessOpportunity } from '@/lib/auth/viewer'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import { pagerPosition } from '@/lib/records/pager'

/**
 * Previous / next within the record register, and where you are in it.
 *
 * ⚠ THE GAP THIS CLOSES: there was no way to get from one deal to the next.
 * The only exit from a detail page was the breadcrumb back to a 19-card grid,
 * so comparing two records meant a round trip through the list every time —
 * for two people who cycle the same register daily.
 *
 * ⚠ A CONFIDENTIAL PROJECT IS NOT IN THE CHAIN, AND THE CHAIN IS NOT SHOWN
 * WHILE YOU ARE ON ONE. Prev/next is a cross-portfolio list, and §8 says
 * containment takes a protected project out of every one of those — so walking
 * the register must not be a way to enumerate protected names, and the count
 * ("4 of 19") must not silently include one either. When the current record is
 * itself protected the pager renders nothing at all, because a position in a
 * list it has been removed from is not a meaningful number.
 *
 * Ordered by NAME, deliberately: a chain has to be stable to be useful, and
 * `updated_at` reorders itself as you work. The label says so, because an
 * unexplained ordering reads as arbitrary.
 */
export default async function RecordPager({
  kind,
  currentId,
}: {
  kind: 'project' | 'opportunity'
  currentId: string
}) {
  const supabase = createAdminClient()
  const viewer = await getViewer()
  const table = kind === 'project' ? 'projects' : 'opportunities'
  const base = kind === 'project' ? '/projects' : '/opportunities'

  const { data } = await supabase.from(table).select('id, name').order('name')
  let rows = (data ?? []) as { id: string; name: string }[]
  if (rows.length === 0) return null

  // Grants first — the same filter each layout applies to the record itself.
  if (viewer && !viewer.isAdmin) {
    if (kind === 'project') {
      const allowed = await accessibleProjectIds(viewer)
      if (allowed) rows = rows.filter((r) => allowed.has(r.id))
    } else {
      rows = rows.filter((r) => canAccessOpportunity(viewer, r.id))
    }
  }

  // Then containment, which applies to everyone including both admins. The
  // filter and the COUNT are decided together in pagerPosition(), so the total
  // can never be taken before the exclusion.
  const hidden = kind === 'project' ? await viewerHiddenProjectIds() : new Set<string>()
  const position = pagerPosition(rows, currentId, hidden)
  if (!position) return null
  const { prev, next, index: i, total } = position

  const arrow = 'inline-flex size-[2.75rem] sm:size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
  const dead = 'inline-flex size-[2.75rem] sm:size-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground/35'

  return (
    <div className="flex items-center gap-1.5">
      {prev ? (
        <Link href={`${base}/${prev.id}`} className={arrow} title={`Previous: ${prev.name}`} aria-label={`Previous record: ${prev.name}`}>
          <ChevronLeft size={15} />
        </Link>
      ) : (
        <span className={dead} aria-hidden="true">
          <ChevronLeft size={15} />
        </span>
      )}
      <span className="text-xs text-muted-foreground tnum whitespace-nowrap" title="Ordered by name">
        {i} of {total}
      </span>
      {next ? (
        <Link href={`${base}/${next.id}`} className={arrow} title={`Next: ${next.name}`} aria-label={`Next record: ${next.name}`}>
          <ChevronRight size={15} />
        </Link>
      ) : (
        <span className={dead} aria-hidden="true">
          <ChevronRight size={15} />
        </span>
      )}
    </div>
  )
}
