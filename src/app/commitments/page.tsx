import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { listCommitments, type CommitmentListFilters } from '@/lib/commitments/list'
import { LEAD_MAILBOXES, allMailboxes } from '@/lib/integrations/google-workspace'
import CommitmentsClient from '@/components/commitments/CommitmentsClient'

export const metadata = { title: 'Commitments — Ber Wilson' }

/**
 * The commitment ledger — every obligation read out of correspondence.
 *
 * ⚠ WHY THIS PAGE EXISTS. Until 2026-10-09 the only place a commitment could be
 * settled was the dashboard panel, capped at 24 rows and ordered
 * `due_date … nullsFirst: false`. 369 of 476 open rows carry no date, so they
 * sat permanently below the cap: 78% of the ledger had no close button
 * anywhere, Pepper named those rows every morning regardless, and
 * `count(settled_by)` over the whole table was zero. The note was the only
 * working half of a loop.
 *
 * Admin-only by default-deny — /commitments appears in no ROLE_PAGE_PREFIXES
 * allowlist, so the middleware turns every other role away before this runs.
 * The guard below covers the case where the allowlist later opens the path up
 * without meaning to, which is the same posture /api/commitments takes.
 */
export default async function CommitmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; view?: string; mailbox?: string; q?: string }>
}) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const sp = await searchParams
  const filters: CommitmentListFilters = {
    side: sp.side === 'us' || sp.side === 'them' ? sp.side : undefined,
    view:
      sp.view === 'quiet' || sp.view === 'settled' || sp.view === 'all' ? sp.view : 'open',
    mailbox: sp.mailbox || undefined,
    q: sp.q || undefined,
  }

  // Only an admin can hold a step-up (§8), so a non-admin's id would widen
  // nothing and passing it would imply otherwise — the same expression every
  // other viewer-aware read in the repo uses.
  const { items, totals, error, withheld } = await listCommitments(
    filters,
    viewer?.isAdmin ? viewer.authUserId : null
  )

  // Offered as a filter because the mailbox is the ledger's most honest
  // ownership key — `owner_name` holds four spellings of one man and 31 nulls,
  // while every row carries the mailbox of its thread (see pepper/attribution).
  const mailboxes = [...new Set([...allMailboxes(), ...LEAD_MAILBOXES])].sort()

  return (
    <CommitmentsClient
      items={items}
      totals={totals}
      filters={filters}
      mailboxes={mailboxes}
      loadError={error}
      withheld={withheld}
    />
  )
}
