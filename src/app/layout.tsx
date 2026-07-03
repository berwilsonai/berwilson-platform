import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
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
  const isSharePage = pathname.startsWith('/equity/share/')

  // Fetch user for the header email; the middleware already enforces auth.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Show shell on all app routes. Login page gets its own full-page layout.
  // Middleware guarantees no unauthenticated access reaches non-login routes.
  const showShell = !isLoginPage && !isSharePage

  // Pending review count + attention count for sidebar badges — only needed when shell is visible.
  let pendingReviewCount = 0
  let attentionCount = 0
  if (showShell) {
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground">
        {/* Apply saved/system theme before paint to avoid a flash of the wrong color scheme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{document.documentElement.classList.toggle('dark',localStorage.getItem('theme')==='dark');}catch(e){}})();`,
          }}
        />
        {showShell ? (
          <div className="flex h-full">
            <AppSidebar pendingReviewCount={pendingReviewCount} attentionCount={attentionCount} />
            <div className="flex flex-1 flex-col min-w-0">
              <AppHeader email={user?.email ?? ""} />
              <main className="flex-1 overflow-y-auto overflow-x-hidden p-5 sm:p-6 pb-24 md:pb-6 scrollbar-thin animate-fade-in-up bg-depth">
                {children}
                {/* Mobile footer disclaimer */}
                <footer className="md:hidden mt-10 mb-2 pt-4 border-t border-border text-center">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    Ber Wilson Intelligence — Confidential & Proprietary
                  </p>
                </footer>
              </main>
            </div>
            <MobileNav pendingCount={pendingReviewCount} />
            <MobileQuickUpload />
            <AskBerAIDock />
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
