import type { ProjectSector } from '@/lib/supabase/types'

export const SECTOR_LABELS: Record<ProjectSector, string> = {
  government: 'Government',
  infrastructure: 'Infrastructure',
  real_estate: 'Real Estate',
  prefab: 'Prefab',
  institutional: 'Institutional',
}

export const SECTOR_SHORT: Record<ProjectSector, string> = {
  government: "Gov't",
  infrastructure: 'Infra',
  real_estate: 'Real Estate',
  prefab: 'Prefab',
  institutional: 'Institutional',
}

// Tailwind classes — dark-background friendly (works on white cards)
export const SECTOR_BADGE: Record<ProjectSector, string> = {
  government: 'bg-blue-50 text-blue-700 ring-blue-200',
  infrastructure: 'bg-amber-50 text-amber-700 ring-amber-200',
  real_estate: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  prefab: 'bg-violet-50 text-violet-700 ring-violet-200',
  institutional: 'bg-slate-100 text-slate-600 ring-slate-200',
}
