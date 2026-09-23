import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import { DEV_NOTE_SELECT, type DevNoteRow } from '@/lib/dev-notes/queries'
import DevNotesClient from '@/components/dev-notes/DevNotesClient'

export const metadata = { title: 'Developer Notes — Ber Wilson Intelligence' }

interface PageProps {
  /** `?note=<id>` from a notification deep link — expands that report. */
  searchParams: Promise<{ note?: string }>
}

/**
 * Developer Notes — the ledger of bugs and requests raised from inside the app.
 *
 * Reachable by EVERY role (see ROLE_PAGE_PREFIXES): the people most likely to
 * hit a bug are the ones with the least access. Everyone reads the whole list —
 * seeing what has already been reported is what stops the same bug arriving
 * five times — while the API decides what each viewer may change.
 */
export default async function DevNotesPage({ searchParams }: PageProps) {
  const params = await searchParams
  const viewer = await getViewer()

  const { data, error } = await createAdminClient()
    .from('dev_notes')
    .select(DEV_NOTE_SELECT)
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="max-w-4xl">
        <h1 className="text-2xl font-semibold text-foreground">Developer Notes</h1>
        <p className="mt-3 text-sm text-destructive">
          Could not load reports: {error.message}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          If this is a fresh deploy, the <code>dev_notes</code> migration may not be applied yet.
        </p>
      </div>
    )
  }

  const notes = (data ?? []) as unknown as DevNoteRow[]

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Developer Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bugs, requests, and rough edges reported from inside the platform. Each one is tracked
          until it is checked off. Every change is written to the activity log.
        </p>
      </div>

      <DevNotesClient
        notes={notes}
        isAdmin={viewer?.isAdmin ?? false}
        teamMemberId={viewer?.teamMemberId ?? null}
        initialOpenNoteId={params.note}
      />
    </div>
  )
}
