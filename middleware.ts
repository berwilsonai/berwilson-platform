import { createServerClient } from '@supabase/ssr'
// Import from specific paths to avoid next/server.js loading ua-parser-js (__dirname issue on Vercel edge)
import { NextResponse } from 'next/dist/server/web/spec-extension/response'
import type { NextRequest } from 'next/dist/server/web/spec-extension/request'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — must be done before any redirect logic
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  const isPublicRoute =
    pathname === '/login' ||
    pathname.startsWith('/auth/confirm') ||
    pathname.startsWith('/auth/set-password') ||
    pathname === '/api/cron/risk-scores' ||         // Risk scoring cron job
    pathname.startsWith('/api/email/oauth/callback') // OAuth redirect from Microsoft (calendar auth)

  if (!user && !isPublicRoute) {
    // API calls must get a real 401 (not an HTML login-page redirect that fetch
    // silently follows as a 200 — that's what made expired-session saves fail
    // silently on long-lived mobile tabs). Page navigations still redirect.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect authenticated users away from /login
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/tasks'
    return NextResponse.redirect(url)
  }

  // Pass pathname to the layout so it can decide whether to show the app shell
  supabaseResponse.headers.set('x-pathname', request.nextUrl.pathname)
  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
