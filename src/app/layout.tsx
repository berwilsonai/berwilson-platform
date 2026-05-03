import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import AppSidebar from "@/components/layout/AppSidebar"
import AppHeader from "@/components/layout/AppHeader"
import MobileNav from "@/components/layout/MobileNav"

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
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const headersList = await headers()
  const pathname = headersList.get('x-pathname') ?? ''
  const isLoginPage = pathname === '/login' || pathname.startsWith('/auth/')

  // Fetch user for the header email; the middleware already enforces auth.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Show shell on all app routes. Login page gets its own full-page layout.
  // Middleware guarantees no unauthenticated access reaches non-login routes.
  const showShell = !isLoginPage

  // Pending review count for sidebar badge — only needed when shell is visible.
  let pendingReviewCount = 0
  if (showShell) {
    const adminClient = createAdminClient()
    const { count } = await adminClient
      .from('review_queue')
      .select('id', { count: 'exact', head: true })
      .is('resolved_at', null)
    pendingReviewCount = count ?? 0
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground">
        {showShell ? (
          <div className="flex h-full">
            <AppSidebar pendingReviewCount={pendingReviewCount} />
            <div className="flex flex-1 flex-col min-w-0">
              <AppHeader email={user?.email ?? ""} />
              <main className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
                {children}
              </main>
            </div>
            <MobileNav pendingCount={pendingReviewCount} />
          </div>
        ) : (
          // Login and other auth pages render without the app shell
          children
        )}
      </body>
    </html>
  )
}
