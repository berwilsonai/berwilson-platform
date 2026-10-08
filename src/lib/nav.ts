import {
  Radar,
  Gavel,
  LayoutDashboard,
  FolderKanban,
  Users,
  ListChecks,
  Activity,
  Brain,
  Shield,
  Lightbulb,
  Inbox,
  Target,
  UserCog,
  HeartPulse,
  Split,
  KeyRound,
  Map as MapIcon,
  HandCoins,
  Boxes,
  Factory,
  Wrench,
  type LucideIcon,
  Calculator,
  Ruler,
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
  /**
   * Hide this destination until its module holds data.
   *
   * A nav row for a module with nothing in it is a permanent invitation to a
   * dead end. Dino is the live case: the operating company is mid-acquisition,
   * so the module is real and will fill — hiding it until then beats deleting
   * work that is about to be needed, and it un-hides itself with no code change
   * the moment the first row lands.
   */
  hideWhenEmpty?: 'dino'
  /**
   * Substitute destination when the role can't access `href` but CAN access
   * this one (e.g. every role may view /company/structure while /company
   * stays admin-only). Consumers resolve it via `resolveNavItem`.
   */
  fallback?: { href: string; label: string }
}

/**
 * Resolve a nav item for a viewer: the item itself when its `href` is
 * allowed, its fallback destination when only that is allowed, else null.
 */
export function resolveNavItem(item: NavItem, allowed: (href: string) => boolean): NavItem | null {
  if (allowed(item.href)) return item
  if (item.fallback && allowed(item.fallback.href)) {
    return { ...item, href: item.fallback.href, label: item.fallback.label, title: item.fallback.label, alsoMatches: undefined }
  }
  return null
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/decide', label: 'Decide', title: 'Decide', icon: Gavel, group: 'primary', keywords: 'review queue approve confirm pending inbox decisions bids intake what needs me triage backlog', mobilePrimary: true, badge: 'review', alsoMatches: ['/review'] },
  { href: '/tasks', label: 'Tasks', title: 'Team Tasks', icon: ListChecks, group: 'primary', keywords: 'todo action items team workload capacity', mobilePrimary: true },
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'primary', keywords: 'home overview alerts urgent overdue attention', mobilePrimary: true, badge: 'attention' },
  { href: '/objectives', label: 'Objectives', icon: Target, group: 'primary', keywords: 'priorities goals strategy steering now soon possibly focus' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, group: 'primary', keywords: 'pipeline deals', mobilePrimary: true },
  { href: '/opportunities', label: 'Opportunities', icon: Lightbulb, group: 'primary', keywords: 'acquisitions partnerships jv mergers investments deals' },
  { href: '/leads', label: 'Leads', title: 'Inbound Leads', icon: Radar, group: 'intelligence', keywords: 'inbound bids invitations itb ifb rfp rfq solicitations plan room prospects enquiries info inbox scored triage' },
  { href: '/investors', label: 'Investors', icon: HandCoins, group: 'primary', keywords: 'capital raise fundraising equity spv commitments funding money lp' },
  // ⚠ NO `alsoMatches` FOR `/projects/*/vehicles`. `navItemActive` is per-item
  // with no dedupe, so claiming a path that already belongs to another item
  // lights two sidebar rows at once — and the reader believes the highlighted
  // one, which made a real destination read as a sub-view of the wrong queue
  // (§12, 10-03).
  { href: '/vehicles', label: 'Vehicles', title: 'Vehicles & Cap Tables', icon: Boxes, group: 'primary', keywords: 'spv spvs vehicles cap table captable holdco landco equity split ownership participants members llc capital committed funded raise structure who owns what' },
  { href: '/steel', label: 'Steel CRM', icon: Factory, group: 'primary', keywords: 'prefab steel sales deals quotes square feet sqft plant manufacturing buildings customers' },
  { href: '/dino', label: 'Dino', title: 'Dino Service Pros', icon: Wrench, group: 'primary', hideWhenEmpty: 'dino', keywords: 'dino service pros plumbing hvac mechanical revenue operating company internal trades payments' },
  { href: '/calc', label: 'Quick Calc', title: 'Quick Calc', icon: Calculator, group: 'intelligence', keywords: 'calculator economics deal size megawatts mw price per kwh kw-month lease rate capture margin fee npv escalator pue load factor scratchpad back of envelope how big is this quick math' },
  { href: '/map', label: 'Map', title: 'Project Map', icon: MapIcon, group: 'primary', keywords: 'map geography utah locations sites markers rail corridors presentation visualize' },
  { href: '/intel', label: 'Intel', icon: Brain, group: 'intelligence', keywords: 'ask query search ai agent calendar meetings', mobilePrimary: true, alsoMatches: ['/calendar'] },
  { href: '/intake', label: 'Intake', icon: Inbox, group: 'intelligence', keywords: 'email inbox ingest gmail sweep research proposal rfp upload document intake meeting notes minutes attendees follow-up transcript recap digest summarize read aloud understand', alsoMatches: ['/email-ingestion', '/proposals/intake', '/intake/meeting', '/intake/document'] },
  { href: '/contacts', label: 'Contacts & Vendors', title: 'Directory', icon: Users, group: 'directory', keywords: 'people parties rolodex directory contacts vendors', alsoMatches: ['/vendors'] },
  { href: '/company', label: 'Ber Wilson', icon: Shield, group: 'directory', keywords: 'company profile capabilities certs', fallback: { href: '/company/structure', label: 'Org Structure' } },
  { href: '/activity', label: 'Activity', icon: Activity, group: 'system', keywords: 'audit log history changes' },
  { href: '/settings/users', label: 'Users & Access', icon: UserCog, group: 'system', keywords: 'roles invite permissions team accounts' },
  { href: '/settings/economics', label: 'Benchmarks', title: 'Benchmark Library', icon: Ruler, group: 'system', keywords: 'benchmarks market rates lease rate cap rate powered land development cost per mw heat rate o&m comparables economics library sources provenance' },
  { href: '/settings/lead-categories', label: 'Lead Categories', icon: Split, group: 'system', keywords: 'routing lines of business trades lanes flooring plumbing hvac steel construction corporate handoff destinations categories where leads go' },
  { href: '/settings/security', label: 'Security', icon: KeyRound, group: 'system', keywords: 'mfa totp authenticator two factor 2fa protected confidential project password lock unlock step up code military classified' },
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
  // Developer Notes is reached from the sidebar footer button / mobile More,
  // not from the nav list — a feedback channel belongs beside the chrome, not
  // among the company's working surfaces.
  { href: '/dev-notes', title: 'Developer Notes' },
  { href: '/timeline', title: 'Timeline' },
  { href: '/vendors', title: 'Vendors & Contractors' },
  { href: '/calendar', title: 'Calendar' },
  { href: '/email-ingestion', title: 'Intake' },
  { href: '/company/structure', title: 'Ber Wilson — Structure' },
]

/** Palette-only rows (query-param destinations, secondary tabs). */
export const PALETTE_EXTRAS: { href: string; label: string; keywords: string }[] = [
  { href: '/dev-notes', label: 'Developer Notes', keywords: 'bug report feedback feature request issue broken problem suggestion improvement developer notes' },
  { href: '/timeline', label: 'Timeline', keywords: 'gantt schedule' },
  { href: '/contacts?tab=vendors', label: 'Vendors & Contractors', keywords: 'companies organizations subs partners entities' },
  { href: '/calendar', label: 'Calendar', keywords: 'schedule dates milestones meeting google gmail' },
  { href: '/intake?tab=proposal', label: 'Proposal Intake', keywords: 'ingest upload rfp document proposal' },
  { href: '/intake?tab=meeting', label: 'Meeting Notes', keywords: 'meeting minutes notes attendees follow-up transcript recap paste' },
  { href: '/company/structure', label: 'Org Structure', keywords: 'entity architecture chart divisions spv holdings leadership organization team' },
]

/** True when `pathname` belongs to `item` (exact, child path, or alsoMatches). */
/**
 * Is this nav item the one for `pathname`?
 *
 * ⚠ `alsoMatches` must only name paths that have NO nav item of their own.
 * /decide claimed /leads, /intake and /email-ingestion, all three of which are
 * their own destinations — so standing on /leads lit BOTH "Decide" and "Leads",
 * and a highlighted Decide is what a reader takes to mean "this is where I am".
 * Leads was in the sidebar the whole time and read as a sub-view of the queue.
 */
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
