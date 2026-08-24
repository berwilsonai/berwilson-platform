/**
 * Per-member task digest — the content that gets pushed to team members.
 *
 * Design note: because the platform runs locally on the Mac Studio behind
 * Tailscale, members can't always reach it. So the digest EMAIL CARRIES THE
 * TASK LIST inline. The "Open my tasks" link is only a convenience for when
 * they're on the tailnet — the message stands on its own.
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { fetchTasksForDigest, type DigestTask } from '@/lib/tasks/queries'

type AdminClient = ReturnType<typeof createAdminClient>

export interface MemberDigest {
  memberId: string
  name: string
  email: string
  overdue: DigestTask[]
  dueSoon: DigestTask[]
}

/** Whole days a task is past due (>= 1 means overdue). */
function daysOverdue(dueDate: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(dueDate + 'T00:00:00').getTime()) / 86_400_000)
}

/**
 * Build one digest per active team member who has an email AND at least one
 * overdue or due-in-7-days task. Members with nothing qualifying are omitted
 * (they get no message).
 */
export async function buildMemberDigests(
  supabase: AdminClient,
  now: Date = new Date(),
): Promise<MemberDigest[]> {
  const today = now.toISOString().split('T')[0]
  const in7 = new Date(now.getTime() + 7 * 86_400_000).toISOString().split('T')[0]

  const [tasks, { data: members }] = await Promise.all([
    fetchTasksForDigest(supabase),
    supabase.from('team_members').select('id, name, email').eq('active', true),
  ])

  const emailOf = new Map(
    (members ?? [])
      .filter((m) => m.email)
      .map((m) => [m.id, { name: m.name, email: m.email as string }]),
  )

  const byMember = new Map<string, { overdue: DigestTask[]; dueSoon: DigestTask[] }>()
  for (const t of tasks) {
    if (!t.assignee_id || !t.due_date || !emailOf.has(t.assignee_id)) continue
    const bucket = byMember.get(t.assignee_id) ?? { overdue: [], dueSoon: [] }
    if (t.due_date < today) bucket.overdue.push(t)
    else if (t.due_date <= in7) bucket.dueSoon.push(t)
    byMember.set(t.assignee_id, bucket)
  }

  const digests: MemberDigest[] = []
  for (const [memberId, { overdue, dueSoon }] of byMember) {
    if (overdue.length === 0 && dueSoon.length === 0) continue
    const m = emailOf.get(memberId)!
    digests.push({ memberId, name: m.name, email: m.email, overdue, dueSoon })
  }
  return digests
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function taskRow(t: DigestTask, now: Date): string {
  const tag = t.project_name ?? t.opportunity_name
  const days = t.due_date ? daysOverdue(t.due_date, now) : 0
  const dueLabel = t.due_date
    ? days > 0
      ? `${days}d overdue`
      : days === 0
        ? 'due today'
        : `due ${t.due_date}`
    : ''
  const dueColor = days > 0 ? '#dc2626' : days === 0 ? '#d97706' : '#6b7280'

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
        <div style="font-size:14px;font-weight:600;color:#111827;">${escapeHtml(t.title)}</div>
        ${t.why ? `<div style="font-size:12px;color:#6b7280;margin-top:2px;">${escapeHtml(t.why)}</div>` : ''}
        <div style="font-size:12px;margin-top:4px;">
          <span style="color:${dueColor};font-weight:600;">${dueLabel}</span>
          ${tag ? `<span style="color:#9ca3af;"> · ${escapeHtml(tag)}</span>` : ''}
        </div>
      </td>
    </tr>`
}

/** Render the digest email. Returns subject + HTML body. */
export function renderDigestEmail(
  digest: MemberDigest,
  appUrl: string,
  now: Date = new Date(),
): { subject: string; html: string } {
  const total = digest.overdue.length + digest.dueSoon.length
  const overduePart = digest.overdue.length > 0 ? `${digest.overdue.length} overdue` : ''
  const subject =
    digest.overdue.length > 0
      ? `${total} task${total === 1 ? '' : 's'} need you — ${overduePart}`
      : `${total} task${total === 1 ? '' : 's'} due this week`

  const section = (label: string, tasks: DigestTask[]) =>
    tasks.length === 0
      ? ''
      : `
      <div style="margin-top:20px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">${label} (${tasks.length})</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">
          ${tasks.map((t) => taskRow(t, now)).join('')}
        </table>
      </div>`

  const link = appUrl
    ? `<a href="${appUrl}/tasks" style="display:inline-block;margin-top:24px;padding:10px 18px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open my tasks</a>`
    : ''

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
    <div style="font-size:18px;font-weight:700;">Good morning, ${escapeHtml(digest.name.split(' ')[0])}</div>
    <div style="font-size:14px;color:#6b7280;margin-top:4px;">Here's what needs you today.</div>
    ${section('Overdue', digest.overdue)}
    ${section('Due this week', digest.dueSoon)}
    ${link}
    <div style="font-size:11px;color:#9ca3af;margin-top:28px;">Ber Wilson · automated task digest</div>
  </div>`

  return { subject, html }
}
