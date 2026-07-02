import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import EmailIngestReview from '@/components/email-ingestion/EmailIngestReview'
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
        />
      )}
    </div>
  )
}
