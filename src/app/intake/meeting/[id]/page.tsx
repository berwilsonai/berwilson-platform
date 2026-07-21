import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import MeetingIntakeReview from '@/components/meeting-intake/MeetingIntakeReview'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'
import type { ReferencedMatch } from '@/lib/email-ingestion/analyze-meeting'
import type { PartyMatch } from '@/lib/ai/proposal-matching'

export const metadata = { title: 'Review — Meeting Notes' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function MeetingReviewPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('*')
    .eq('id', id)
    .eq('intake_kind', 'meeting')
    .single()

  if (!session) notFound()

  const back = (
    <Link href="/intake?tab=meeting" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft size={14} /> Meeting Intake
    </Link>
  )

  if (session.status === 'confirmed') {
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 p-5 text-center space-y-3">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <p className="text-sm font-medium">This meeting was already processed.</p>
          <Link href="/intake?tab=meeting" className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">
            Back to Meeting Intake
          </Link>
        </div>
      </div>
    )
  }

  // Picker data — records to fan out onto, task owners, and the contacts directory.
  const [{ data: projects }, { data: opportunities }, { data: teamMembers }, { data: contacts }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('id, name, sector')
        .order('name'),
      supabase
        .from('opportunities')
        .select('id, name')
        .not('status', 'in', '(closed_won,closed_passed)')
        .order('name'),
      supabase
        .from('team_members')
        .select('id, name, party_id')
        .eq('active', true)
        .order('name'),
      supabase
        .from('parties')
        .select('id, full_name, company, email, is_organization')
        .order('full_name'),
    ])

  const extraction = session.extraction_result as unknown as MeetingIntakeExtraction
  const referencedMatches = (session.match_candidates as unknown as ReferencedMatch[]) ?? []
  const partyMatches = (session.party_matches as unknown as PartyMatch[]) ?? []

  return (
    <div className="space-y-5 max-w-3xl">
      {back}
      <MeetingIntakeReview
        sessionId={session.id}
        extraction={extraction}
        referencedMatches={referencedMatches}
        partyMatches={partyMatches}
        projects={projects ?? []}
        opportunities={opportunities ?? []}
        teamMembers={teamMembers ?? []}
        contacts={contacts ?? []}
      />
    </div>
  )
}
