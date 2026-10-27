'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export default function SetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted dark:bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Brand */}
        <div className="text-center">
          <h1 className="text-lg font-semibold tracking-widest uppercase text-foreground dark:text-muted-foreground">
            Ber Wilson
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your password
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-xs font-medium text-foreground dark:text-muted-foreground">
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full h-10 rounded-md border border-border dark:border-border/60 bg-white dark:bg-muted px-3 text-sm text-foreground dark:text-muted-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-border focus-visible:border-transparent"
              placeholder="At least 8 characters"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm" className="text-xs font-medium text-foreground dark:text-muted-foreground">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full h-10 rounded-md border border-border dark:border-border/60 bg-white dark:bg-muted px-3 text-sm text-foreground dark:text-muted-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-border focus-visible:border-transparent"
              placeholder="Repeat password"
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
            className="w-full h-10 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Set Password & Sign In
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Internal use only
        </p>
      </div>
    </div>
  )
}
