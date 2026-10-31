import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"
import { countDecideItems } from '@/lib/decide/count'
import { countLeadsNeedingWork } from '@/lib/leads/count'
import { countAttention } from '@/lib/attention'
import ShortcutsOverlay from '@/components/layout/ShortcutsOverlay'
import { getViewer } from "@/lib/auth/viewer"
import { Toaster } from "sonner"
import AppSidebar from "@/components/layout/AppSidebar"
import AppHeader from "@/components/layout/AppHeader"
import MobileNav from "@/components/layout/MobileNav"
import MobileQuickUpload from "@/components/layout/MobileQuickUpload"
import AskBerAIDock from "@/components/agent/AskBerAIDock"
import DevNoteDock from "@/components/dev-notes/DevNoteDock"
import { countOpenDevNotes } from "@/lib/dev-notes/queries"
import { listCategories } from "@/lib/leads/categories"
import type { LeadLane } from "@/lib/utils/leads"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Ber Wilson Intelligence",
  description: "Executive Intelligence Platform",
  manifest: "/site.webmanifest",
  // iOS takes the home-screen icon from `apple-touch-icon`, never from the
  // manifest, so that link is what actually puts the black lockup on the
  // phone. No favicon.ico entry here: the app/favicon.ico file convention
  // emits its own link alongside this metadata rather than being replaced by
  // it, so listing it again just duplicates the tag.
  icons: {
    icon: [
      { url: "/icon-192x192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512x512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ber Wilson",
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Stops iOS Safari's auto-zoom when focusing inputs under 16px, which
  // shoved fixed-width controls (e.g. the chat send button) off-screen.
  // iOS still allows manual pinch-zoom regardless of this cap.
  maximumScale: 1,
  viewportFit: 'cover',
  /*
    ⚠ BOTH ENTRIES WERE `#1a1b2e` — a navy that appears nowhere in the Ber
    Wilson mark and nowhere in the palette, and that both themes shared, so the
    phone's browser chrome was the one surface the re-skin could not reach.
    These are the rail's own colour per theme now, read off `--sidebar`
    (hand-converted because a manifest cannot resolve a CSS variable).
  */
  themeColor: [
    // The rail's own colour per theme, hand-converted from `--sidebar`
    // (a manifest cannot resolve a CSS variable). Light moved with the rail
    // on 2026-10-27 — it was the dark slab's `#3a3027`, which on a phone put
    // a brown bar above a cream app.
    { media: '(prefers-color-scheme: light)', color: '#e6e1d6' },
    { media: '(prefers-color-scheme: dark)', color: '#211c17' },
  ],
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''
  const isLoginPage = pathname === '/login' || pathname.startsWith('/auth/')
  // Print views + the steel quote are standalone documents (print / save-as-PDF) — no app chrome.
  // `/steel/[id]/quote` used to be a chromeless printable page. It is now the
  // deal's Quotes surface — a normal page inside the app shell — and the PDF is
  // generated server-side rather than printed from the browser.
  const isPrintPage = pathname.endsWith('/print')

  // Resolve the signed-in user's role; the middleware already enforces auth
  // and section access — this drives what the shell renders.
  const viewer = await getViewer()
  const role = viewer?.role ?? 'member'
  const isAdmin = viewer?.isAdmin ?? false

  // Show shell on all app routes. Login page gets its own full-page layout.
  // Middleware guarantees no unauthenticated access reaches non-login routes.
  const showShell = !isLoginPage && !isPrintPage

  // Pending review count + attention count for sidebar badges — admin-only
  // surfaces, so skip the queries for everyone else.
  let pendingReviewCount = 0
  let attentionCount = 0
  // ⚠ ZERO IS ALSO WHAT A FAILED READ LEAVES BEHIND, and that is the right
  // default for a badge: no mark at all, rather than a number nobody can
  // reconcile with the page. `countLeadsNeedingWork` throws rather than
  // returning zeros for exactly this reason — the decision belongs here.
  let leadCounts = { open: 0, closingSoon: 0 }
  // Modules with nothing in them are hidden rather than shown as dead ends.
  const emptyModules: string[] = []
  // Open bug reports / feature requests. Admin-only, like the other sidebar
  // counts — it is the builder's queue, and a number nobody can act on is
  // decoration on everyone else's screen.
  let openDevNoteCount = 0
  // The trade divisions, nested under Leads in the sidebar. Read from the
  // routing registry rather than listed in nav.ts, so a new line of business
  // appears the moment someone adds the row (§12) — see LEAD_LANE_NOTE.
  let leadLanes: LeadLane[] = []
  if (showShell && isAdmin) {
    const adminClient = createAdminClient()
    const [decideCount, attention, leads, { count: dinoRows }, devNotes, categories] = await Promise.all([
      // The badge sits on Decide, so it counts what Decide holds — inbound
      // bids, staged correspondence AND flagged extractions, not the review
      // queue alone (which was a third of the page it pointed at).
      countDecideItems(),
      // One definition, shared with the dashboard's KPI tile. This used to be
      // three ad-hoc counts inlined here and they disagreed on screen — see
      // countAttention.
      countAttention(),
      // ⚠ THE BADGE THAT REPLACED THE DECIDE QUEUE'S LEAD ROWS (10-22). One
      // small query over the undecided leads — measured at 9 rows — so this is
      // not a cost worth caching the way the document lanes are.
      countLeadsNeedingWork().catch(() => ({ open: 0, closingSoon: 0 })),
      adminClient.from('dino_revenue').select('id', { count: 'exact', head: true }),
      countOpenDevNotes(),
      // Cached for 60s inside listCategories, so this is not a query per render.
      listCategories(),
    ])
    pendingReviewCount = decideCount
    attentionCount = attention
    leadCounts = leads
    if ((dinoRows ?? 0) === 0) emptyModules.push('dino')
    openDevNoteCount = devNotes
    // Handoff lanes only: the other destinations (project, opportunity, steel)
    // already have their own nav rows, and listing them twice would make the
    // menu two routes to one place.
    leadLanes = categories
      .filter((c) => c.active && c.destination === 'handoff')
      .map((c) => ({ key: c.key, label: c.label }))
  }

  return (
    <html
      lang="en"
      suppressHydrationWarning
      /*
        ⚠ `print:h-auto` ON BOTH, AND ON THE SHELL AND `<main>` BELOW — WITHOUT
        IT EVERY PDF THIS APP MAKES IS ONE PAGE LONG.

        The shell is a full-height flex column whose `<main>` is the scroller.
        On screen that is right: the chrome stays put and the content scrolls
        under it. In print it is fatal — Chrome lays out a `height: 100%` body
        as exactly one page and renders only the visible slice of an
        `overflow-y-auto` child, so everything below the fold is silently gone.
        The PDF opens perfectly and is a fragment.

        Measured 2026-10-31 by printing to PDF over the DevTools Protocol:
        `/reports/weekly/print` (45 open tasks across the team) and
        `/objectives/print` BOTH came out at 1 page, and had done since the
        shell took this shape. Four print routes shipped over four months and
        nobody printed one — §12: *"A listed route is not an answering one"*,
        and a screenshot cannot see this because the page scrolls fine.
      */
      className={`${geistSans.variable} ${geistMono.variable} h-full print:h-auto antialiased`}
    >
      <body className="h-full print:h-auto bg-background text-foreground">
        {/*
          ⚠ LIGHT IS THE DEFAULT AND THE SYSTEM PREFERENCE NO LONGER DECIDES
          (2026-10-27, Richard: *"It doesn't need to be dark themed"*).

          This used to fall back to `prefers-color-scheme`, so on a Mac set to
          dark — which both of these are — the app opened dark however it had
          been designed, and the light palette that the whole re-skin was
          measured in was the theme nobody ever saw. Dark mode still exists and
          is still tested; it is now something you CHOOSE in the user menu,
          which is what writes the key this reads. Only an explicit stored
          'dark' turns it on.
        */}
        <script
          dangerouslySetInnerHTML={{
            /*
              ⚠ DENSITY IS SET HERE WITH THE THEME, AND FOR THE SAME REASON.
              Both are stored per-reader and both decide layout before the
              first paint; reading either in an effect means the page renders
              once at the default and once again correctly, which is a visible
              jump on a 397-row list. One script, one try/catch — a blocked or
              cleared `localStorage` leaves both at their defaults rather than
              throwing before anything renders.
            */
            __html: `(function(){try{var d=document.documentElement;d.classList.toggle('dark',localStorage.getItem('theme')==='dark');var n=localStorage.getItem('density');if(n==='compact')d.dataset.density='compact';}catch(e){}})();`,
          }}
        />
        {showShell ? (
          <div className="flex h-full print:block print:h-auto">
            <AppSidebar pendingReviewCount={pendingReviewCount} attentionCount={attentionCount} leadCounts={leadCounts} openDevNoteCount={openDevNoteCount} role={role} emptyModules={emptyModules} leadLanes={leadLanes} />
            <div className="flex flex-1 flex-col min-w-0">
              <AppHeader email={viewer?.email ?? ""} role={role} />
              {/* ⚠ `print:overflow-visible` is the half that matters — see the
                  ⚠ on <html>. `animate-fade-in-up` is dropped for print too: a
                  transform mid-animation is what the print snapshot captures. */}
              <main className="flex-1 overflow-y-auto overflow-x-hidden p-5 sm:p-6 pb-24 md:pb-6 scrollbar-thin animate-fade-in-up print:overflow-visible print:h-auto print:p-0 print:animate-none">
                {children}
                {/* Mobile footer disclaimer */}
                <footer className="md:hidden mt-10 mb-2 pt-4 border-t border-border text-center">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Ber Wilson Intelligence — Confidential & Proprietary
                  </p>
                </footer>
              </main>
            </div>
            <MobileNav pendingCount={pendingReviewCount} role={role} emptyModules={emptyModules} />
            {/* `?` anywhere. Generated from the shortcut registry in src/lib/ui/docks.ts. */}
            <ShortcutsOverlay />
            {isAdmin && <MobileQuickUpload />}
            {isAdmin && <AskBerAIDock />}
            {/* Every role, deliberately — see DevNoteDock / AppSidebar. */}
            <DevNoteDock />
          </div>
        ) : (
          children
        )}
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: 'font-sans text-sm',
          }}
        />
      </body>
    </html>
  )
}
