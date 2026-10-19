/**
 * The newest things the platform learned that are on no record yet.
 *
 * Richard's direction, 2026-10-19: *"When you look at a recording meeting, I
 * want to find it easily in Ber intelligence as a recent record that I may want
 * to work on… That way it isn't lost in a lead queue."*
 *
 * ⚠ IT IS NOT A "RECORDINGS" LIST, AND THE MEASUREMENT IS WHY. On the day this
 * was written there were SIX staged recorded meetings — every transcript filed
 * and indexed, every one attached to no deal — plus a seventh that came in that
 * morning, all of them reachable only through `/decide`, which is a batch
 * approval queue two clicks away and ranked by its own weighting. §12's rule
 * about count-gating applies to a whole surface as well as a tab: a thing is
 * easiest to miss exactly when it is new and attached to nothing, which is the
 * moment it most needs a person. So the band answers one question — *what
 * arrived, and is it on a deal yet* — and shows both the recording and anything
 * created from it, newest first, with the one link that acts on it.
 *
 * Deliberately NOT an attention score. `/attention` ranks ten kinds 0–100 and
 * answers "what is most urgent"; this answers "what is most recent". Two
 * quantities, named apart, never summed (§12).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { dropHidden, hiddenProjectIds } from '@/lib/security/confidential'

/** How far back counts as "just in". A week of recordings is a readable band. */
const WINDOW_DAYS = Number(process.env.JUST_IN_WINDOW_DAYS ?? 10)

export interface JustInItem {
  key: string
  /** What kind of thing arrived. */
  kind: 'recording' | 'record'
  /** The display line. */
  title: string
  /** One line of what it is about, already trimmed for a card. */
  detail: string | null
  /** The day it happened (not the day it was ingested) — 'YYYY-MM-DD'. */
  on: string | null
  /** Where it currently sits: a deal, or nothing yet. */
  placement: { label: string; href: string } | null
  /** The single action. A recording's is the confirm; a record's is itself. */
  action: { label: string; href: string }
  /** Sort key — most recently LEARNED first, which is what "just in" means. */
  learnedAt: string
}

interface MeetingRow {
  id: string
  title: string | null
  summary: string | null
  meeting_date: string | null
  scope: string | null
  status: string | null
  project_id: string | null
  opportunity_id: string | null
  drive_file_id: string | null
  created_at: string | null
  confidential: boolean | null
}

/**
 * Read the band.
 *
 * One call, three queries, nothing per row — this renders on the dashboard,
 * which is the busiest page in the app.
 */
export async function readJustIn(
  opts: { limit?: number; hidden?: Set<string> } = {}
): Promise<JustInItem[]> {
  const limit = opts.limit ?? 4
  const supabase = createAdminClient()
  // ⚠ THE SAFE ANSWER IS THE DEFAULT. A caller that forgets to pass the
  // viewer's set gets every protected project hidden, not none of them (§12:
  // forgetting to opt in costs a few results, forgetting to opt out costs the
  // secret). The dashboard passes its own viewer-aware set.
  const hidden = opts.hidden ?? (await hiddenProjectIds())
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()

  const [meetingsRes, projectsRes, oppsRes] = await Promise.all([
    supabase
      .from('meetings')
      .select(
        'id, title, summary, meeting_date, scope, status, project_id, opportunity_id, drive_file_id, created_at, confidential'
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(25),
    supabase
      .from('projects')
      .select('id, name, description, auto_created_from, created_at, confidential')
      .not('auto_created_from', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('opportunities')
      .select('id, name, description, opp_type, auto_created_from, created_at')
      .not('auto_created_from', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: JustInItem[] = []

  // ── Records created off a recording ───────────────────────────────────────
  //
  // Listed FIRST in construction and then sorted with everything else: a deal
  // Pepper created without being asked is the thing on this page most likely to
  // be wrong, so it must not be the thing that falls off the end of the limit.
  const autoProjects = dropHidden(
    (projectsRes.data ?? []) as {
      id: string
      name: string
      description: string | null
      auto_created_from: string | null
      created_at: string | null
      confidential: boolean | null
    }[],
    // The row's own id IS the project id here, which is the one case where the
    // accessor is the identity — and it still goes through `dropHidden` rather
    // than a local filter, so there is one definition of "hidden".
    (p) => p.id,
    hidden
  )

  for (const p of autoProjects) {
    items.push({
      key: `project:${p.id}`,
      kind: 'record',
      title: p.name,
      detail: firstLine(p.description),
      on: (p.created_at ?? '').slice(0, 10) || null,
      placement: null,
      action: { label: 'Open the project', href: `/projects/${p.id}` },
      learnedAt: p.created_at ?? '',
    })
  }

  for (const o of (oppsRes.data ?? []) as {
    id: string
    name: string
    description: string | null
    opp_type: string | null
    created_at: string | null
  }[]) {
    items.push({
      key: `opportunity:${o.id}`,
      kind: 'record',
      title: o.name,
      detail: firstLine(o.description),
      on: (o.created_at ?? '').slice(0, 10) || null,
      placement: null,
      action: { label: 'Open the opportunity', href: `/opportunities/${o.id}` },
      learnedAt: o.created_at ?? '',
    })
  }

  // ── Recordings ────────────────────────────────────────────────────────────
  const meetings = dropHidden(
    (meetingsRes.data ?? []) as MeetingRow[],
    (m) => m.project_id,
    hidden
  ).filter((m) => !m.confidential)

  // The staged session is what the confirm link needs, and both tables carry
  // the same `drive_file_id` key (see `LocalRecordingInput.sourceRef`).
  const refs = meetings.map((m) => m.drive_file_id).filter((r): r is string => Boolean(r))
  const sessionByRef = new Map<string, string>()
  if (refs.length > 0) {
    const { data } = await supabase
      .from('email_intake_sessions')
      .select('id, drive_file_id, status')
      .in('drive_file_id', refs.slice(0, 200))
      .eq('status', 'pending')
    for (const row of (data ?? []) as { id: string; drive_file_id: string | null }[]) {
      if (row.drive_file_id) sessionByRef.set(row.drive_file_id, row.id)
    }
  }

  const names = await recordNames(
    supabase,
    meetings.map((m) => m.project_id).filter((x): x is string => Boolean(x)),
    meetings.map((m) => m.opportunity_id).filter((x): x is string => Boolean(x))
  )

  for (const m of meetings) {
    const sessionId = m.drive_file_id ? sessionByRef.get(m.drive_file_id) : undefined
    const filedOn = m.project_id
      ? { label: names.projects.get(m.project_id) ?? 'a project', href: `/projects/${m.project_id}` }
      : m.opportunity_id
        ? {
            label: names.opportunities.get(m.opportunity_id) ?? 'an opportunity',
            href: `/opportunities/${m.opportunity_id}`,
          }
        : null

    items.push({
      key: `meeting:${m.id}`,
      kind: 'recording',
      title: m.title?.trim() || 'Recorded conversation',
      detail: firstLine(m.summary),
      on: m.meeting_date,
      placement: filedOn,
      // The confirm is what creates the follow-up tasks and links the people,
      // so it is the action even when the transcript already filed onto a deal.
      action: sessionId
        ? { label: filedOn ? 'Confirm the follow-ups' : 'Attach it to a deal', href: `/intake/meeting/${sessionId}` }
        : { label: 'Open the meeting', href: filedOn ? `${filedOn.href}/meetings` : '/intake?tab=meeting' },
      learnedAt: m.created_at ?? '',
    })
  }

  items.sort((a, b) => (b.learnedAt > a.learnedAt ? 1 : b.learnedAt < a.learnedAt ? -1 : 0))
  return items.slice(0, limit)
}

/** Names for the records a meeting is filed on. Two queries, never per row. */
async function recordNames(
  supabase: ReturnType<typeof createAdminClient>,
  projectIds: string[],
  opportunityIds: string[]
): Promise<{ projects: Map<string, string>; opportunities: Map<string, string> }> {
  const projects = new Map<string, string>()
  const opportunities = new Map<string, string>()
  await Promise.all([
    projectIds.length
      ? supabase
          .from('projects')
          .select('id, name')
          .in('id', [...new Set(projectIds)].slice(0, 200))
          .then(({ data }) => {
            for (const r of (data ?? []) as { id: string; name: string }[]) projects.set(r.id, r.name)
          })
      : Promise.resolve(),
    opportunityIds.length
      ? supabase
          .from('opportunities')
          .select('id, name')
          .in('id', [...new Set(opportunityIds)].slice(0, 200))
          .then(({ data }) => {
            for (const r of (data ?? []) as { id: string; name: string }[]) opportunities.set(r.id, r.name)
          })
      : Promise.resolve(),
  ])
  return { projects, opportunities }
}

/** One readable line, cut at a sentence. The card has room for about this much. */
export function firstLine(text: string | null | undefined, limit = 160): string | null {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return null
  if (clean.length <= limit) return clean
  const window = clean.slice(0, limit + 30)
  const stop = window.lastIndexOf('. ')
  if (stop >= 60) return window.slice(0, stop + 1)
  const space = clean.slice(0, limit).lastIndexOf(' ')
  return `${clean.slice(0, space > 40 ? space : limit)}…`
}
