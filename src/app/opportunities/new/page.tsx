import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import OpportunityForm from '@/components/opportunities/OpportunityForm'

export const metadata = { title: 'New Opportunity — Ber Wilson Intelligence' }

export default function NewOpportunityPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/opportunities"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Opportunities
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">New Opportunity</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Track an acquisition, partnership, JV, or other strategic opportunity.
        </p>
      </div>

      <OpportunityForm mode="create" />
    </div>
  )
}
