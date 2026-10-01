'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2, Lock, ShieldCheck, Trash2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'

interface Factor {
  id: string
  friendlyName: string | null
  status: 'verified' | 'unverified'
  createdAt: string | null
}

interface Enrollment {
  factorId: string
  qrCode: string
  uri: string
  secret: string
}

/**
 * Settings → Security. Enrol an authenticator, remove one, and lock every open
 * project immediately.
 *
 * There is no "disable MFA" switch, because MFA is not on globally — it is
 * demanded only by a project marked confidential. Removing the last
 * authenticator therefore does not weaken the platform; it locks the person out
 * of the protected projects until they enrol again, which is said out loud
 * below rather than discovered at the prompt.
 */
export default function SecurityManager({ factors }: { factors: Factor[] }) {
  const router = useRouter()
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const codeId = useId()

  // The factor list is read on the SERVER and refreshed by the router, not
  // fetched on mount. A load-on-mount effect would be the thirteenth
  // set-state-in-effect in this repo (CLAUDE.md §9) and there is no reason for
  // one here — nothing on this screen changes without the reader acting.
  const load = () => startTransition(() => router.refresh())

  async function startEnrollment() {
    setBusy('enroll')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/security/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Authenticator' }),
      })
      const payload = (await response.json().catch(() => ({}))) as Enrollment & { error?: string }
      if (!response.ok) {
        setError(payload.error ?? 'Could not start enrolment.')
        return
      }
      setEnrollment(payload)
      setCode('')
    } finally {
      setBusy(null)
    }
  }

  async function confirmEnrollment(event: React.FormEvent) {
    event.preventDefault()
    if (!enrollment || code.length !== 6) return
    setBusy('confirm')
    setError(null)
    try {
      const response = await fetch('/api/security/mfa?confirm=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorId: enrollment.factorId, code }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setError(payload.error ?? 'That code was not accepted.')
        setCode('')
        return
      }
      setEnrollment(null)
      setNotice('Authenticator confirmed. Protected projects will ask for a code from it.')
      load()
    } finally {
      setBusy(null)
    }
  }

  async function remove(factorId: string) {
    setBusy(factorId)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/security/mfa/${factorId}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        verifiedRemaining?: number
        sessionsClosed?: number
      }
      if (!response.ok) {
        setError(payload.error ?? 'Could not remove it.')
        return
      }
      setNotice(
        payload.verifiedRemaining === 0
          ? `Removed. That was your last authenticator, so ${payload.sessionsClosed ?? 0} open project${payload.sessionsClosed === 1 ? '' : 's'} closed and protected projects will stay closed until you enrol again.`
          : 'Removed.'
      )
      load()
    } finally {
      setBusy(null)
    }
  }

  async function lockEverything() {
    setBusy('lock')
    setError(null)
    try {
      const response = await fetch('/api/security/step-up', { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as { sessionsClosed?: number }
      setNotice(
        (payload.sessionsClosed ?? 0) > 0
          ? `Closed ${payload.sessionsClosed} open project${payload.sessionsClosed === 1 ? '' : 's'}.`
          : 'Nothing was open.'
      )
    } finally {
      setBusy(null)
    }
  }

  const verified = factors.filter((f) => f.status === 'verified')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An authenticator is what opens a project marked protected. The code is checked
          by this machine&rsquo;s own auth service — nothing is sent anywhere, and there is
          no shared password for anyone to pass on.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{notice}</p>
      )}

      <Panel>
        <PanelHeader label="Authenticators" count={verified.length}>
          {!enrollment && (
            <Button size="sm" variant="outline" onClick={startEnrollment} disabled={busy === 'enroll'}>
              {busy === 'enroll' ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
              Add
            </Button>
          )}
        </PanelHeader>

        <div className="divide-y divide-border">
          {factors.length === 0 && !enrollment && (
            <div className="px-4 py-6">
              <p className="text-sm text-muted-foreground">
                No authenticator yet. Add one with any TOTP app — Apple Passwords, 1Password,
                Google Authenticator. It works with no internet connection, which is the
                point.
              </p>
            </div>
          )}

          {factors.map((factor) => (
            <div key={factor.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {factor.friendlyName ?? 'Authenticator'}
                  </p>
                  {factor.createdAt && (
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(factor.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                {factor.status === 'unverified' && (
                  <Chip className="shrink-0">Not confirmed</Chip>
                )}
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => remove(factor.id)}
                disabled={busy === factor.id}
                aria-label={`Remove ${factor.friendlyName ?? 'authenticator'}`}
              >
                {busy === factor.id ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                Remove
              </Button>
            </div>
          ))}

          {enrollment && (
            <div className="space-y-4 px-4 py-4">
              <p className="text-sm text-muted-foreground">
                Scan this with your authenticator app, then type the six digits it shows.
              </p>
              <div className="flex flex-wrap items-start gap-4">
                <QrCode markup={enrollment.qrCode} />
                <div className="min-w-0 space-y-1">
                  <p className="label-caps text-muted-foreground">Or enter by hand</p>
                  <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
                    {enrollment.secret}
                  </code>
                </div>
              </div>
              <form onSubmit={confirmEnrollment} className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <label htmlFor={codeId} className="label-caps block text-muted-foreground">
                    Code
                  </label>
                  <input
                    id={codeId}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="h-11 w-36 rounded-lg border border-border bg-background px-3 text-center font-mono text-base tracking-[0.3em] tnum outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                <Button type="submit" className="h-11" disabled={busy === 'confirm' || code.length !== 6}>
                  {busy === 'confirm' ? <Loader2 className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={() => setEnrollment(null)}
                >
                  Cancel
                </Button>
              </form>
            </div>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHeader label="Open projects" />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            Unlocking a protected project keeps it open for 30 minutes. This closes every
            one of yours now, without waiting.
          </p>
          <Button variant="outline" onClick={lockEverything} disabled={busy === 'lock'}>
            {busy === 'lock' ? <Loader2 className="animate-spin" aria-hidden /> : <Lock aria-hidden />}
            Lock everything
          </Button>
        </div>
      </Panel>
    </div>
  )
}

/**
 * gotrue returns the enrolment QR either as SVG markup or as a data: URI,
 * depending on version. Handle both rather than assume — and note that the
 * markup comes from this machine's own auth container over the tailnet, which
 * is the only reason injecting it is acceptable at all.
 */
function QrCode({ markup }: { markup: string }) {
  const trimmed = markup.trim()
  if (trimmed.startsWith('data:')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={trimmed} alt="Enrolment QR code" width={176} height={176} className="rounded bg-white p-2" />
  }
  return (
    <div
      className="[&>svg]:size-44 rounded bg-white p-2"
      dangerouslySetInnerHTML={{ __html: trimmed }}
    />
  )
}
