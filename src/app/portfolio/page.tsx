import { createAdminClient } from '@/lib/supabase/admin'
import PortfolioKanban from '@/components/portfolio/PortfolioKanban'

export default async function PortfolioPage() {
  const supabase = createAdminClient()

  const [
    { data: sites },
    { data: corridors },
    { data: brands },
  ] = await Promise.all([
    supabase
      .from('sites')
      .select('*, corridor:corridors(id, name, brand:brands(id, code, name))')
      .order('site_number', { ascending: true, nullsFirst: false }),
    supabase.from('corridors').select('id, name').order('name'),
    supabase.from('brands').select('id, code, name').order('code'),
  ])

  // Get component counts and capital sums per site
  const siteIds = (sites ?? []).map(s => s.id)
  const { data: components } = await supabase
    .from('components')
    .select('site_id, capital_mid')
    .in('site_id', siteIds.length > 0 ? siteIds : ['00000000-0000-0000-0000-000000000000'])

  const componentStats = new Map<string, { count: number; totalCapital: number }>()
  for (const c of components ?? []) {
    const existing = componentStats.get(c.site_id) ?? { count: 0, totalCapital: 0 }
    existing.count++
    existing.totalCapital += Number(c.capital_mid ?? 0)
    componentStats.set(c.site_id, existing)
  }

  const enrichedSites = (sites ?? []).map(site => ({
    ...site,
    component_count: componentStats.get(site.id)?.count ?? 0,
    total_capital_mid: componentStats.get(site.id)?.totalCapital ?? null,
    corridor_name: (site.corridor as any)?.name ?? null,
    brand_code: (site.corridor as any)?.brand?.code ?? null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-200 dark:text-foreground">Portfolio</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-muted-foreground mt-1">
          33 sites across 11 states — Brand &rarr; Corridor &rarr; Site &rarr; Component
        </p>
      </div>
      <PortfolioKanban
        sites={enrichedSites}
        corridors={corridors ?? []}
        brands={brands ?? []}
      />
    </div>
  )
}
