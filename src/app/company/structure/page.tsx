import type { Metadata } from 'next'
import { Network } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import CompanySectionTabs from '@/components/company/CompanySectionTabs'
import OrgStructureBoard from '@/components/company/OrgStructureBoard'

export const metadata: Metadata = {
  title: 'Org Structure — Ber Wilson Intelligence',
}

/**
 * The entity architecture chart — arms, divisions, SPVs, and people.
 * Viewable by every signed-in role (allowlisted in permissions.ts); editing is
 * admin-only, gated here via `canEdit` (the /api/org mutation routes enforce
 * it server-side too).
 */
export default async function CompanyStructurePage() {
  const viewer = await getViewer()
  const isAdmin = viewer?.isAdmin ?? false

  const supabase = createAdminClient()
  // Flat lists, joined client-side — no PostgREST embeds needed for a
  // single-FK hierarchy, and the DnD state wants flat arrays anyway.
  const [{ data: nodes }, { data: people }] = await Promise.all([
    supabase
      .from('org_nodes')
      .select('*')
      .order('sort_order')
      .order('created_at'),
    supabase
      .from('org_people')
      .select('*')
      .order('sort_order')
      .order('created_at'),
  ])

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-900/40 flex items-center justify-center shrink-0">
          <Network size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Entity Architecture</h1>
          <p className="text-sm text-muted-foreground">
            Holding structure, divisions, SPVs, and the team
          </p>
        </div>
      </div>

      <CompanySectionTabs active="structure" showProfile={isAdmin} />

      <OrgStructureBoard
        initialNodes={nodes ?? []}
        initialPeople={people ?? []}
        canEdit={isAdmin}
      />
    </div>
  )
}
