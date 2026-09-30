import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import EmailIngestReview from '@/components/email-ingestion/EmailIngestReview'
import SessionsAutoRefresh from '@/components/email-ingestion/SessionsAutoRefresh'
import { effectiveEmailIntakeStatus } from '@/lib/utils/email-ingestion'
import { parseStagedAttachments } from '@/lib/email-ingestion/attachments'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'
import type { FitAssessment } from '@/lib/ai/fit-assessment'

export const metadata = { title: 'Review — Email Ingestion' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EmailIngestReviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', id)
    .single()

  if (!session) notFound()

  const effective = effectiveEmailIntakeStatus(session.status, session.updated_at)
  if (effective === 'running' || effective === 'failed') {
    const err =
      session.extraction_result && typeof session.extraction_result === 'object' && 'error' in (session.extraction_result as object)
        ? String((session.extraction_result as { error?: unknown }).error ?? '')
        : ''
    return (
      <div className="space-y-5 max-w-3xl">
        {effective === 'running' && <SessionsAutoRefresh />}
        <Link href="/intake" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={14} /> Email Ingestion
        </Link>
        {effective === 'running' ? (
          <div className="rounded-lg border border-border bg-card p-5 text-center space-y-3">
            <Loader2 className="size-7 text-muted-foreground mx-auto animate-spin" />
            <p className="text-sm font-medium">Research is still running.</p>
            <p className="text-sm text-muted-foreground">
              Searching Gmail and reading threads — usually 1–4 minutes. This page refreshes on its own.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-red-300 dark:border-red-800/60 bg-red-50/60 dark:bg-red-950/30 p-5 text-center space-y-3">
            <AlertTriangle className="size-7 text-red-600 dark:text-red-400 mx-auto" />
            <p className="text-sm font-medium">This research run failed.</p>
            <p className="text-sm text-muted-foreground">
              {err || 'The run never finished — it likely hit the 5-minute limit. Try a narrower search.'}
            </p>
          </div>
        )}
      </div>
    )
  }

  const extraction = session.extraction_result as unknown as EmailIntakeExtraction
  const partyMatches = (session.party_matches as unknown as PartyMatch[]) ?? []
  const fit = (session.fit_assessment as unknown as FitAssessment | null) ?? null

  // Every record this package could be sent to instead of creating a new one.
  // The queue proposes one record per CLUSTER of correspondence, not one per
  // deal, so a programme arrives as several proposals — 8 for Myton, 8 for data
  // centres, measured 2026-09-23. Without this list the only way to agree that
  // two proposals are the same deal was to create both and reconcile by hand.
  //
  // Projects are NOT filtered by status: `projects.status` has no 'archived'
  // member and a `.neq` on a nullable column drops rows silently (§12), and a
  // completed project is still the right home for late correspondence about it.
  const [{ data: projectOptions }, { data: opportunityOptions }] = await Promise.all([
    supabase.from('projects').select('id, name, location, stage').order('name'),
    supabase
      .from('opportunities')
      .select('id, name, location, status')
      .not('status', 'in', '(closed_won,closed_passed)')
      .order('name'),
  ])

  const createdIds = session.created_record_ids as unknown as
    | {
        opportunity_id?: string
        project_id?: string
        attached_to_existing?: boolean
        record_name?: string
      }
    | null

  return (
    <div className="space-y-5 max-w-3xl">
      <Link href="/intake" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> Email Ingestion
      </Link>

      {session.status === 'confirmed' ? (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 p-5 text-center space-y-3">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <p className="text-sm font-medium">
            {createdIds?.attached_to_existing
              ? `This package was added to ${createdIds.record_name ?? 'an existing record'}.`
              : 'This package was already confirmed.'}
          </p>
          {createdIds?.project_id && (
            <Link href={`/projects/${createdIds.project_id}`} className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">
              Open project
            </Link>
          )}
          {createdIds?.opportunity_id && (
            <Link href={`/opportunities/${createdIds.opportunity_id}`} className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">
              Open opportunity
            </Link>
          )}
        </div>
      ) : (
        <EmailIngestReview
          sessionId={session.id}
          extraction={extraction}
          partyMatches={partyMatches}
          fit={fit}
          label={session.label}
          predecision={session.predecision}
          matchCandidates={session.match_candidates}
          projects={projectOptions ?? []}
          opportunities={opportunityOptions ?? []}
          stagedAttachments={parseStagedAttachments(session.staged_attachments)}
        />
      )}
    </div>
  )
}
