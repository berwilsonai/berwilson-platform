import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Building2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import VendorsClient from '@/components/vendors/VendorsClient'
import type { VendorWithStats } from '@/components/vendors/VendorsClient'
import EmptyState from '@/components/shared/EmptyState'

export const metadata = { title: 'Vendors & Partners — Ber Wilson Intelligence' }

export default async function VendorsPage() {
  const supabase = createAdminClient()
  // Cast to bypass generated types — new columns added via migration
  const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient

  // Fetch all entities with their project relationships and reviews
  const { data: entities, error } = await db
    .from('entities')
    .select(`
      id, name, entity_type, jurisdiction, website_url, description,
      specialties, quality_score, confidence_score, headquarters,
      logo_url, enriched_at,
      entity_projects(id, project_id, relationship),
      entity_reviews(id, rating)
    `)
    .order('name')

  if (error) throw new Error(`Failed to load vendors: ${error.message}`)

  const vendors: VendorWithStats[] = (entities ?? []).map(e => {
    const projects = (e.entity_projects as Array<{
      id: string
      project_id: string
      relationship: string
    }>) ?? []
    const reviews = (e.entity_reviews as Array<{
      id: string
      rating: number
    }>) ?? []

    const avgRating = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length
      : null

    return {
      id: e.id,
      name: e.name,
      entity_type: e.entity_type,
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
      review_count: reviews.length,
      avg_rating: avgRating,
      relationships: [...new Set(projects.map(p => p.relationship))],
    }
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-lg font-semibold">Vendors & Partners</h1>
        <Link
          href="/vendors/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          Add Vendor
        </Link>
      </div>

      {vendors.length === 0 ? (
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
