import Link from 'next/link'
import { LayoutGrid, Megaphone, Wallet, BarChart3, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The steel module's workspace tab bar — Pipeline · Marketing · Earnings
 * (· Commissions for financials users), with the module's primary action
 * (New Deal) pinned to the right. Rendered at the top of the three rep-facing
 * workspace pages so the module reads as one dedicated app rather than a page
 * with links hanging off it. Not a route-group layout on purpose: the chromeless
 * /steel/[id]/quote print view must not inherit any shell.
 */
export default function SteelWorkspaceTabs({
  active,
  showFinancials,
}: {
  active: 'pipeline' | 'marketing' | 'earnings' | 'commissions'
  showFinancials: boolean
}) {
  const tabs = [
    { key: 'pipeline' as const, href: '/steel', label: 'Pipeline', icon: LayoutGrid },
    { key: 'marketing' as const, href: '/steel/marketing', label: 'Marketing', icon: Megaphone },
    { key: 'earnings' as const, href: '/steel/earnings', label: 'My Earnings', icon: Wallet },
    ...(showFinancials
      ? [{ key: 'commissions' as const, href: '/steel/commissions', label: 'Commissions', icon: BarChart3 }]
      : []),
  ]

  return (
    <div className="flex items-end justify-between gap-3 border-b border-border">
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map(({ key, href, label, icon: Icon }) => (
          <Link
            key={key}
            href={href}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm font-medium whitespace-nowrap transition-colors',
              active === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={14} />
            {label}
          </Link>
        ))}
      </div>
      <Link
        href="/steel/new"
        className="mb-1.5 shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
      >
        <Plus size={14} />
        New Deal
      </Link>
    </div>
  )
}
