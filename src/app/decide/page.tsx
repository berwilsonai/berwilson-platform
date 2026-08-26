import { Gavel } from 'lucide-react'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { leadsDb, type LeadRow } from '@/lib/leads/db'
import DecideClient, { type DecideItem } from '@/components/decide/DecideClient'

export const metadata = { title: 'Decide — Ber Wilson Intelligence' }

/**
 * One place for everything waiting on a decision.
 *
 * Before this, five surfaces each held part of the answer to "what needs me" —
 * /intake, /leads, /review, /tasks and the dashboard rail — for a company of
 * two people. Each was locally reasonable; together they meant no single screen
 * could tell you whether you were done, so nothing ever felt finished and the
 * intake queue reached 104 items with the oldest six weeks old.
 *
 * This does NOT replace those screens: each decision still opens its own review
 * UI, which is where the detail and the confirm step live. What it replaces is
 * the need to visit all of them to find out if there is anything to do.
 *
 * Deliberately excludes open tasks. A task is work you have already decided to
 * do; mixing it in here would turn a decision list back into a to-do list.
 */
export default async function DecidePage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const supabase = createAdminClient()

  const [{ data: sessions }, { data: leadRows }, { data: reviewRows }] = await Promise.all([
    supabase
      .from('email_intake_sessions')
      .select('id, label, status, updated_at, predecision, fit_assessment, intake_kind')
      .eq('status', 'pending')
      .order('updated_at', { ascending: false })
      .limit(200),
    leadsDb()
      .from('leads')
      .select('*')
      .in('status', ['new', 'reviewing'])
      .order('fit_score', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from('review_queue')
      .select('id, source_table, reason, confidence, created_at')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const items: DecideItem[] = []

  // --- Inbound leads: unclaimed bid invitations, best first -----------------
  for (const raw of (leadRows ?? []) as LeadRow[]) {
    if (raw.fit_recommendation === 'pass') continue
    items.push({
      id: raw.id,
      kind: 'lead',
      title: raw.title,
      subtitle: raw.sender_company ?? raw.sender_name ?? null,
      href: `/leads?lead=${raw.id}`,
      verdict: raw.fit_recommendation ?? null,
      score: raw.fit_score,
      note: raw.fit_summary,
      // A bid date is the only hard deadline in the whole list. Days-remaining
      // is derived client-side from a clock captured once at mount, rather than
      // during a server render — see DecideClient.
      deadline: raw.bid_due_date,
    })
  }

  // --- Staged correspondence, carrying Ber AI's recommendation --------------
  for (const s of sessions ?? []) {
    const pre = readPredecision(s.predecision)
    if (pre?.disposition === 'dismiss') continue // auto-handled or low value
    const fit = (s.fit_assessment ?? {}) as Record<string, unknown>
    const score = Number(fit.fit_score)
    items.push({
      id: s.id,
      kind: 'intake',
      title: s.label || 'Untitled research package',
      subtitle: pre?.merge_target_name ? `Merge into ${pre.merge_target_name}` : null,
      href: `/email-ingestion/${s.id}`,
      verdict: pre?.disposition ?? null,
      score: Number.isFinite(score) ? score : null,
      note: pre?.headline ?? pre?.reason ?? null,
      deadline: null,
    })
  }

  // --- Low-confidence AI extractions awaiting a human ----------------------
  for (const r of reviewRows ?? []) {
    items.push({
      id: r.id,
      kind: 'review',
      title: r.reason || `${r.source_table} needs review`,
      subtitle: r.source_table,
      href: '/review',
      verdict: null,
      score: r.confidence !== null ? Math.round(Number(r.confidence) * 100) : null,
      note: null,
      deadline: null,
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Gavel className="size-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl">Decide</h1>
          <p className="text-sm text-muted-foreground">
            Everything waiting on a call from you, in one list — inbound bids, staged
            correspondence, and anything Ber AI wasn&apos;t sure about. Ranked so the most
            consequential is first. Nothing here has been created yet.
          </p>
        </div>
      </div>

      <DecideClient items={items} />
    </div>
  )
}

function readPredecision(raw: unknown): {
  disposition: 'create' | 'merge' | 'dismiss'
  merge_target_name?: string | null
  headline?: string | null
  reason?: string | null
} | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const d = String(o.disposition ?? '')
  if (d !== 'create' && d !== 'merge' && d !== 'dismiss') return null
  return {
    disposition: d,
    merge_target_name: typeof o.merge_target_name === 'string' ? o.merge_target_name : null,
    headline: typeof o.headline === 'string' ? o.headline : null,
    reason: typeof o.reason === 'string' ? o.reason : null,
  }
}
