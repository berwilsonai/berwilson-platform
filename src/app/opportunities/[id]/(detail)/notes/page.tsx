import { MessageSquare } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import OpportunityNotes from '@/components/opportunities/OpportunityNotes'
import RecordCorrespondence from '@/components/correspondence/RecordCorrespondence'
import { loadFiledThreads } from '@/lib/email-sweep/filed-threads'

export const metadata = { title: 'Notes — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ new?: string }>
}

export default async function OpportunityNotesPage({ params, searchParams }: PageProps) {
  const { id } = await params
  // `?new=1` — the header's Log menu arriving with the composer focused.
  const { new: startNew } = await searchParams
  const supabase = createAdminClient()

  const [{ data: notes }, filedThreads] = await Promise.all([
    supabase
      .from('opportunity_notes')
      .select('*')
      .eq('opportunity_id', id)
      .order('created_at', { ascending: false }),
    loadFiledThreads('opportunity', id),
  ])

  return (
    <div className="space-y-6">
      {/* The mail filed on this deal, plus one-click filing of suggested
          unfiled threads — the same panel the project Updates tab uses. */}
      <section>
        <RecordCorrespondence recordKind="opportunity" recordId={id} initialFiled={filedThreads} />
      </section>

      <section>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <MessageSquare size={15} /> Progress Notes
        </h2>
        <OpportunityNotes opportunityId={id} notes={notes ?? []} autoFocus={startNew === '1'} />
      </section>
    </div>
  )
}
