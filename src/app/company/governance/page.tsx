import type { Metadata } from 'next'
import { Scale } from 'lucide-react'
import { getViewer } from '@/lib/auth/viewer'
import CompanySectionTabs from '@/components/company/CompanySectionTabs'
import CorporateRecordClient from '@/components/governance/CorporateRecordClient'
import { loadCorporateRecordPage } from '@/lib/governance/queries'

export const metadata: Metadata = {
  title: 'Corporate record — Ber Wilson Intelligence',
}

/**
 * Resolutions, appointments and ownership — the three registers a lender, an
 * auditor or an acquirer asks for by name, and none of which the minute book
 * could hold. Admin-only by prefix default-deny.
 */
export default async function CorporateRecordPage() {
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? false
  const data = await loadCorporateRecordPage()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted dark:bg-muted/40">
          <Scale size={20} className="text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Corporate record</h1>
          <p className="text-sm text-muted-foreground">
            Resolutions and consents, who holds which office and may sign what, and ownership of record
          </p>
        </div>
      </div>

      <CompanySectionTabs active="governance" showProfile={isAdmin} />

      <CorporateRecordClient data={data} canEdit={isAdmin} />
    </div>
  )
}
