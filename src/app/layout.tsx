import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono, Newsreader } from "next/font/google"
import "./globals.css"
import { headers } from "next/headers"
import { createAdminClient } from "@/lib/supabase/admin"
import { getViewer } from "@/lib/auth/viewer"
import { Toaster } from "sonner"
import AppSidebar from "@/components/layout/AppSidebar"
import AppHeader from "@/components/layout/AppHeader"
import MobileNav from "@/components/layout/MobileNav"
import MobileQuickUpload from "@/components/layout/MobileQuickUpload"
import AskBerAIDock from "@/components/agent/AskBerAIDock"

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
  icons: {
    icon: "/icon-192x192.png",
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
  // Print views are standalone documents (for print / save-as-PDF) — no app chrome.
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
  if (showShell && isAdmin) {
    const adminClient = createAdminClient()
    const today = new Date().toISOString().split('T')[0]
    const [{ count: reviewCount }, { count: overdueMs }, { count: criticalDd }, { count: overdueTasks }] = await Promise.all([
      adminClient
        .from('review_queue')
        .select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
      adminClient
        .from('milestones')
        .select('id', { count: 'exact', head: true })
        .is('completed_at', null)
        .lt('target_date', today),
      adminClient
        .from('dd_items')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'resolved')
        .in('severity', ['critical', 'blocker']),
      adminClient
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .lt('due_date', today),
    ])
    pendingReviewCount = reviewCount ?? 0
    attentionCount = (overdueMs ?? 0) + (criticalDd ?? 0) + (overdueTasks ?? 0)
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
            <AppSidebar pendingReviewCount={pendingReviewCount} attentionCount={attentionCount} role={role} />
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
            <MobileNav pendingCount={pendingReviewCount} role={role} />
            {isAdmin && <MobileQuickUpload />}
            {isAdmin && <AskBerAIDock />}
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
