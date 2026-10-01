import type { Metadata } from 'next'
import { ClipboardCheck } from 'lucide-react'
import { getViewer } from '@/lib/auth/viewer'
import CompanySectionTabs from '@/components/company/CompanySectionTabs'
import ComplianceClient from '@/components/governance/ComplianceClient'
import { loadCompliancePage } from '@/lib/governance/queries'

export const metadata: Metadata = {
  title: 'Compliance register — Ber Wilson Intelligence',
}

/**
 * The filing calendar, conflict disclosures, related-party transactions and
 * policy acknowledgements. Admin-only by prefix default-deny.
 */
export default async function CompliancePage() {
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? false
  const data = await loadCompliancePage()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-900/40">
          <ClipboardCheck size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Compliance register</h1>
          <p className="text-sm text-muted-foreground">
            What each entity owes a regulator, what has been disclosed, and who has acknowledged what
          </p>
        </div>
      </div>

      <CompanySectionTabs active="compliance" showProfile={isAdmin} />

      <ComplianceClient data={data} canEdit={isAdmin} />
    </div>
  )
}
