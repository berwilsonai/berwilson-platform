import { createServerClient } from '@supabase/ssr'
// Import from specific paths to avoid next/server.js loading ua-parser-js (__dirname issue on Vercel edge)
import { NextResponse } from 'next/dist/server/web/spec-extension/response'
import type { NextRequest } from 'next/dist/server/web/spec-extension/request'
import { canAccessApi, canAccessPage, isRole, landingFor, type Role } from '@/lib/auth/permissions'
import {
  isLockExemptApiPath,
  isLockedPath,
  lockedPathFor,
  projectIdFromPath,
} from '@/lib/security/path'

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
    pathname === '/api/cron/risk-scores' ||         // Risk scoring cron job (self-guards via CRON_SECRET)
    pathname === '/api/cron/daily-brief' ||          // Daily brief cron job (self-guards via CRON_SECRET)
    pathname === '/api/cron/daily-digest' ||         // Daily email digest cron job (self-guards via CRON_SECRET)
    pathname === '/api/cron/email-sweep' ||          // Mailbox sweep cron job (self-guards via CRON_SECRET)
    pathname === '/api/cron/lead-sweep' ||           // Inbound lead sweep cron (self-guards via CRON_SECRET)
    pathname === '/api/cron/drive-sync' ||           // Drive knowledge sync cron (self-guards via CRON_SECRET)
    pathname === '/api/cron/drive-publish' ||        // Drive document publish cron (self-guards via CRON_SECRET)
    pathname === '/api/cron/contacts-sync' ||        // Directory → Google Contacts cron (self-guards via CRON_SECRET)
    pathname === '/api/cron/meet-import' ||          // Google Meet transcript import cron (self-guards via CRON_SECRET)
    pathname === '/api/cron/deal-intake' ||          // Website deal-form intake scan (self-guards via CRON_SECRET)
    pathname === '/api/cron/google-tasks' ||         // Task board <-> Google Tasks sync (self-guards via CRON_SECRET)
    pathname === '/api/cron/pepper-note'             // Pepper's per-person morning note (self-guards via CRON_SECRET)

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

  // Role-based section gating. Resolution mirrors lib/auth/viewer.ts:
  // pre-migration (columns missing) or bootstrap (nobody linked yet) → admin,
  // so behavior is unchanged until users are actually linked in /settings/users.
  // Resolved once and shared with the confidential-project gate below, so the
  // two gates can never disagree about who is an admin.
  let role: Role = 'admin'
  if (user && !isPublicRoute && !pathname.startsWith('/auth/')) {
    const { data: me, error } = await supabase
      .from('team_members')
      .select('role, active')
      .eq('auth_user_id', user.id)
      .maybeSingle()
    if (error) {
      // Only the missing-column error (42703 = migration not applied) keeps
      // the admin default; any other failure fails closed, never open.
      if (error.code !== '42703') role = 'member'
    } else if (me) {
      role = me.active && isRole(me.role) ? me.role : 'member'
    } else {
      // Not linked — member, unless no linked active ADMIN exists yet
      // (bootstrap: linking a PM first must never demote the admins).
      const { count } = await supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .not('auth_user_id', 'is', null)
        .eq('role', 'admin')
        .eq('active', true)
      if ((count ?? 0) > 0) role = 'member'
    }

    if (role !== 'admin') {
      if (pathname.startsWith('/api/')) {
        if (!canAccessApi(role, pathname)) {
          return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
        }
      } else if (!canAccessPage(role, pathname)) {
        const url = request.nextUrl.clone()
        // Per-role landing: steel_sales can't see /tasks, so sending them
        // there would redirect-loop — landingFor keeps it in-allowlist.
        url.pathname = landingFor(role)
        return NextResponse.redirect(url)
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Confidential projects: the step-up gate.
  //
  // Here rather than in the project layout because a Next layout is not a data
  // boundary — layout and page render in PARALLEL, so a layout that decides to
  // show an unlock prompt has not stopped the page beneath it from fetching the
  // project. A rewrite replaces the whole tree before any of it runs, and keeps
  // the URL, so the address bar still reads /projects/<id> while the response is
  // the prompt.
  //
  // RLS is not the boundary on this platform (CLAUDE.md §8) — app traffic is
  // service-role — so this gate is load-bearing, not belt-and-braces. It runs on
  // the two paths an id can arrive on. Routes that take a project id in a BODY
  // instead (documents, milestones, tasks) cannot be seen from here and carry
  // their own checks.
  // ───────────────────────────────────────────────────────────────────────────
  if (user && !isPublicRoute && !isLockedPath(pathname)) {
    const projectId = projectIdFromPath(pathname)
    if (projectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('confidential')
        .eq('id', projectId)
        .maybeSingle()

      if (project?.confidential) {
        // Only an admin can ever hold a step-up (lib/security/request.ts), so
        // anyone else is turned away without being told the project exists.
        const isAdmin = role === 'admin'

        let unlocked = false
        if (isAdmin) {
          const { data: session } = await supabase
            .from('step_up_sessions')
            .select('id')
            .eq('auth_user_id', user.id)
            .eq('project_id', projectId)
            .gt('expires_at', new Date().toISOString())
            .limit(1)
          unlocked = (session ?? []).length > 0
        }

        if (!unlocked) {
          if (pathname.startsWith('/api/')) {
            if (!isLockExemptApiPath(pathname)) {
              return NextResponse.json(
                {
                  error: isAdmin
                    ? 'This project is protected. Unlock it with your authenticator.'
                    : 'Not authorized',
                  needsStepUp: isAdmin,
                },
                { status: 403 }
              )
            }
          } else if (isAdmin) {
            const url = request.nextUrl.clone()
            url.pathname = lockedPathFor()
            url.searchParams.set('id', projectId)
            return NextResponse.rewrite(url)
          } else {
            const url = request.nextUrl.clone()
            url.pathname = '/projects'
            return NextResponse.redirect(url)
          }
        }
      }
    }
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
     *
     * `.webmanifest` is in that list because a browser fetches the manifest
     * WITHOUT credentials unless the link says otherwise, so gating it meant
     * every fetch 307'd to /login and the install name, icons and standalone
     * display were silently discarded. It carries no data a login protects —
     * the app's name, description and icon paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)',
  ],
}
