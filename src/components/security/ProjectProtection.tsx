'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Loader2, Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

/**
 * Turn a project's protection on or off, from the project itself.
 *
 * The asymmetry is deliberate and lives in the API route: turning protection ON
 * needs nothing but an admin, because hesitating over a 6-digit code is how a
 * project stays unprotected. Turning it OFF needs a live step-up — which, if you
 * are reading this project's page at all, you already hold.
 *
 * Switching it on reports what protection does NOT reach: a Drive folder that is
 * already shared, briefs already emailed. Saying so at the moment of the
 * decision is the difference between a control and a feeling of one.
 */
export default function ProjectProtection({
  projectId,
  confidential,
}: {
  projectId: string
  confidential: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [caveats, setCaveats] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}/confidential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confidential: !confidential }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        caveats?: string[]
      }
      if (!response.ok) {
        setError(payload.error ?? 'Could not change it.')
        return
      }
      if (payload.caveats?.length) setCaveats(payload.caveats)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant={confidential ? 'outline' : 'ghost'}
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : confidential ? (
          <LockOpen aria-hidden />
        ) : (
          <Lock aria-hidden />
        )}
        {confidential ? 'Remove protection' : 'Protect'}
      </Button>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {caveats && (
        <div className="w-full rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">Protection starts now, not backwards</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={confidential ? 'Remove protection from this project?' : 'Protect this project?'}
        description={
          confidential
            ? 'It returns to the portfolio lists, to Ber AI’s portfolio-wide answers, and to the briefs and digests the platform emails.'
            : 'It will be hidden from portfolio lists, from Ber AI’s portfolio-wide answers, and from every email the platform sends. Opening it will need a code from your authenticator, and so will removing this again.'
        }
        confirmLabel={confidential ? 'Remove protection' : 'Protect'}
        destructive={confidential}
        onConfirm={apply}
      />
    </>
  )
}
