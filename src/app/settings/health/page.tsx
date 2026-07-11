/**
 * /settings/health — admin-only system health + maintenance panel.
 *
 * The platform's background work (crons, AI, Graph tokens, backups) fails
 * silently by design. This page makes those failures visible AND puts the fix
 * next to the diagnosis: every check that can be self-served has an action
 * button (e.g. Reconnect Mailbox runs the Microsoft OAuth flow).
 *
 * Checks run live on every load — including a real Microsoft token refresh
 * and a real ping to LM Studio, not just "does a row exist".
 */

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  probeGraphConnection,
  probeLmStudio,
  probeBackups,
  probeDisk,
} from '@/lib/system-health'

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

async function runChecks(appOrigin: string): Promise<HealthCheck[]> {
  const supabase = createAdminClient()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const localAI = process.env.AI_PROVIDER === 'local'

  const [brief, riskScore, lastAi, aiDayCount, failedRuns, graph, lmStudio, backups, disk] =
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
      probeGraphConnection(),
      probeLmStudio(),
      probeBackups(),
      probeDisk(),
    ])

  const checks: HealthCheck[] = []
  const cronLogsHint =
    'Crons are launchd agents on the Studio — logs in ~/Library/Logs/berwilson/, status via `launchctl list | grep berwilson`.'

  // 1. Microsoft Graph mailbox (calendar, meeting prep, email research, brief meetings)
  {
    const redirectUri = `${appOrigin}/api/email/oauth/callback`
    if (graph.state === 'ok') {
      const scopes = graph.scopes ?? []
      const hasSharedScope = scopes.some((s) => s.toLowerCase().includes('mail.read.shared'))
      checks.push({
        name: 'Microsoft Mailbox',
        status: hasSharedScope ? 'ok' : 'warn',
        headline: `Connected as ${graph.email} — live refresh verified just now`,
        detail: hasSharedScope
          ? 'Calendar, meeting prep, and multi-mailbox email research are all working.'
          : 'Connected, but the token predates the Mail.Read.Shared scope — email research will fail on the shared mailboxes (info@, moose@). Reconnect to refresh scopes.',
        action: hasSharedScope ? undefined : { label: 'Reconnect Mailbox', href: '/api/email/oauth' },
      })
    } else if (graph.state === 'disconnected') {
      checks.push({
        name: 'Microsoft Mailbox',
        status: 'fail',
        headline: 'No mailbox connected',
        detail: `Calendar, meeting prep, email research, and the brief's meetings section are offline. Click Reconnect and sign in as tuaone@berwilson.com when Microsoft asks. If Microsoft shows a redirect-URI error, add ${redirectUri} to the Azure app registration (App registrations → Authentication) first.`,
        action: { label: 'Connect Mailbox', href: '/api/email/oauth' },
      })
    } else {
      checks.push({
        name: 'Microsoft Mailbox',
        status: 'fail',
        headline: `Connection broken${graph.email ? ` (${graph.email})` : ''} — reconnect required`,
        detail: `${graph.reason ?? ''} Click Reconnect and sign in as ${graph.email ?? 'tuaone@berwilson.com'} with the CURRENT password. If Microsoft shows a redirect-URI error, add ${redirectUri} to the Azure app registration first.${graph.rawError ? ` — Raw error: ${graph.rawError.slice(0, 300)}` : ''}`,
        action: { label: 'Reconnect Mailbox', href: '/api/email/oauth' },
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

  // 9. Azure client secret expiry (optional — set MICROSOFT_SECRET_EXPIRES)
  {
    const expires = process.env.MICROSOFT_SECRET_EXPIRES
    if (expires) {
      const days = Math.floor((new Date(expires + 'T00:00:00').getTime() - Date.now()) / 86_400_000)
      checks.push({
        name: 'Azure Client Secret',
        status: days < 0 ? 'fail' : days < 30 ? 'warn' : 'ok',
        headline: days < 0 ? `Expired ${-days}d ago` : `Expires in ${days}d (${expires})`,
        detail:
          days < 30
            ? 'When it expires, ALL Microsoft features break and even Reconnect fails. Create a new client secret in Azure (App registrations → Certificates & secrets), update MICROSOFT_CLIENT_SECRET and MICROSOFT_SECRET_EXPIRES in .env.local on the Studio, and redeploy.'
            : 'The Azure app secret Microsoft features authenticate with. Tracked from MICROSOFT_SECRET_EXPIRES in .env.local.',
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
      MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
      MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
      MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
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
          ? process.env.MICROSOFT_SECRET_EXPIRES
            ? undefined
            : 'Optional: set MICROSOFT_SECRET_EXPIRES=YYYY-MM-DD (the Azure client secret expiry date) to get warned here before Microsoft features break.'
          : 'Set the missing variables in .env.local on the Studio, then redeploy (zsh deploy/deploy-to-studio.sh).',
    })
  }

  return checks
}

export default async function SystemHealthPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? 'richards-mac-studio.tail0e5306.ts.net'
  const proto = hdrs.get('x-forwarded-proto') ?? 'https'
  const appOrigin = `${proto}://${host}`

  const checks = await runChecks(appOrigin)
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
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
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
        Checked live on every page load — including a real Microsoft token refresh and an LM Studio ping.
        Cron + backup logs live on the Studio in ~/Library/Logs/berwilson/.
      </p>
    </div>
  )
}
