import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Users, Building2, Clock } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import ContactsClient from '@/components/contacts/ContactsClient'
import type { ContactWithStats } from '@/components/contacts/ContactsClient'
import VendorsClient from '@/components/vendors/VendorsClient'
import type { VendorWithStats } from '@/components/vendors/VendorsClient'
import EmptyState from '@/components/shared/EmptyState'

export const metadata = { title: 'Directory — Ber Wilson Intelligence' }

// One directory destination: Contacts (parties — people & firms) and
// Vendors & Contractors (entities) as tabs. The old /vendors list redirects here.

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export default async function DirectoryPage({ searchParams }: PageProps) {
  const { tab } = await searchParams
  const activeTab: 'contacts' | 'vendors' = tab === 'vendors' ? 'vendors' : 'contacts'

  const supabase = createAdminClient()
  // Cast to bypass generated types — parties.status / entities.category added via migration
  const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient

  const [{ data: parties, error: partiesError }, { count: pendingCount }, { data: entities, error: entitiesError }] =
    await Promise.all([
      db
        .from('parties')
        .select(`
          id, full_name, company, title, email, phone, is_organization, avatar_url,
          project_players(project_id, role, projects(updated_at))
        `)
        .eq('status', 'active')
        .order('full_name'),
      db
        .from('parties')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_review'),
      db
        .from('entities')
        .select(`
          id, name, entity_type, category, jurisdiction, website_url, description,
          specialties, quality_score, confidence_score, headquarters,
          logo_url, enriched_at,
          entity_projects(id, project_id, relationship)
        `)
        .order('name'),
    ])

  if (partiesError) throw new Error(`Failed to load contacts: ${partiesError.message}`)
  if (entitiesError) throw new Error(`Failed to load vendors: ${entitiesError.message}`)

  const contacts: ContactWithStats[] = (parties ?? []).map(p => {
    const players = (p.project_players as unknown as Array<{
      project_id: string
      role: string
      projects: { updated_at: string | null } | null
    }>) ?? []

    return {
      id: p.id,
      full_name: p.full_name,
      company: p.company,
      title: p.title,
      email: p.email,
      phone: p.phone,
      is_organization: p.is_organization,
      avatar_url: p.avatar_url ?? null,
      project_count: players.length,
      roles: [...new Set(players.map(pp => pp.role))],
      last_active: players.reduce<string | null>((max, pp) => {
        const d = pp.projects?.updated_at ?? null
        if (!d) return max
        return !max || d > max ? d : max
      }, null),
    }
  })

  const vendors: VendorWithStats[] = (entities ?? []).map(e => {
    const projects = (e.entity_projects as Array<{
      id: string
      project_id: string
      relationship: string
    }>) ?? []
    return {
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
      category: (e as { category?: VendorWithStats['category'] }).category ?? 'vendor',
      jurisdiction: e.jurisdiction,
      website_url: e.website_url,
      description: e.description,
      specialties: (e.specialties as string[]) ?? [],
      quality_score: e.quality_score ? Number(e.quality_score) : null,
      confidence_score: e.confidence_score ? Number(e.confidence_score) : null,
      headquarters: e.headquarters,
      logo_url: e.logo_url,
      enriched_at: e.enriched_at,
      project_count: projects.length,
      relationships: [...new Set(projects.map(p => p.relationship))],
    }
  })

  const tabs = [
    { key: 'contacts' as const, href: '/contacts', label: 'Contacts', icon: Users, count: contacts.length },
    { key: 'vendors' as const, href: '/contacts?tab=vendors', label: 'Vendors & Contractors', icon: Building2, count: vendors.length },
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold">Directory</h1>
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            {tabs.map(({ key, href, label, icon: Icon, count }) => (
              <Link
                key={key}
                href={href}
                className={cn(
                  'px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors',
                  key !== 'contacts' && 'border-l border-border',
                  activeTab === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted',
                )}
              >
                <Icon size={14} /> {label}
                <span className={cn('tabular-nums text-xs', activeTab === key ? 'text-primary-foreground/70' : 'text-muted-foreground/70')}>
                  {count}
                </span>
              </Link>
            ))}
          </div>
        </div>
        <Link
          href={activeTab === 'vendors' ? '/vendors/new' : '/contacts/new'}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          {activeTab === 'vendors' ? 'Add Vendor' : 'Add Contact'}
        </Link>
      </div>

      {activeTab === 'contacts' ? (
        <>
          {/* Pending contacts banner */}
          {(pendingCount ?? 0) > 0 && (
            <Link
              href="/review?reason=new_contact"
              className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-sm hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              <Clock size={15} className="shrink-0" />
              <span>
                <span className="font-semibold">{pendingCount} contact{pendingCount !== 1 ? 's' : ''} waiting for review</span>
                {' '}— auto-detected from email. Confirm they&apos;re real project contacts before they appear here.
              </span>
              <span className="ml-auto text-xs font-medium shrink-0">Review →</span>
            </Link>
          )}

          {contacts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No contacts yet"
              description="Add people and firms you work with to build your relationship directory."
              action={
                <Link
                  href="/contacts/new"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  <Plus size={14} />
                  Add Contact
                </Link>
              }
            />
          ) : (
            <Suspense>
              <ContactsClient contacts={contacts} />
            </Suspense>
          )}
        </>
      ) : vendors.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No vendors yet"
          description="Add vendors, subcontractors, and partners to build your directory. Link entities to projects with vendor relationships to see them here."
          action={
            <Link
              href="/vendors/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              Add Vendor
            </Link>
          }
        />
      ) : (
        <Suspense>
          <VendorsClient vendors={vendors} />
        </Suspense>
      )}
    </div>
  )
}
