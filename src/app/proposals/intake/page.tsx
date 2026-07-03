import { createAdminClient } from '@/lib/supabase/admin'
import ProposalIntakeWizard from '@/components/proposals/ProposalIntakeWizard'

export const metadata = { title: 'Proposal Intake — Ber Wilson' }

export default async function ProposalIntakePage() {
  const supabase = createAdminClient()

  // Fetch projects that can be parents (top-level, active/on_hold)
  const { data: parents } = await supabase
    .from('projects')
    .select('id, name')
    .is('parent_project_id', null)
    .in('status', ['active', 'on_hold'])
    .order('name')

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Proposal Intake</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a proposal document and the system will extract project details automatically.
        </p>
      </div>
      <ProposalIntakeWizard availableParents={parents || []} />
    </div>
  )
}
