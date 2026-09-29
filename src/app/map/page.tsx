import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import type { MapProject, MapParcel } from '@/lib/map/types'
import { getAllDrawableParcels } from '@/lib/parcels/queries'
import MapPageClient from '@/components/map/MapPageClient'

export const metadata = { title: 'Map — Ber Wilson Intelligence' }

interface MapPageProps {
  searchParams: Promise<{ project?: string }>
}

export default async function MapPage({ searchParams }: MapPageProps) {
  const { project: initialProjectId } = await searchParams
  const supabase = createAdminClient()

  const [{ data: projects, error }, viewer, parcelRows] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    getViewer(),
    getAllDrawableParcels(),
  ])

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`)
  }

  const rows = (projects ?? []) as MapProject[]

  // Narrowed to what the map draws — see MapParcel. An excluded parcel is
  // deliberately dropped: it was considered and is not part of the deal, and
  // drawing it would overstate the assemblage to anyone reading the screen.
  const parcels: MapParcel[] = parcelRows
    .filter((p) => p.status !== 'excluded' && p.geometry && p.project_id)
    .map((p) => ({
      id: p.id,
      projectId: p.project_id!,
      parcelId: p.parcel_id,
      label: p.label,
      acres: p.acres != null ? Number(p.acres) : null,
      color: p.color,
      geometry: p.geometry!,
    }))

  // Photos for the detail sheet (media bucket is public-URL based)
  const photoUrls: Record<string, string[]> = {}
  const ids = rows.map((p) => p.id)
  if (ids.length > 0) {
    const { data: media } = await supabase
      .from('media')
      .select('project_id, storage_path, is_primary, sort_order, created_at')
      .in('project_id', ids)
      .order('is_primary', { ascending: false })
      .order('sort_order')
      .order('created_at')
    for (const m of media ?? []) {
      if (!m.project_id || !m.storage_path) continue
      const { data } = supabase.storage.from('media').getPublicUrl(m.storage_path)
      ;(photoUrls[m.project_id] ??= []).push(data.publicUrl)
    }
  }

  return (
    <MapPageClient
      projects={rows}
      parcels={parcels}
      photoUrls={photoUrls}
      isAdmin={viewer?.isAdmin ?? true}
      initialProjectId={initialProjectId ?? null}
    />
  )
}
