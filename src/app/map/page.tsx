import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import type { MapProject } from '@/lib/map/types'
import MapPageClient from '@/components/map/MapPageClient'

export const metadata = { title: 'Map — Ber Wilson Intelligence' }

export default async function MapPage() {
  const supabase = createAdminClient()

  const [{ data: projects, error }, viewer] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    getViewer(),
  ])

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`)
  }

  const rows = (projects ?? []) as MapProject[]

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
      photoUrls={photoUrls}
      isAdmin={viewer?.isAdmin ?? true}
    />
  )
}
