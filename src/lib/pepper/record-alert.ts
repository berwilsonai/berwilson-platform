/**
 * Pepper texts both executives when a recording created a record.
 *
 * Richard's direction, 2026-10-19: *"Whenever you find a new opportunity or
 * project, I would like you to make a very succinct short TLDR describing what
 * the project is and what the next steps are, and text that to Eric and
 * myself… In the signature, put that it is from Pepper and give a hyperlink to
 * the project or opportunity you created."*
 *
 * ⚠ ONE TEXT PER RECORDING, NOT ONE PER RECORD. A broker call names several
 * sites, and three texts arriving in one minute is how a channel gets muted.
 * The message leads with the record when there is one and lists them when there
 * are more, each with its own line and its own link.
 *
 * ⚠ AND THE LINK IS AN `APP_URL` LINK, NEVER A REQUEST ORIGIN. §12: behind
 * `tailscale serve` the Host header is localhost, so a URL built from the
 * request is a link to nowhere — and this pass runs on a cron with no request
 * at all.
 *
 * Idempotency is `notification_log`'s `unique (kind, dedupe_key)`, keyed on the
 * RECORD ids rather than the day: `sent_date` only ever meant one-a-day, and two
 * recordings on one morning are two pieces of news.
 */

import { loadPepperMembers } from '@/lib/pepper/attribution'
import { notify } from '@/lib/notify'
import { PEPPER_SIGNATURE, textTargets } from '@/lib/notify/text'
import { isConfidentialProject } from '@/lib/security/confidential'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CreatedRecord } from '@/lib/records/from-recording'

const KIND = 'record_alert'
const CHANNEL = 'text'
const UNIQUE_VIOLATION = '23505'

export interface RecordAlertResult {
  sent: number
  skipped: number
  failed: number
  /** The exact body, so a dry run and a log can both be read. */
  body: string | null
  results: { to: string; ok: boolean; via?: string; error?: string }[]
  notes: string[]
}

/** The base every link hangs off. Unset = links are omitted rather than broken. */
function appUrl(): string | null {
  const raw = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '')
  return raw.startsWith('http') ? raw : null
}

export function recordPath(kind: 'project' | 'opportunity', id: string): string {
  return kind === 'project' ? `/projects/${id}` : `/opportunities/${id}`
}

/**
 * The message body.
 *
 * Deliberately plain and short: a carrier gateway splits a long body across
 * several texts and strips anything clever, so the shape has to survive being
 * read as 160 characters at a time. Facts first, signature last.
 */
export function composeRecordAlert(
  created: CreatedRecord[],
  opts: { recordedOn?: string | null; sourceTitle?: string | null } = {}
): string {
  const base = appUrl()
  const lines: string[] = []

  if (created.length === 1) {
    const r = created[0]
    lines.push(`New ${label(r)}: ${r.name}`)
    lines.push(r.tldr)
    lines.push(`Next: ${r.nextStep ?? 'not set on the call — needs one'}`)
  } else {
    lines.push(`${created.length} new records off a recording${opts.recordedOn ? ` (${opts.recordedOn})` : ''}:`)
    for (const r of created) {
      lines.push('')
      lines.push(`${r.name} — new ${label(r)}`)
      lines.push(r.tldr)
      lines.push(`Next: ${r.nextStep ?? 'needs one'}`)
      if (base) lines.push(`${base}${recordPath(r.kind, r.id)}`)
    }
  }

  lines.push('')
  // ⚠ THE CONSTANT, NOT THE STRING. `sendText` signs every text at the choke
  // point now, and it recognises an already-signed body by matching this exact
  // line — so a reworded copy here would be signed TWICE, in two places.
  lines.push(PEPPER_SIGNATURE)
  // One record puts its link under the signature, where a single tap lands; a
  // list has already carried each link beside its own record. Signing at the
  // choke point is idempotent precisely so this deliberate order survives it.
  if (base && created.length === 1) lines.push(`${base}${recordPath(created[0].kind, created[0].id)}`)
  if (!base) lines.push('(no APP_URL configured, so no link — set it and these become tappable)')

  return lines.join('\n')
}

/** "opportunity (joint venture)" / "project" — what it is, tagged as asked. */
function label(r: CreatedRecord): string {
  if (r.kind === 'project') return 'project'
  if (!r.oppType) return 'opportunity (type not stated on the call)'
  return `opportunity (${r.oppType.replace(/_/g, ' ')})`
}

/**
 * Text both executives about what this recording created.
 *
 * Returns rather than throws: a failed text must never cost the record that was
 * already written, and the sweep reports this result alongside its own.
 */
export async function sendRecordAlert(args: {
  created: CreatedRecord[]
  recordedOn?: string | null
  sourceTitle?: string | null
  dryRun?: boolean
}): Promise<RecordAlertResult> {
  const out: RecordAlertResult = { sent: 0, skipped: 0, failed: 0, body: null, results: [], notes: [] }
  const created = args.created.filter((r) => r.id && r.name)
  if (created.length === 0) return out

  // ⚠ CONTAINMENT, AND IT IS CHECKED THOUGH IT CANNOT CURRENTLY FIRE. Nothing
  // this pass creates is `confidential` — the column defaults false and no
  // automatic path sets it. But §12's rule is that a security filter belongs at
  // the choke point as a DEFAULT so it covers the route added next year, and
  // this is the choke point for an OUTBOUND channel, which can never be
  // unlocked after the fact.
  const safe: CreatedRecord[] = []
  for (const r of created) {
    if (r.kind === 'project' && (await isConfidentialProject(r.id).catch(() => true))) {
      out.notes.push(`${r.name} is a protected project — deliberately not named in an outbound text`)
      continue
    }
    safe.push(r)
  }
  if (safe.length === 0) return out

  const body = composeRecordAlert(safe, { recordedOn: args.recordedOn, sourceTitle: args.sourceTitle })
  out.body = body

  const { targets, problems } = textTargets()
  for (const p of problems) out.notes.push(`text target problem: ${p}`)
  if (targets.length === 0) {
    out.notes.push('PEPPER_TEXT_TARGETS is empty, so nobody was texted — the records were still created')
    return out
  }

  const supabase = createAdminClient()
  const members = await loadPepperMembers(supabase).catch(() => [])
  const today = new Date().toISOString().slice(0, 10)
  // The key is the SET of records, so one recording's news is sent once per
  // person however many times the sweep is re-run.
  const recordKey = safe.map((r) => r.id).sort().join(',')

  for (const target of targets) {
    const member = members.find((m) => m.email === target.email)
    if (member?.isAssistantSeat) {
      out.skipped++
      out.notes.push(`${target.email} is the assistant seat — Pepper does not text herself`)
      continue
    }

    // CLAIM FIRST, SEND SECOND — the insert is the lock (meeting-prep precedent).
    const dedupeKey = `${target.email}:${recordKey}`
    if (!args.dryRun) {
      const { error: claimErr } = await supabase.from('notification_log').insert({
        team_member_id: member?.id ?? null,
        channel: CHANNEL,
        kind: KIND,
        sent_date: today,
        dedupe_key: dedupeKey,
        status: 'sent',
      })
      if (claimErr) {
        if (claimErr.code === UNIQUE_VIOLATION) {
          out.skipped++
          continue
        }
        out.failed++
        out.notes.push(
          `could not claim the alert for ${target.email} — the once-per-record guard is not holding: ${claimErr.message}`
        )
        continue
      }
    }

    const res = await notify({
      channel: 'text',
      kind: 'record_alert',
      to: target.email,
      subject: 'new record',
      html: body.replace(/\n/g, '<br>'),
      text: body,
      textKind: 'record_alert',
      dryRun: args.dryRun,
    }).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
      via: undefined,
    }))

    if (res.ok) {
      out.sent++
      out.results.push({ to: target.email, ok: true, via: res.via })
    } else {
      out.failed++
      out.results.push({ to: target.email, ok: false, error: res.error })
      if (!args.dryRun) {
        await supabase
          .from('notification_log')
          .update({ status: 'failed', error: res.error ?? 'unknown' })
          .eq('kind', KIND)
          .eq('dedupe_key', dedupeKey)
      }
    }
  }

  return out
}
