import { redirect } from 'next/navigation'

// Proposal Intake merged into the unified Intake destination (2026-07-17).
export default function ProposalIntakeRedirect() {
  redirect('/intake?tab=proposal')
}
