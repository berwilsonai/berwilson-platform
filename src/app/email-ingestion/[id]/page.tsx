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
        <Link href="/email-ingestion" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={14} /> Email Ingestion
        </Link>
        {effective === 'running' ? (
          <div className="rounded-lg border border-border bg-card p-5 text-center space-y-3">
            <Loader2 className="size-7 text-muted-foreground mx-auto animate-spin" />
            <p className="text-sm font-medium">Research is still running.</p>
            <p className="text-sm text-muted-foreground">
              Searching Outlook and reading threads — usually 1–4 minutes. This page refreshes on its own.
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

  const createdIds = session.created_record_ids as unknown as
    | { opportunity_id?: string; project_id?: string }
    | null

  return (
    <div className="space-y-5 max-w-3xl">
      <Link href="/email-ingestion" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={14} /> Email Ingestion
      </Link>

      {session.status === 'confirmed' ? (
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 p-5 text-center space-y-3">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <p className="text-sm font-medium">This package was already confirmed.</p>
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
          stagedAttachments={parseStagedAttachments(session.staged_attachments)}
        />
      )}
    </div>
  )
}
