import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Newsreader } from "next/font/google"
import "./globals.css"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"
import { countDecideItems } from '@/lib/decide/count'
import { countAttention } from '@/lib/attention'
import { getViewer } from "@/lib/auth/viewer"
import { Toaster } from "sonner"
import AppSidebar from "@/components/layout/AppSidebar"
import AppHeader from "@/components/layout/AppHeader"
import MobileNav from "@/components/layout/MobileNav"
import MobileQuickUpload from "@/components/layout/MobileQuickUpload"
import AskBerAIDock from "@/components/agent/AskBerAIDock"
import DevNoteDock from "@/components/dev-notes/DevNoteDock"
import QuickCalcDock from "@/components/economics/QuickCalcDock"
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

// Display serif for h1s / dialog titles (see --font-heading in globals.css).
// Self-hosted by next/font at build time — no runtime request leaves the box.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal"],
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1a1b2e' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1b2e' },
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
    const [decideCount, attention, { count: dinoRows }, devNotes, categories] = await Promise.all([
      // The badge sits on Decide, so it counts what Decide holds — inbound
      // bids, staged correspondence AND flagged extractions, not the review
      // queue alone (which was a third of the page it pointed at).
      countDecideItems(),
      // One definition, shared with the dashboard's KPI tile. This used to be
      // three ad-hoc counts inlined here and they disagreed on screen — see
      // countAttention.
      countAttention(),
      adminClient.from('dino_revenue').select('id', { count: 'exact', head: true }),
      countOpenDevNotes(),
      // Cached for 60s inside listCategories, so this is not a query per render.
      listCategories(),
    ])
    pendingReviewCount = decideCount
    attentionCount = attention
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
      className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground">
        {/* Apply saved/system theme before paint to avoid a flash of the wrong color scheme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
        {showShell ? (
          <div className="flex h-full">
            <AppSidebar pendingReviewCount={pendingReviewCount} attentionCount={attentionCount} openDevNoteCount={openDevNoteCount} role={role} emptyModules={emptyModules} leadLanes={leadLanes} />
            <div className="flex flex-1 flex-col min-w-0">
              <AppHeader email={viewer?.email ?? ""} role={role} />
              <main className="flex-1 overflow-y-auto overflow-x-hidden p-5 sm:p-6 pb-24 md:pb-6 scrollbar-thin animate-fade-in-up">
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
            {isAdmin && <MobileQuickUpload />}
            {isAdmin && <AskBerAIDock />}
            {/* Reachable from any page with Cmd+/ or the header button. Stays
                mounted while closed so a half-entered calculation survives. */}
            {isAdmin && <QuickCalcDock />}
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
