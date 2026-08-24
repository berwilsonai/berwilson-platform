/**
 * /settings/health — admin-only system health + maintenance panel.
 *
 * The platform's background work (crons, AI, mailbox access, backups) fails
 * silently by design. This page makes those failures visible AND puts the fix
 * next to the diagnosis wherever one exists.
 *
 * Checks run live on every load — including a real Google token mint and a
 * real ping to LM Studio, not just "does a row exist".
 */

import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  probeMailboxConnection,
  probeLmStudio,
  probeBackups,
  probeDisk,
} from '@/lib/system-health'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { sweepDb } from '@/lib/email-sweep/db'

export const metadata = { title: 'System Health — Ber Wilson Intelligence' }
export const dynamic = 'force-dynamic'

type Status = 'ok' | 'warn' | 'fail'

interface HealthCheck {
  name: string
  status: Status
  headline: string
  detail?: string
  /** Self-service fix rendered as a button next to the check. */
  action?: { label: string; href: string }
}

const STATUS_STYLES: Record<Status, { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400' },
  fail: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
}

function hoursAgo(iso: string | null | undefined): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function ageLabel(iso: string | null | undefined): string {
  const h = hoursAgo(iso)
  if (h === null) return 'never'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}

/**
 * Sweep backlog counts. Returns null before migration 20260823000001 is
 * applied, so the check simply doesn't appear rather than erroring the page.
 */
async function sweepBacklog(): Promise<{ pending: number; summarized: number; failed: number } | null> {
  try {
    const db = sweepDb()
    const counts = await Promise.all(
      (['pending', 'summarized', 'failed'] as const).map(async (state) => {
        const { count, error } = await db
          .from('email_threads')
          .select('id', { count: 'exact', head: true })
          .eq('summary_state', state)
        if (error) throw new Error(error.message)
        return count ?? 0
      })
    )
    return { pending: counts[0], summarized: counts[1], failed: counts[2] }
  } catch {
    return null
  }
}

async function runChecks(): Promise<HealthCheck[]> {
  const supabase = createAdminClient()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const localAI = process.env.AI_PROVIDER === 'local'

  const [brief, riskScore, lastAi, aiDayCount, failedRuns, mailbox, lmStudio, backups, disk, lastDigest, failedDigests] =
    await Promise.all([
      supabase
        .from('stored_briefs')
        .select('created_at')
        .eq('brief_type', 'portfolio')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('risk_scores')
        .select('computed_at')
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('ai_queries')
        .select('created_at, model_used')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('ai_queries')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', dayAgo),
      supabase
        .from('email_intake_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', weekAgo),
      probeMailboxConnection(),
      probeLmStudio(),
      probeBackups(),
      probeDisk(),
      supabase
        .from('notification_log')
        .select('created_at')
        .eq('kind', 'task_digest')
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('kind', 'task_digest')
        .eq('status', 'failed')
        .gte('created_at', weekAgo),
    ])

  const checks: HealthCheck[] = []
  const cronLogsHint =
    'Crons are launchd agents on the Studio — logs in ~/Library/Logs/berwilson/, status via `launchctl list | grep berwilson`.'

  // 1. Google Workspace mailboxes (calendar, meeting prep, email sweep, brief meetings)
  {
    if (mailbox.state === 'ok') {
      const names = (mailbox.mailboxes ?? []).map((m) => m.email).join(', ')
      checks.push({
        name: 'Google Workspace',
        status: 'ok',
        headline: `Connected — token mint verified just now for ${names}`,
        detail:
          `Signing via ${mailbox.signingMode ?? 'service account'}. Calendar, meeting prep, contact enrichment, and the mailbox sweep are all working. ` +
          (mailbox.signingMode === 'per-mailbox OAuth'
            ? 'A refresh token can be revoked by a password change or an admin revoking app access; if that happens, re-consent with `node scripts/setup-google-oauth.mjs --only <address>` and copy the token file to the Studio.'
            : 'Service-account access does not expire, so there is nothing to reconnect.'),
      })
    } else if (mailbox.state === 'disconnected') {
      checks.push({
        name: 'Google Workspace',
        status: 'fail',
        headline: 'No Google credentials configured',
        detail: `Calendar, meeting prep, the mailbox sweep, and the brief's meetings section are offline. ${mailbox.reason ?? ''} This deployment uses per-mailbox OAuth: run \`node scripts/setup-google-oauth.mjs\`, then copy the token file to ~/berwilson-data/ on the Studio. Full procedure in deploy/google-workspace-setup.md.`,
      })
    } else {
      const broken = (mailbox.mailboxes ?? []).filter((m) => !m.ok)
      checks.push({
        name: 'Google Workspace',
        status: 'fail',
        headline: mailbox.reason ?? 'Google connection broken',
        detail: `${broken.map((m) => `${m.email}: ${m.error ?? 'unknown error'}`).join(' · ')}${
          mailbox.rawError && broken.length === 0 ? ` — Raw error: ${mailbox.rawError.slice(0, 300)}` : ''
        }${
          mailbox.signingMode === 'per-mailbox OAuth'
            ? ' Re-consent the affected mailbox with `node scripts/setup-google-oauth.mjs --only <address>` and copy ~/berwilson-data/google-oauth-tokens.json to the Studio.'
            : ' Fix in the Workspace admin console → Security → API controls → Domain-wide delegation.'
        } The full procedure is in deploy/google-workspace-setup.md.`,
      })
    }
  }

  // 2. Local AI engine (LM Studio) — only meaningful in local mode
  if (lmStudio.state !== 'not_local') {
    checks.push({
      name: 'Local AI Engine (LM Studio)',
      status: lmStudio.state === 'ok' ? 'ok' : lmStudio.state === 'degraded' ? 'warn' : 'fail',
      headline:
        lmStudio.state === 'ok'
          ? 'LM Studio reachable, models loaded'
          : lmStudio.state === 'degraded'
            ? 'Reachable, but a configured model is missing'
            : 'LM Studio unreachable — all AI features offline',
      detail: lmStudio.detail,
    })
  }

  // 3. Daily brief cron (launchd, 6:30am local on the Studio)
  {
    const h = hoursAgo(brief.data?.created_at)
    checks.push({
      name: 'Daily Brief Cron',
      status: h === null ? 'fail' : h < 36 ? 'ok' : 'fail',
      headline: h === null ? 'Never run' : `Last brief ${ageLabel(brief.data?.created_at)}`,
      detail:
        h !== null && h < 36
          ? 'Generating on schedule (6:30am on the Studio).'
          : `Expected daily at 6:30am. ${cronLogsHint}`,
    })
  }

  // 4. Risk scores cron (launchd, 1:00am local on the Studio)
  {
    const h = hoursAgo(riskScore.data?.computed_at)
    checks.push({
      name: 'Risk Scoring Cron',
      status: h === null ? 'fail' : h < 36 ? 'ok' : 'fail',
      headline: h === null ? 'Never run' : `Last computed ${ageLabel(riskScore.data?.computed_at)}`,
      detail:
        h !== null && h < 36
          ? 'Computing on schedule (1:00am on the Studio).'
          : `Expected daily at 1:00am. ${cronLogsHint}`,
    })
  }

  // 5. AI pipeline activity (interactive use — absence over a week is the signal)
  {
    const h = hoursAgo(lastAi.data?.created_at)
    checks.push({
      name: localAI ? 'AI Pipeline (Local Qwen)' : 'AI Pipeline (Gemini)',
      status: h === null ? 'fail' : h < 24 * 7 ? 'ok' : 'warn',
      headline:
        h === null
          ? 'No AI calls logged'
          : `Last call ${ageLabel(lastAi.data?.created_at)} · ${aiDayCount.count ?? 0} in 24h`,
      detail:
        h === null || h >= 24 * 7
          ? `No calls in a week. If the platform is in use, ${localAI ? 'LM Studio may be down (see the Local AI Engine check)' : 'the Gemini key may be failing'} — test the Ask Ber AI dock.`
          : `Most recent model: ${lastAi.data?.model_used ?? 'unknown'}.`,
    })
  }

  // 6. Nightly backups (Studio → local + encrypted offsite to the Mac mini)
  {
    checks.push({
      name: 'Nightly Backup',
      status: backups.state === 'ok' ? 'ok' : backups.state === 'stale' ? 'fail' : 'warn',
      headline:
        backups.state === 'ok'
          ? 'Backups running'
          : backups.state === 'stale'
            ? 'Backups have stopped'
            : 'Backup directory not found',
      detail: backups.detail,
    })
  }

  // 7. Disk space on the box (app + database + models + backups + map tiles)
  {
    checks.push({
      name: 'Disk Space',
      status: disk.state === 'ok' ? 'ok' : disk.state === 'critical' ? 'fail' : 'warn',
      headline:
        disk.freeGb !== undefined ? `${Math.round(disk.freeGb)} GB free` : 'Unknown',
      detail: disk.detail,
    })
  }

  // 8. Email research failures (last 7 days)
  {
    const failed = failedRuns.count ?? 0
    checks.push({
      name: 'Email Research Runs',
      status: failed === 0 ? 'ok' : 'warn',
      headline: failed === 0 ? 'No failed runs in 7 days' : `${failed} failed run${failed === 1 ? '' : 's'} in 7 days`,
      detail:
        failed === 0
          ? undefined
          : 'Open Email Intake → Recent sessions to see the error on each failed run.',
    })
  }

  // 8b. Task digest cron (launchd, Monday mornings) — a stale "last sent" only
  //     warns (weekly + quiet weeks are normal); failed sends are the real signal.
  {
    const h = hoursAgo(lastDigest.data?.created_at)
    const failed = failedDigests.count ?? 0
    checks.push({
      name: 'Task Digest',
      status: failed > 0 ? 'warn' : 'ok',
      headline:
        failed > 0
          ? `${failed} failed send${failed === 1 ? '' : 's'} in 7 days`
          : h === null
            ? 'No digests sent yet'
            : `Last sent ${ageLabel(lastDigest.data?.created_at)}`,
      detail:
        failed > 0
          ? 'A member digest failed to send. Sending needs the gmail.send scope on the connected mailbox — re-run scripts/setup-google-oauth.mjs to grant it, or check the member has a valid email.'
          : h === null
            ? `Emails each member their overdue + due-this-week tasks Monday mornings. Nothing sends until a member has a task due. ${cronLogsHint}`
            : 'Sending on schedule to members with tasks due.',
    })
  }

  // 9. Mailbox sweep backlog
  {
    const sweep = await sweepBacklog()
    if (sweep) {
      checks.push({
        name: 'Mailbox Sweep',
        status: sweep.failed > 0 ? 'warn' : 'ok',
        headline:
          sweep.pending > 0
            ? `${sweep.pending.toLocaleString()} thread(s) waiting to be read`
            : 'All fetched threads have been read',
        detail:
          `${sweep.summarized.toLocaleString()} summarized · ${sweep.pending.toLocaleString()} pending · ${sweep.failed.toLocaleString()} failed. ` +
          (sweep.pending > 0
            ? 'The hourly cron drains this newest-first; a first backfill takes many hours on the local model.'
            : '') +
          (sweep.failed > 0 ? ' Failed threads can be requeued from Email Intake.' : ''),
      })
    }
  }

  // 10. Server configuration
  {
    const required: Record<string, string | undefined> = {
      // AI provider: local mode needs the LM Studio endpoint; gemini mode needs the key
      ...(localAI
        ? { LOCAL_AI_BASE_URL: process.env.LOCAL_AI_BASE_URL }
        : { GEMINI_API_KEY: process.env.GEMINI_API_KEY }),
      CRON_SECRET: process.env.CRON_SECRET,
      // Google auth has three valid modes (downloaded key, signJwt, per-mailbox
      // OAuth) and this deployment uses OAuth, which is selected by the ABSENCE
      // of the service-account vars. Naming any single var here would fail the
      // check on a correctly configured box, so ask the library which mode is
      // live instead. The Google Workspace check above reports the detail.
      GOOGLE_AUTH: isGoogleConfigured() ? 'configured' : undefined,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }
    const missing = Object.entries(required)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    checks.push({
      name: 'Server Configuration',
      status: missing.length === 0 ? 'ok' : 'fail',
      headline: missing.length === 0 ? 'All required env vars present' : `Missing: ${missing.join(', ')}`,
      detail:
        missing.length === 0
          ? undefined
          : 'Set the missing variables in .env.local on the Studio, then redeploy (zsh deploy/deploy-to-studio.sh).',
    })
  }

  return checks
}

export default async function SystemHealthPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const checks = await runChecks()
  const worst: Status = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok'

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Background work fails quietly by design — this page is where it shows, with the fix next to it.
          </p>
        </div>
        <span className={`inline-flex items-center gap-2 text-sm font-medium ${STATUS_STYLES[worst].text}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[worst].dot}`} />
          {worst === 'ok' ? 'All systems normal' : worst === 'warn' ? 'Needs attention' : 'Something is down'}
        </span>
      </div>

      <div className="rounded-xl border border-border bg-card elev-1">
        <div className="border-b border-border px-4 py-3">
          <span className="label-caps text-muted-foreground">
            Checks
          </span>
          <span className="tnum ml-2 text-[11px] text-muted-foreground">{checks.length}</span>
        </div>
        <ul className="divide-y divide-border">
          {checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_STYLES[c.status].dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className={`text-sm ${STATUS_STYLES[c.status].text}`}>{c.headline}</span>
                </div>
                {c.detail && <p className="mt-0.5 text-sm text-muted-foreground">{c.detail}</p>}
                {c.action && (
                  <a
                    href={c.action.href}
                    className="mt-2 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {c.action.label}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-muted-foreground">
        Checked live on every page load — including a real Google token mint and an LM Studio ping.
        Cron + backup logs live on the Studio in ~/Library/Logs/berwilson/.
      </p>
    </div>
  )
}
