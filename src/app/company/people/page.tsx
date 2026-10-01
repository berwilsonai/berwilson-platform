import type { Metadata } from 'next'
import { Users } from 'lucide-react'
import { getViewer } from '@/lib/auth/viewer'
import CompanySectionTabs from '@/components/company/CompanySectionTabs'
import PersonnelRegister from '@/components/governance/PersonnelRegister'
import { loadPersonnelPage } from '@/lib/governance/queries'

export const metadata: Metadata = {
  title: 'Personnel register — Ber Wilson Intelligence',
}

/**
 * The personnel register — employment records, the file behind each one, and
 * the offboarding evidence.
 *
 * Admin-only by prefix default-deny in permissions.ts: '/company/structure' is
 * the one company route other roles may reach, and prefix matching means it does
 * not grant '/company/people'. That matters more here than anywhere else in the
 * app — §8 is explicit that RLS is defence in depth rather than the active
 * boundary, so the middleware IS the protection on employment-law-sensitive
 * material, and both executives are admins.
 */
export default async function PersonnelPage() {
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? false
  const data = await loadPersonnelPage()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-900/40">
          <Users size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Personnel register</h1>
          <p className="text-sm text-muted-foreground">
            Who works here, who left and why, and the evidence that their access went away
          </p>
        </div>
      </div>

      <CompanySectionTabs active="people" showProfile={isAdmin} />

      <PersonnelRegister data={data} canEdit={isAdmin} />
    </div>
  )
}
