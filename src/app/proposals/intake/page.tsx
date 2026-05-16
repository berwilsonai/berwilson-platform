import ProposalIntakeWizard from '@/components/proposals/ProposalIntakeWizard'

export const metadata = { title: 'Intake Proposal — Ber Wilson' }

export default function ProposalIntakePage() {
  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Intake Proposal</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a proposal document and the system will extract project details automatically.
        </p>
      </div>
      <ProposalIntakeWizard />
    </div>
  )
}
