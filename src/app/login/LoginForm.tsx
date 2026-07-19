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
    <div
      className="relative flex min-h-screen items-center justify-center px-4"
      style={{
        background:
          'radial-gradient(80rem 40rem at 50% -10%, oklch(0.30 0.05 260) 0%, oklch(0.18 0.025 260) 45%, oklch(0.13 0.02 260) 100%)',
      }}
    >
      {/* Faint dot grid — same canvas language as the entity chart. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(oklch(1 0 0 / 0.07) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl bg-card elev-3 border border-border/60 px-7 py-8 space-y-6">
          {/* Brand */}
          <div className="flex flex-col items-center text-center gap-3">
            <Image
              src="/logo.png"
              alt="Ber Wilson"
              width={150}
              height={80}
              className="object-contain h-11 w-auto"
              priority
            />
            <p className="label-caps text-muted-foreground">
              Executive Intelligence Platform
            </p>
          </div>

          {linkError && (
            <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-md px-3 py-2 text-center">
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
                className="w-full h-10 rounded-md border border-input bg-background dark:bg-slate-900 px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
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
                className="w-full h-10 rounded-md border border-input bg-background dark:bg-slate-900 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-md px-3 py-2">
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

        <p className="mt-5 text-center text-xs text-white/40">
          Internal use only · Private network access
        </p>
      </div>
    </div>
  )
}
