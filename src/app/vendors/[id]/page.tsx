import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Building2,
  ChevronLeft,
  CheckCircle2,
  ExternalLink,
  Globe,
  MapPin,
  Star,
  Tag,
} from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import VendorProfileClient from '@/components/vendors/VendorProfileClient'

export const metadata = { title: 'Vendor Profile — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function VendorDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: entity } = await supabase
    .from('entities')
    .select('*')
    .eq('id', id)
    .single()

  if (!entity) notFound()

  // Fetch project links with project names
  const { data: projectLinks } = await supabase
    .from('entity_projects')
    .select('id, relationship, equity_pct, notes, projects(id, name, status, sector)')
    .eq('entity_id', id)
    .order('created_at', { ascending: false })

  // Fetch reviews
  const { data: reviews } = await supabase
    .from('entity_reviews')
    .select('*, projects(id, name)')
    .eq('entity_id', id)
    .order('reviewed_at', { ascending: false })

  // Fetch primary contact if set
  let primaryContact: { id: string; full_name: string; email: string | null; phone: string | null; title: string | null } | null = null
  if (entity.primary_contact_id) {
    const { data } = await supabase
      .from('parties')
      .select('id, full_name, email, phone, title')
      .eq('id', entity.primary_contact_id)
      .single()
    primaryContact = data
  }

  // Fetch all projects for the review form dropdown
  const { data: allProjects } = await supabase
    .from('projects')
    .select('id, name')
    .order('name')

  // Calculate average rating
  const avgRating = reviews && reviews.length > 0
    ? reviews.reduce((sum, r) => sum + Number(r.rating), 0) / reviews.length
    : null

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/vendors"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft size={14} />
        All Vendors
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        {entity.logo_url ? (
          <img
            src={entity.logo_url}
            alt=""
            className="w-14 h-14 rounded-lg object-contain bg-muted shrink-0"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Building2 size={24} className="text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{entity.name}</h1>
            <span className="px-2 py-0.5 rounded bg-muted text-[10px] font-medium text-muted-foreground uppercase">
              {entity.entity_type}
            </span>
          </div>
          {entity.headquarters && (
            <div className="flex items-center gap-1 mt-1">
              <MapPin size={12} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{entity.headquarters}</span>
            </div>
          )}
          {entity.website_url && (
            <a
              href={entity.website_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:underline"
            >
              <Globe size={11} />
              {entity.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              <ExternalLink size={10} />
            </a>
          )}
        </div>

        {/* Scores */}
        <div className="flex items-center gap-4 shrink-0">
          {entity.quality_score && (
            <div className="text-center">
              <div className="flex items-center gap-1">
                <Star size={14} className="text-amber-500 fill-amber-500" />
                <span className="text-lg font-semibold">{Number(entity.quality_score).toFixed(1)}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Your Rating</span>
            </div>
          )}
          {avgRating !== null && (
            <div className="text-center">
              <div className="flex items-center gap-1">
                <Star size={14} className="text-blue-500 fill-blue-500" />
                <span className="text-lg font-semibold">{avgRating.toFixed(1)}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                Track Record ({reviews?.length ?? 0})
              </span>
            </div>
          )}
          {entity.confidence_score && (
            <div className="text-center">
              <div className="flex items-center gap-1">
                <CheckCircle2 size={14} className="text-green-500" />
                <span className="text-lg font-semibold">{Number(entity.confidence_score).toFixed(1)}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Confidence</span>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {entity.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{entity.description}</p>
      )}

      {/* Specialties */}
      {entity.specialties && (entity.specialties as string[]).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(entity.specialties as string[]).map((s: string) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs text-muted-foreground"
            >
              <Tag size={10} />
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Client-side interactive sections */}
      <VendorProfileClient
        entity={entity}
        projectLinks={projectLinks ?? []}
        reviews={reviews ?? []}
        primaryContact={primaryContact}
        allProjects={allProjects ?? []}
      />
    </div>
  )
}
