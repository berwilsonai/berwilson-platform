import type { Metadata } from 'next'
import { Building2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import MediaGallery from '@/components/shared/MediaGallery'
import { PageHeader } from '@/components/ui/page-header'
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
    <div className="max-w-4xl space-y-8">
      <PageHeader
        icon={Building2}
        title={profile.legal_name}
        description={profile.dba_name ? `dba ${profile.dba_name}` : undefined}
        className="mb-0"
      >
        {/* This route is admin-only, so both tabs always show */}
        <CompanySectionTabs active="profile" showProfile />
      </PageHeader>

      {/* Profile + Certs (client component) */}
      <CompanyProfileClient
        profile={profile}
        certifications={certifications ?? []}
      />

      {/*
        ⚠ THE PHOTO DROPZONE USED TO BE THE FIRST THING ON THIS PAGE. An empty
        80px "Add photos" rectangle opened the company's own profile, above its
        legal name, its address and everything a reader comes here for — the
        most prominent element on the screen was an invitation to fill in
        something nobody had asked for. It belongs below the record it
        illustrates: a surface hidden because it is empty is hidden exactly
        when someone needs to fill it (§12), so it still renders, just not
        first.
      */}
      <section className="space-y-2">
        <h2 className="label-caps text-muted-foreground">Company Photos</h2>
        <MediaGallery initialPhotos={photos ?? []} scope={{ isCompany: true }} />
      </section>

      {/* Knowledge base — Ber Wilson's own corpus, fed to Ber AI */}
      <CompanyKnowledgeBase
        documents={companyDocs}
        setAside={setAside}
        targets={filingTargets}
      />
    </div>
  )
}
