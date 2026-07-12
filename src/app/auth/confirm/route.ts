import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { publicOrigin } from '@/lib/utils/request-origin'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  // Behind tailscale serve the Host header is rewritten to localhost:3000 —
  // redirects must use the forwarded host or invite/magic links break off-box.
  const origin = publicOrigin(request.headers)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const rawNext = searchParams.get('next') ?? '/dashboard'
  // Same-origin paths only — anything else could smuggle a foreign host into
  // the redirect (e.g. next=@evil.com).
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard'

  if (token_hash && type) {
    const cookieStore = await cookies()

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!error) {
      // Invite and signup types: user is now authenticated but needs to set a password
      if (type === 'invite' || type === 'signup') {
        return NextResponse.redirect(`${origin}/auth/set-password`)
      }
      // Magic link / recovery / email change: go to intended destination
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Token missing, invalid, or expired
  return NextResponse.redirect(`${origin}/login?error=invalid_link`)
}
