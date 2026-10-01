import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import type { MapProject, MapParcel } from '@/lib/map/types'
import { getAllDrawableParcels } from '@/lib/parcels/queries'
import MapPageClient from '@/components/map/MapPageClient'
import { dropHidden } from '@/lib/security/confidential'
import { viewerHiddenProjectIds } from '@/lib/security/request'

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

  // Protected projects are not placed on the map, and neither are their
  // parcels. A pin plus a parcel boundary is the project's LOCATION — the one
  // attribute a military site most obviously should not publish to a screen
  // anyone can walk past.
  const hidden = await viewerHiddenProjectIds()
  const rows = dropHidden((projects ?? []) as MapProject[], (p) => p.id, hidden)

  // Narrowed to what the map draws — see MapParcel. An excluded parcel is
  // deliberately dropped: it was considered and is not part of the deal, and
  // drawing it would overstate the assemblage to anyone reading the screen.
  const parcels: MapParcel[] = parcelRows
    .filter((p) => p.status !== 'excluded' && p.geometry && p.project_id)
    .filter((p) => !hidden.has(p.project_id!))
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
