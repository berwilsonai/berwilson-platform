import type { Metadata } from 'next'
import { Building2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import MediaGallery from '@/components/shared/MediaGallery'
import CompanyProfileClient from '@/components/company/CompanyProfileClient'
import CompanyKnowledgeBase from '@/components/company/CompanyKnowledgeBase'
import CompanySectionTabs from '@/components/company/CompanySectionTabs'
import {
  loadCompanyKnowledge,
  loadSetAsideCompanyDocuments,
  listFilingTargets,
} from '@/lib/documents/unfiled'

export const metadata: Metadata = {
  title: 'Company Profile — Ber Wilson Intelligence',
}

export default async function CompanyPage() {
  const supabase = createAdminClient()

  const [
    { data: profile },
    { data: certifications },
    { data: photos },
    companyDocs,
    setAside,
    filingTargets,
  ] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).single(),
    supabase
      .from('certifications')
      .select('*')
      .order('is_active', { ascending: false })
      .order('expiration_date', { ascending: true, nullsFirst: false })
      .order('name'),
    supabase
      .from('media')
      .select('*')
      .eq('is_company', true)
      .order('is_primary', { ascending: false })
      .order('sort_order')
      .order('created_at'),
    // Annotated with each document's retrieval footprint and, where one clears
    // the bar, the record it probably belongs on. The same pass backs the
    // /decide queue, so the two can never disagree about what is waiting.
    loadCompanyKnowledge(),
    loadSetAsideCompanyDocuments(),
    listFilingTargets(),
  ])

  if (!profile) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Company profile not found. Run the database migration.
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-900/40 flex items-center justify-center shrink-0">
          <Building2 size={20} className="text-slate-500 dark:text-slate-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{profile.legal_name}</h1>
          {profile.dba_name && (
            <p className="text-sm text-muted-foreground">dba {profile.dba_name}</p>
          )}
        </div>
      </div>

      {/* This route is admin-only, so both tabs always show */}
      <CompanySectionTabs active="profile" showProfile />

      {/* Photo gallery */}
      <section className="space-y-2">
        <h2 className="label-caps text-muted-foreground">
          Company Photos
        </h2>
        <MediaGallery
          initialPhotos={photos ?? []}
          scope={{ isCompany: true }}
        />
      </section>

      {/* Profile + Certs (client component) */}
      <CompanyProfileClient
        profile={profile}
        certifications={certifications ?? []}
      />

      {/* Knowledge base — Ber Wilson's own corpus, fed to Ber AI */}
      <CompanyKnowledgeBase
        documents={companyDocs}
        setAside={setAside}
        targets={filingTargets}
      />
    </div>
  )
}
