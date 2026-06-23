import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import SiteTabBar from '@/components/portfolio/SiteTabBar'
import { SITE_STATUS_LABELS, SITE_STATUS_BADGE, BW_ROLE_LABELS, BW_ROLE_BADGE } from '@/lib/utils/constants'

export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: site } = await supabase
    .from('sites')
    .select('id, name, site_number, city, state, status, bw_role, is_lead_site, corridor:corridors(id, name, brand:brands(id, code, name))')
    .eq('id', id)
    .single()

  if (!site) notFound()

  const corridor = site.corridor as any
  const brand = corridor?.brand

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-muted-foreground">
        <Link href="/portfolio" className="hover:text-slate-900 dark:hover:text-foreground">Portfolio</Link>
        <span>/</span>
        {corridor && (
          <>
            <span className="text-slate-500 dark:text-muted-foreground">{corridor.name}</span>
            <span>/</span>
          </>
        )}
        <span className="text-slate-900 dark:text-foreground font-medium">{site.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            {site.site_number && (
              <span className="text-sm font-mono text-slate-400 dark:text-muted-foreground">Site {site.site_number}</span>
            )}
            <h1 className="text-2xl font-bold text-slate-900 dark:text-foreground truncate">{site.name}</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-muted-foreground mt-1">
            {[site.city, site.state].filter(Boolean).join(', ')}
            {brand && <span className="ml-2 text-slate-400 dark:text-muted-foreground">({brand.code})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {site.is_lead_site && (
            <span className="text-xs font-bold uppercase bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
              Lead Site
            </span>
          )}
          <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${SITE_STATUS_BADGE[site.status]}`}>
            {SITE_STATUS_LABELS[site.status]}
          </span>
          {site.bw_role && (
            <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${BW_ROLE_BADGE[site.bw_role as keyof typeof BW_ROLE_BADGE]}`}>
              {BW_ROLE_LABELS[site.bw_role as keyof typeof BW_ROLE_LABELS]}
            </span>
          )}
        </div>
      </div>

      <SiteTabBar siteId={id} />
      {children}
    </div>
  )
}
