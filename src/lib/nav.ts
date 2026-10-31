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
  TriangleAlert,
  UserCog,
  HeartPulse,
  Split,
  KeyRound,
  Map as MapIcon,
  HandCoins,
  Factory,
  Wrench,
  type LucideIcon,
  Handshake,
  BarChart3,
} from 'lucide-react'

/**
 * The single source of truth for app navigation. AppSidebar, AppHeader,
 * MobileNav, and CommandPalette all derive from this list — never redefine
 * destinations in a component. Role gating stays with each consumer
 * (`canAccessPage(role, href)` at render time); this module is pure data.
 */

/**
 * ⚠ `primary` WAS 13 UNLABELLED ITEMS AND IT WAS THE WORST THING IN THE NAV.
 * It mixed daily triage (Decide, Tasks, Commitments), portfolio records
 * (Projects, Opportunities, Investors), two whole business units
 * (Steel, Dino), a strategy board and a map — thirteen undifferentiated rows,
 * well past scannable, while the three groups that WERE labelled were the three
 * small ones. Split 2026-10-17 into four labelled groups by what a row is FOR,
 * not by how important it is.
 */
export type NavGroup = 'triage' | 'records' | 'units' | 'intelligence' | 'directory' | 'system'
/**
 * ⚠ A MEMBER HERE IS A PROMISE THE LAYOUT MUST KEEP. `badgeCounts` in
 * AppSidebar is typed `Record<NavBadge, number>` precisely so adding a member
 * makes `tsc` name every surface that has to supply it — the sidebar, the
 * collapsed rail and the mobile bar. A badge keyed by a string nobody fills
 * renders a silent zero, which is the §12 shape where a count and the page it
 * points at drift apart with nothing reporting it.
 */
export type NavBadge = 'review' | 'attention' | 'leads'

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
  /*
    ⚠ FIRST, AND CALLED "Home", SINCE 2026-10-29 — BECAUSE IT IS NOW WHERE `/`
    LANDS. It sat fifth in this group as "Dashboard" while the app opened on
    /tasks, so the row a reader reaches for to get back to the top of the
    morning read was below four queues, under a name that says "a page of
    charts" rather than "where I started". `DEFAULT_LANDING` in
    lib/auth/permissions.ts is the other half of this change.
  */
  { href: '/dashboard', label: 'Home', title: 'Dashboard', icon: LayoutDashboard, group: 'triage', keywords: 'home dashboard overview alerts urgent overdue portfolio pipeline morning read start ask ber ai', mobilePrimary: true },
  { href: '/decide', label: 'Decide', title: 'Decide', icon: Gavel, group: 'triage', keywords: 'review queue approve confirm pending inbox decisions bids intake what needs me triage backlog', mobilePrimary: true, badge: 'review', alsoMatches: ['/review', '/documents/unfiled'] },
  // ⚠ THE ATTENTION BADGE MOVED HERE FROM /dashboard (10-17). It had always
  // counted `countAttention()`, so a reader saw a number next to "Dashboard"
  // and had no way to reach the thing it counted — the dashboard rail showed a
  // truncated, unranked slice of it and nothing showed item number seven. The
  // badge and the list it names are now the same destination, and both read the
  // same registry, so they cannot come to disagree.
  { href: '/attention', label: 'Attention', title: 'Attention', icon: TriangleAlert, group: 'triage', keywords: 'attention urgent overdue stale slipping cracks falling through needs me what needs my attention ranked urgency milestones diligence compliance waiting on decisions adrift dependency risk', badge: 'attention' },
  { href: '/tasks', label: 'Tasks', title: 'Team Tasks', icon: ListChecks, group: 'triage', keywords: 'todo action items team workload capacity', mobilePrimary: true },
  // ⚠ NO `alsoMatches` FOR `/s/*`. That is the settle landing page reached from
  // Pepper's note, it is deliberately outside the app chrome, and claiming it
  // here would light this row for a page that has no sidebar at all.
  { href: '/commitments', label: 'Commitments', title: 'Commitment Ledger', icon: Handshake, group: 'triage', keywords: 'commitments obligations promises owed waiting on follow up chase ledger settle done snooze correspondence who owes what undated' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, group: 'records', keywords: 'pipeline deals', mobilePrimary: true },
  { href: '/opportunities', label: 'Opportunities', icon: Lightbulb, group: 'records', keywords: 'acquisitions partnerships jv mergers investments deals' },
  // ⚠ THE BADGE IS NOT DECORATION — IT IS WHAT MAKES /leads A DESTINATION.
  // Until 10-22 inbound leads were ALSO rendered on /decide, so the Decide
  // badge was the only thing that ever said a bid invitation had arrived.
  // Richard took them off that page (*"all scrapings from info@berwilson to
  // land and be worked from within the leads section"*), which left this row a
  // plain unmarked link to a queue nobody would be told about — and a bid date
  // is a hard deadline: two of the nine open leads closed the day of the
  // change. `countLeadsNeedingWork` feeds it, and carries `closingSoon` so the
  // urgency /decide's deadline ranking used to supply did not go with the rows.
  { href: '/leads', label: 'Leads', title: 'Inbound Leads', icon: Radar, group: 'records', keywords: 'inbound bids invitations itb ifb rfp rfq solicitations plan room prospects enquiries info inbox scored triage', badge: 'leads' },
  { href: '/investors', label: 'Investors', icon: HandCoins, group: 'records', keywords: 'capital raise fundraising equity commitments funding money lp' },
  { href: '/objectives', label: 'Objectives', icon: Target, group: 'records', keywords: 'priorities goals strategy steering now soon possibly focus' },
  /*
    ⚠ IN `records`, NOT `intelligence`, AND NOT UNDER `system`. A report is a
    view of the portfolio, so it belongs beside the records it reads — and the
    one thing that would make it unfindable is filing it with the settings. The
    `alsoMatches` claim is deliberately ABSENT: /reports owns every path under
    itself, and §12 is explicit that `alsoMatches` may only name paths with no
    nav item of their own.
  */
  { href: '/reports', label: 'Reports', title: 'Reports', icon: BarChart3, group: 'records', keywords: 'report export excel xlsx spreadsheet pdf print pipeline summary megawatts capacity ramp data room readiness deal team relationships activity quiet branded letterhead share send board investor lender download' },
  { href: '/map', label: 'Map', title: 'Project Map', icon: MapIcon, group: 'records', keywords: 'map geography utah locations sites markers rail corridors presentation visualize' },
  { href: '/steel', label: 'Steel CRM', icon: Factory, group: 'units', keywords: 'prefab steel sales deals quotes square feet sqft plant manufacturing buildings customers' },
  { href: '/dino', label: 'Dino', title: 'Dino Service Pros', icon: Wrench, group: 'units', hideWhenEmpty: 'dino', keywords: 'dino service pros plumbing hvac mechanical revenue operating company internal trades payments' },
  { href: '/intel', label: 'Intel', icon: Brain, group: 'intelligence', keywords: 'ask query search ai agent calendar meetings', mobilePrimary: true, alsoMatches: ['/calendar'] },
  { href: '/jobs', label: 'Jobs', icon: ListChecks, group: 'intelligence', keywords: 'task job work assistant scrub audit bulk clean up go through find fix propose changes batch one-off ad hoc anything' },
  { href: '/intake', label: 'Intake', icon: Inbox, group: 'intelligence', keywords: 'email inbox ingest gmail sweep research proposal rfp upload document intake meeting notes minutes attendees follow-up transcript recap digest summarize read aloud understand', alsoMatches: ['/email-ingestion', '/proposals/intake', '/intake/meeting', '/intake/document'] },
  { href: '/contacts', label: 'Contacts & Vendors', title: 'Directory', icon: Users, group: 'directory', keywords: 'people parties rolodex directory contacts vendors', alsoMatches: ['/vendors'] },
  { href: '/company', label: 'Ber Wilson', icon: Shield, group: 'directory', keywords: 'company profile capabilities certs', fallback: { href: '/company/structure', label: 'Org Structure' } },
  { href: '/activity', label: 'Activity', icon: Activity, group: 'system', keywords: 'audit log history changes' },
  { href: '/settings/users', label: 'Users & Access', icon: UserCog, group: 'system', keywords: 'roles invite permissions team accounts' },
  { href: '/settings/lead-categories', label: 'Lead Categories', icon: Split, group: 'system', keywords: 'routing lines of business trades lanes flooring plumbing hvac steel construction corporate handoff destinations categories where leads go' },
  { href: '/settings/security', label: 'Security', icon: KeyRound, group: 'system', keywords: 'mfa totp authenticator two factor 2fa protected confidential project password lock unlock step up code military classified' },
  { href: '/settings/health', label: 'System Health', icon: HeartPulse, group: 'system', keywords: 'status probes mailbox backups disk checks' },
]

/** Ordered sidebar groups (primary renders unlabeled). */
/**
 * Ordered sidebar groups. Every group is LABELLED now — an unlabelled block is
 * only readable while it is short, and `primary` had reached thirteen rows.
 *
 * The order is the reading order: what needs you today, then the portfolio you
 * steer, then the operating companies, then the tools you reach for. `system`
 * stays out of the list entirely and lives behind the gear at the bottom.
 */
export const NAV_GROUP_ORDER: { group: NavGroup; label: string | null }[] = [
  { group: 'triage', label: 'Today' },
  { group: 'records', label: 'Pipeline' },
  { group: 'units', label: 'Divisions' },
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
  /*
    ⚠ THESE FOUR READ "Ber Wilson" UNTIL 2026-10-27, which is the /company nav
    LABEL — so the locator named the company profile while you stood on a
    governance register. They are real destinations (§13) reached from the
    tabs on /company, not from the nav list, so nothing gave them a title.
    Each matches the `<h1>` the page itself renders.
  */
  { href: '/company/board', title: 'Board & Governance' },
  { href: '/company/people', title: 'Personnel register' },
  { href: '/company/governance', title: 'Corporate record' },
  { href: '/company/compliance', title: 'Compliance register' },
  // Reached from the Directory's role chips; a PALETTE_EXTRAS row already
  // names it, and that list is not read for titles.
  { href: '/settings/contact-roles', title: 'Contact Roles' },
  // The style guide. URL-only and in no nav group on purpose: it is the
  // instrument for checking the interface, not one of the company's working
  // surfaces. Admin-only by the /settings prefix.
  { href: '/settings/ui', title: 'Interface' },
]

/** Palette-only rows (query-param destinations, secondary tabs). */
export const PALETTE_EXTRAS: { href: string; label: string; keywords: string }[] = [
  { href: '/dev-notes', label: 'Developer Notes', keywords: 'bug report feedback feature request issue broken problem suggestion improvement developer notes' },
  { href: '/timeline', label: 'Timeline', keywords: 'gantt schedule' },
  // The Vendors tab retired 2026-10-21 — its five rows moved into `parties`.
  // The palette entry stays, pointing at the one directory, because "vendors"
  // and "subs" are words a reader still types.
  { href: '/contacts', label: 'Vendors & Contractors', keywords: 'companies organizations subs partners entities vendor contractor' },
  { href: '/settings/contact-roles', label: 'Contact Roles', keywords: 'role lender investor advisor endorser general contractor registry taxonomy directory' },
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

/**
 * Header title for a pathname (most specific href wins).
 *
 * ⚠ IT READS `alsoMatches`, AND IT DID NOT UNTIL 2026-10-27. `navItemActive`
 * has always read it, so standing on /review lit the Decide row in the sidebar
 * while the header said "Ber Wilson" — the same path, two modules, two
 * answers. /review, /documents/unfiled and /proposals/intake all landed on the
 * fallback for that reason.
 *
 * ⚠ AND THE FALLBACK IS NO LONGER A REAL DESTINATION'S NAME. It was
 * 'Ber Wilson', which is the /company nav label, so an unknown path — a 404,
 * since this renders inside the app shell — produced a locator pointing at a
 * page the reader was not on. `TITLE_EXTRAS` plus the assertion in
 * `nav.test.ts` mean a route that reaches this string is a route somebody
 * forgot to title, and 'Not found' says so loudly rather than quietly.
 */
export function pageTitle(pathname: string): string {
  const matches = (href: string) => pathname === href || pathname.startsWith(href + '/')
  // An item's own href beats one of its `alsoMatches` at equal length, so the
  // claimed path's real owner wins where both exist.
  const all: { href: string; title: string; claimed?: true }[] = [
    ...NAV_ITEMS.map((i) => ({ href: i.href, title: i.title ?? i.label })),
    ...NAV_ITEMS.flatMap((i) =>
      (i.alsoMatches ?? []).map((href) => ({ href, title: i.title ?? i.label, claimed: true as const }))
    ),
    ...TITLE_EXTRAS,
  ]
  let best: { href: string; title: string; claimed?: true } | null = null
  for (const entry of all) {
    if (!matches(entry.href)) continue
    if (!best) { best = entry; continue }
    if (entry.href.length > best.href.length) best = entry
    else if (entry.href.length === best.href.length && best.claimed && !entry.claimed) best = entry
  }
  return best?.title ?? 'Not found'
}
