import {
  LayoutDashboard,
  FolderKanban,
  Users,
  ListChecks,
  ClipboardCheck,
  Activity,
  Brain,
  Shield,
  Lightbulb,
  Inbox,
  Target,
  UserCog,
  HeartPulse,
  Map as MapIcon,
  HandCoins,
  type LucideIcon,
} from 'lucide-react'

/**
 * The single source of truth for app navigation. AppSidebar, AppHeader,
 * MobileNav, and CommandPalette all derive from this list — never redefine
 * destinations in a component. Role gating stays with each consumer
 * (`canAccessPage(role, href)` at render time); this module is pure data.
 */

export type NavGroup = 'primary' | 'intelligence' | 'directory' | 'system'
export type NavBadge = 'review' | 'attention'

export interface NavItem {
  href: string
  /** Sidebar / mobile label. */
  label: string
  /** Header + palette title when it differs from the label. */
  title?: string
  icon: LucideIcon
  group: NavGroup
  /** Command-palette search terms. */
  keywords: string
  /** Member of the mobile bottom tab bar. */
  mobilePrimary?: boolean
  badge?: NavBadge
  /** Extra path prefixes that should highlight this item as active. */
  alsoMatches?: string[]
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/tasks', label: 'Tasks', title: 'Team Tasks', icon: ListChecks, group: 'primary', keywords: 'todo action items team workload capacity', mobilePrimary: true },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'primary', keywords: 'home overview alerts urgent overdue attention', mobilePrimary: true, badge: 'attention' },
  { href: '/objectives', label: 'Objectives', icon: Target, group: 'primary', keywords: 'priorities goals strategy steering now soon possibly focus' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, group: 'primary', keywords: 'pipeline deals', mobilePrimary: true },
  { href: '/opportunities', label: 'Opportunities', icon: Lightbulb, group: 'primary', keywords: 'acquisitions partnerships jv mergers investments deals' },
  { href: '/investors', label: 'Investors', icon: HandCoins, group: 'primary', keywords: 'capital raise fundraising equity spv commitments funding money lp' },
  { href: '/map', label: 'Map', title: 'Project Map', icon: MapIcon, group: 'primary', keywords: 'map geography utah locations sites markers rail corridors presentation visualize' },
  { href: '/intel', label: 'Intel', icon: Brain, group: 'intelligence', keywords: 'ask query search ai agent calendar meetings', mobilePrimary: true, alsoMatches: ['/calendar'] },
  { href: '/intake', label: 'Intake', icon: Inbox, group: 'intelligence', keywords: 'email inbox ingest outlook sweep research proposal rfp upload document intake', alsoMatches: ['/email-ingestion', '/proposals/intake'] },
  { href: '/contacts', label: 'Contacts & Vendors', title: 'Directory', icon: Users, group: 'directory', keywords: 'people parties rolodex directory contacts vendors', alsoMatches: ['/vendors'] },
  { href: '/company', label: 'Ber Wilson', icon: Shield, group: 'directory', keywords: 'company profile capabilities certs' },
  { href: '/review', label: 'Review Queue', title: 'Review Queue', icon: ClipboardCheck, group: 'system', keywords: 'pending approve reject', mobilePrimary: true, badge: 'review' },
  { href: '/activity', label: 'Activity', icon: Activity, group: 'system', keywords: 'audit log history changes' },
  { href: '/settings/users', label: 'Users & Access', icon: UserCog, group: 'system', keywords: 'roles invite permissions team accounts' },
  { href: '/settings/health', label: 'System Health', icon: HeartPulse, group: 'system', keywords: 'status probes mailbox backups disk checks' },
]

/** Ordered sidebar groups (primary renders unlabeled). */
export const NAV_GROUP_ORDER: { group: NavGroup; label: string | null }[] = [
  { group: 'primary', label: null },
  { group: 'intelligence', label: 'Intelligence' },
  { group: 'directory', label: 'Directory' },
  { group: 'system', label: 'System' },
]

/** Title-only routes that aren't nav destinations. */
export const TITLE_EXTRAS: { href: string; title: string }[] = [
  { href: '/timeline', title: 'Timeline' },
  { href: '/vendors', title: 'Vendors & Contractors' },
  { href: '/calendar', title: 'Calendar' },
  { href: '/email-ingestion', title: 'Intake' },
  { href: '/company/structure', title: 'Ber Wilson — Structure' },
]

/** Palette-only rows (query-param destinations, secondary tabs). */
export const PALETTE_EXTRAS: { href: string; label: string; keywords: string }[] = [
  { href: '/timeline', label: 'Timeline', keywords: 'gantt schedule' },
  { href: '/contacts?tab=vendors', label: 'Vendors & Contractors', keywords: 'companies organizations subs partners entities' },
  { href: '/calendar', label: 'Calendar', keywords: 'schedule dates milestones meeting outlook' },
  { href: '/intake?tab=proposal', label: 'Proposal Intake', keywords: 'ingest upload rfp document proposal' },
  { href: '/company/structure', label: 'Org Structure', keywords: 'entity architecture chart divisions spv holdings leadership organization team' },
]

/** True when `pathname` belongs to `item` (exact, child path, or alsoMatches). */
export function navItemActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href || pathname.startsWith(item.href + '/')) return true
  return (item.alsoMatches ?? []).some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** Header title for a pathname (most specific href wins). */
export function pageTitle(pathname: string): string {
  const all: { href: string; title: string }[] = [
    ...NAV_ITEMS.map((i) => ({ href: i.href, title: i.title ?? i.label })),
    ...TITLE_EXTRAS,
  ]
  let best: { href: string; title: string } | null = null
  for (const entry of all) {
    if (pathname === entry.href || pathname.startsWith(entry.href + '/')) {
      if (!best || entry.href.length > best.href.length) best = entry
    }
  }
  return best?.title ?? 'Ber Wilson'
}
