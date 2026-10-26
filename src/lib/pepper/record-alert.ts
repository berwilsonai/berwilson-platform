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
import { notifyPair } from '@/lib/notify/pair'
import { PEPPER_SIGNATURE, textTargets } from '@/lib/notify/text'
import { isConfidentialProject } from '@/lib/security/confidential'
import { createAdminClient } from '@/lib/supabase/admin'
import type { CreatedRecord } from '@/lib/records/from-recording'

const KIND = 'record_alert'
const CHANNEL = 'email+text'
const UNIQUE_VIOLATION = '23505'

export interface RecordAlertResult {
  sent: number
  skipped: number
  failed: number
  /** The exact body, so a dry run and a log can both be read. */
  body: string | null
  results: { to: string; ok: boolean; emailed?: boolean; texted?: boolean; via?: string; error?: string | null }[]
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
 * Tell both executives what this recording created — by mail, and by text.
 *
 * Returns rather than throws: a failed send must never cost the record that was
 * already written, and the sweep reports this result alongside its own.
 *
 * ⚠ THE RECIPIENTS ARE THE PEOPLE, NOT THE TEXT TARGETS, SINCE 2026-10-26.
 * This loop used to iterate `textTargets()`, which inverted the dependency: an
 * empty `PEPPER_TEXT_TARGETS`, a malformed entry or a person with no handle
 * meant NOBODY was told that a call had created a deal, and the pass said so in
 * a note nobody reads. Email is the channel that must arrive now (Richard,
 * 10-26 — T-Mobile is rejecting the gateway), so the roster decides who is
 * told and a handle is an optional extra. `notifyPair` applies that standing.
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

  // A malformed text target is still worth saying — it costs somebody their
  // nudge — but it no longer decides WHO is told.
  const { problems } = textTargets()
  for (const p of problems) out.notes.push(`text target problem: ${p}`)

  const supabase = createAdminClient()
  const members = await loadPepperMembers(supabase).catch(() => [])
  if (members.length === 0) {
    out.notes.push('could not read the team roster, so nobody was told — the records were still created')
    return out
  }
  const today = new Date().toISOString().slice(0, 10)
  // The key is the SET of records, so one recording's news is sent once per
  // person however many times the sweep is re-run.
  const recordKey = safe.map((r) => r.id).sort().join(',')

  for (const member of members) {
    if (member.isAssistantSeat) {
      out.skipped++
      out.notes.push(`${member.email} is the assistant seat — Pepper does not write to herself`)
      continue
    }

    // CLAIM FIRST, SEND SECOND — the insert is the lock (meeting-prep precedent).
    const dedupeKey = `${member.email}:${recordKey}`
    if (!args.dryRun) {
      const { error: claimErr } = await supabase.from('notification_log').insert({
        team_member_id: member.id,
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
          `could not claim the alert for ${member.email} — the once-per-record guard is not holding: ${claimErr.message}`
        )
        continue
      }
    }

    const res = await notifyPair({
      kind: 'record_alert',
      to: member.email,
      // Named so the mail is findable later; the text keeps its own subject.
      subject:
        safe.length === 1
          ? `New ${safe[0].kind}: ${safe[0].name}`
          : `${safe.length} new records off a recording`,
      text: body,
      textKind: 'record_alert',
      dryRun: args.dryRun,
    })

    // The email's verdict decides; the text is a note either way (§pair.ts).
    if (res.textNote) out.notes.push(`${member.email}: ${res.textNote}`)
    if (res.emailed) {
      out.sent++
      out.results.push({ to: member.email, ok: true, emailed: true, texted: res.texted, via: res.via })
    } else {
      out.failed++
      out.results.push({ to: member.email, ok: false, error: res.error })
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
