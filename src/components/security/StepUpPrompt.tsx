'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, Lock, Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Panel } from '@/components/ui/card'

/**
 * The six-digit prompt that opens a confidential project.
 *
 * Reached by a middleware REWRITE, so the address bar still reads
 * /projects/<id>/… — which is why a success refreshes the current route rather
 * than navigating: middleware runs again, now finds a live step-up, and serves
 * the real page at the URL the reader was already asking for.
 */
export default function StepUpPrompt({
  projectName,
  hasAuthenticator,
  minutes,
}: {
  /** Named only when the reader is allowed to know it exists. */
  projectName: string | null
  hasAuthenticator: boolean
  minutes: number
}) {
  const router = useRouter()
  const codeId = useId()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || code.length !== 6) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/security/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: window.location.pathname.split('/')[2], code }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setError(payload.error ?? 'That did not work.')
        setCode('')
        setBusy(false)
        return
      }
      // Leave `busy` set — the refresh replaces this tree, and re-enabling the
      // button first lets a second code be sent against a session that is
      // already open.
      router.refresh()
    } catch {
      setError('Could not reach the server.')
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-16">
      <Panel className="p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Lock className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-foreground">
              {projectName ?? 'Protected project'}
            </h1>
            <p className="label-caps text-muted-foreground">Protected</p>
          </div>
        </div>

        {hasAuthenticator ? (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label htmlFor={codeId} className="block text-sm text-muted-foreground">
              Enter the current code from your authenticator to open this project for{' '}
              {minutes} minutes.
            </label>
            <input
              id={codeId}
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? `${codeId}-error` : undefined}
              placeholder="000000"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-center font-mono text-xl tracking-[0.4em] tnum outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
            {error && (
              <p id={`${codeId}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy || code.length !== 6} className="h-11 w-full">
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden /> Checking
                </>
              ) : (
                <>
                  <ShieldCheck aria-hidden /> Unlock
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-muted-foreground">
              This project needs a second factor, and there is no authenticator on your
              account yet. Set one up once and it covers every protected project.
            </p>
            <Link
              href="/settings/security"
              className={buttonVariants({ className: 'h-11 w-full' })}
            >
              <ShieldCheck aria-hidden /> Set up an authenticator
            </Link>
          </div>
        )}
      </Panel>

      <p className="px-1 text-xs text-muted-foreground">
        Protected projects are also kept out of portfolio lists, out of Ber AI&rsquo;s
        portfolio-wide answers, and out of every email the platform sends — including
        Pepper&rsquo;s morning note. That part is not unlocked by a code.
      </p>
    </div>
  )
}
