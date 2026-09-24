import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import ProfileIntakeReview from '@/components/contacts/ProfileIntakeReview'
import type { ProfileIntakeDraft } from '@/lib/contacts/profile-intake'

export const metadata = { title: 'Review — People Intake' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function PeopleReviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, extraction_result, created_record_ids')
    .eq('id', id)
    .eq('intake_kind', 'people')
    .single()

  if (!session) notFound()

  const back = (
    <Link
      href="/intake?tab=people"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft size={14} /> People Intake
    </Link>
  )

  if (session.status === 'confirmed') {
    const ids = (session.created_record_ids ?? {}) as { party_ids?: string[] }
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 p-5 text-center space-y-3">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <p className="text-sm font-medium">
            Already confirmed — {ids.party_ids?.length ?? 0} contact
            {(ids.party_ids?.length ?? 0) === 1 ? '' : 's'} saved.
          </p>
          <Link
            href="/contacts"
            className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Open the Directory
          </Link>
        </div>
      </div>
    )
  }

  if (session.status === 'running') {
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-border bg-card p-5 text-center space-y-3">
          <Loader2 className="size-7 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">{session.label || 'Profiling'}</p>
          <p className="text-sm text-muted-foreground">
            Reading the mail and profiling each person — about a minute each. This page does not
            refresh itself; reload it, or come back to People Intake when you are ready.
          </p>
        </div>
      </div>
    )
  }

  if (session.status === 'failed') {
    const err = session.extraction_result as { error?: unknown } | null
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-5 space-y-2">
          <AlertTriangle className="size-6 text-destructive" />
          <p className="text-sm font-medium">This run did not finish.</p>
          <p className="text-sm text-muted-foreground">
            {typeof err?.error === 'string' && err.error
              ? err.error
              : 'It likely hit the five-minute limit. Try fewer people in one run.'}
          </p>
        </div>
      </div>
    )
  }

  const draft = (session.extraction_result ?? {}) as unknown as ProfileIntakeDraft
  if (!draft.people || draft.people.length === 0) {
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <p className="text-sm font-medium">Nothing to review.</p>
          <p className="text-sm text-muted-foreground">
            This run produced no profiles. Try again with email addresses rather than names.
          </p>
        </div>
      </div>
    )
  }

  // Picker data — the records people can be attached to.
  const [{ data: projects }, { data: opportunities }] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase
      .from('opportunities')
      .select('id, name')
      .not('status', 'in', '(closed_won,closed_passed)')
      .order('name'),
  ])

  return (
    <div className="space-y-5 max-w-3xl">
      {back}
      <div>
        <h1 className="text-lg font-semibold">{session.label || 'People Intake'}</h1>
        <p className="text-sm text-muted-foreground">
          Check what the mail says, fix anything wrong, and confirm. Nothing is created until you do.
        </p>
      </div>
      <ProfileIntakeReview
        sessionId={session.id}
        draft={draft}
        projects={projects ?? []}
        opportunities={opportunities ?? []}
      />
    </div>
  )
}
