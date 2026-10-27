'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error') === 'invalid_link'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      {/*
        ⚠ THIS PAGE WAS A HARDCODED NAVY GRADIENT UNTIL 2026-10-27 — hue 260,
        inline, reading no token at all. It is the FIRST screen of the product
        and it was the one surface two consecutive re-skins could not reach,
        which is most of why the palette work "could not be seen": whatever the
        app was themed, sign-in was navy.

        It is the canvas now, with a single wash of the brand terracotta at the
        top. Built from `--primary` through `color-mix`, so it follows the
        palette by construction and cannot drift from it again (the same fix
        the rail gradient needed on 10-26).
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh]"
        style={{
          background:
            'radial-gradient(60rem 28rem at 50% -8%, color-mix(in oklab, var(--primary) 16%, transparent) 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl bg-card elev-3 border border-border/60 px-7 py-8 space-y-6">
          {/* Brand */}
          <div className="flex flex-col items-center text-center gap-3">
            {/* The card is `bg-card` and the page behind it is the canvas, so
                both flip with the theme together; the lockup follows the card. */}
            <Image
              src="/logo-light.png"
              alt="Ber Wilson"
              width={640}
              height={339}
              className="object-contain h-11 w-auto dark:hidden"
              priority
            />
            <Image
              src="/logo-dark.png"
              alt=""
              aria-hidden
              width={640}
              height={343}
              className="object-contain h-11 w-auto hidden dark:block"
              priority
            />
            <p className="label-caps text-muted-foreground">
              Executive Intelligence Platform
            </p>
          </div>

          {linkError && (
            <p className="text-sm text-caution bg-caution-surface border border-caution-edge rounded-md px-3 py-2 text-center">
              That link has expired or is invalid. Please sign in below.
            </p>
          )}

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-foreground/80">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full h-10 rounded-md border border-input bg-background dark:bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-transparent"
                placeholder="you@berwilson.com"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-foreground/80">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full h-10 rounded-md border border-input bg-background dark:bg-muted px-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-critical bg-critical-surface rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 elev-1"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Sign In
            </button>
          </form>
        </div>

        {/* ⚠ WAS `text-white/40` — white at 40% on what used to be a navy page,
            which on the cream canvas is invisible. The kind of thing that is
            obvious in a screenshot and silent in a diff. */}
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Internal use only · Private network access
        </p>
      </div>
    </div>
  )
}
