/**
 * /settings/health — admin-only system health panel.
 *
 * The platform's background work (crons, AI logging, Graph tokens) fails
 * silently by design. This page makes those failures visible: last successful
 * cron runs, AI pipeline activity, Microsoft Graph token state, failed email
 * research runs, and server config presence.
 */

import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'

export const metadata = { title: 'System Health — Ber Wilson Intelligence' }
export const dynamic = 'force-dynamic'

type Status = 'ok' | 'warn' | 'fail'

interface HealthCheck {
  name: string
  status: Status
  headline: string
  detail?: string
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

async function runChecks(): Promise<HealthCheck[]> {
  const supabase = createAdminClient()
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()

  const [brief, riskScore, lastAi, aiDayCount, graphToken, failedRuns] = await Promise.all([
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
      .from('email_tokens')
      .select('email_address, updated_at, scopes')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', weekAgo),
  ])

  const checks: HealthCheck[] = []

  // 1. Daily brief cron (runs 12:30 UTC daily)
  {
    const h = hoursAgo(brief.data?.created_at)
    checks.push({
      name: 'Daily Brief Cron',
      status: h === null ? 'fail' : h < 36 ? 'ok' : 'fail',
      headline: h === null ? 'Never run' : `Last brief ${ageLabel(brief.data?.created_at)}`,
      detail:
        h === null
          ? 'Scheduled at 12:30 UTC daily. If this persists past tomorrow morning, check the Vercel cron logs.'
          : h < 36
            ? 'Generating on schedule.'
            : 'Expected daily — check the Vercel cron logs for /api/cron/daily-brief.',
    })
  }

  // 2. Risk scores cron (runs 07:00 UTC daily)
  {
    const h = hoursAgo(riskScore.data?.computed_at)
    checks.push({
      name: 'Risk Scoring Cron',
      status: h === null ? 'fail' : h < 36 ? 'ok' : 'fail',
      headline: h === null ? 'Never run' : `Last computed ${ageLabel(riskScore.data?.computed_at)}`,
      detail:
        h !== null && h < 36
          ? 'Computing on schedule.'
          : 'Expected daily at 07:00 UTC — check the Vercel cron logs for /api/cron/risk-scores.',
    })
  }

  // 3. AI pipeline (interactive use — absence over a week is the signal)
  {
    const h = hoursAgo(lastAi.data?.created_at)
    checks.push({
      name: 'AI Pipeline (Gemini)',
      status: h === null ? 'fail' : h < 24 * 7 ? 'ok' : 'warn',
      headline:
        h === null
          ? 'No AI calls logged'
          : `Last call ${ageLabel(lastAi.data?.created_at)} · ${aiDayCount.count ?? 0} in 24h`,
      detail:
        h === null || h >= 24 * 7
          ? 'No calls in a week. If the platform is in use, the Gemini key may be failing — test the Ask Ber AI dock.'
          : `Most recent model: ${lastAi.data?.model_used ?? 'unknown'}.`,
    })
  }

  // 4. Microsoft Graph connection (calendar, enrichment, email research)
  {
    const t = graphToken.data
    const scopes = t?.scopes ?? []
    const hasSharedScope = scopes.some((s) => s.toLowerCase().includes('mail.read.shared'))
    checks.push({
      name: 'Microsoft Graph',
      status: !t ? 'fail' : hasSharedScope ? 'ok' : 'warn',
      headline: !t
        ? 'Not connected'
        : `Connected as ${t.email_address} · token refreshed ${ageLabel(t.updated_at)}`,
      detail: !t
        ? 'Calendar, meeting prep, and email research are offline. Reconnect from the Calendar page.'
        : hasSharedScope
          ? 'All scopes present, including shared-mailbox read for multi-mailbox email research.'
          : 'Token predates the Mail.Read.Shared scope — multi-mailbox email research will fail on the shared mailboxes. Reconnect Microsoft from the Calendar page to refresh scopes.',
    })
  }

  // 5. Email research failures (last 7 days)
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

  // 6. Server configuration
  {
    const required: Record<string, string | undefined> = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
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
          ? undefined
          : 'Set the missing variables in Vercel project settings and redeploy.',
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
            Background work fails quietly by design — this page is where it shows.
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
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className={`text-sm ${STATUS_STYLES[c.status].text}`}>{c.headline}</span>
                </div>
                {c.detail && <p className="mt-0.5 text-sm text-muted-foreground">{c.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-sm text-muted-foreground">
        Checked live on every page load. Cron logs live in Vercel → Project → Logs.
      </p>
    </div>
  )
}
