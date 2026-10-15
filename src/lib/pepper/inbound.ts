/**
 * Pepper's ears — a question emailed to her, answered in the thread.
 *
 * ⚠ ON THE DEAL MAILBOXES, NOT ON `info@`, AND THAT IS A CORRECTION TO THE
 * SPEC. CLAUDE.md's highest-leverage item reads "email `info@` a question from
 * a phone and have her answer in-thread … `info@` is already swept and is the
 * one mailbox that can send". Two of those three facts do not hold up:
 *
 *   - `info@` is swept by the LEAD pipeline, once a day at 04:30, and what it
 *     does with a message is marketing triage and bid scoring. A question
 *     arriving there waits up to 24 hours and is then scored as a sales lead.
 *   - Every mailbox holds `gmail.send` (see SCOPES in
 *     integrations/google-workspace.ts). What only `info@` holds is
 *     `gmail.modify`, which buys DRAFTS and LABELS. A reply is a send, so the
 *     deal mailboxes can already do this with no re-consent from anybody.
 *
 * And Richard's own direction (2026-10-15): `info@` is "mainly junk and
 * solicitations", while 100% of project and opportunity correspondence is in
 * `moose@` and `tuaone@`. A question about a deal belongs where the deal's mail
 * is.
 *
 * ⚠ WHAT MAKES A MESSAGE A QUESTION FOR HER IS THAT IT REPLIES TO ONE OF HERS.
 * Not a subject convention, which is a thing a human has to remember on a phone
 * at 7am and which anybody emailing the mailbox can trip by accident. Her sent
 * ids are recorded on `notification_log` (migration 20261015000004); a reply on
 * one of those threads, from an address on the roster, is unambiguous.
 *
 * ⚠ AND THE ALLOWLIST IS BY ADDRESS, WHICH IS THE WHOLE SAFETY MODEL. §12's
 * most expensive bug in this repo is the self-loop guard keyed on a DISPLAY
 * NAME, defeated by a rename that was itself a good idea — 27% of the
 * commitment ledger turned out to be Pepper reading her own notes. This answers
 * nobody who is not one of the two executives, it fails closed if the roster
 * cannot be read, and an unrecognised sender gets SILENCE rather than a polite
 * refusal: a reply to a stranger is an outbound egress hole, not a courtesy.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchThread, type MailMessage } from '@/lib/integrations/google-workspace'
import { loadPepperMembers, type PepperMember } from './attribution'

/** How far back a reply is still answered. Older than this is not a conversation. */
export const REPLY_WINDOW_HOURS = 48

/** Most questions answered per person per run, so a loop cannot run away. */
export const MAX_PER_MEMBER = 3

export interface PepperCaller {
  member: PepperMember
  /** Every address that IS this person, lowercased. */
  addresses: Set<string>
}

/**
 * Who may ask Pepper a question.
 *
 * Built from the roster, so adding an executive needs no code change — and it
 * EXCLUDES the assistant seat, because `info@` is the company front door rather
 * than a person and a message from it is either marketing or Pepper herself.
 */
export async function pepperCallers(): Promise<{
  callers: PepperCaller[]
  error: string | null
}> {
  try {
    const members = await loadPepperMembers(createAdminClient())
    return {
      callers: members
        .filter((m) => !m.isAssistantSeat)
        .map((m) => ({
          member: m,
          addresses: new Set([...m.addresses].map((a) => a.toLowerCase())),
        })),
      error: null,
    }
  } catch (err) {
    // ⚠ FAILS CLOSED. An empty allowlist answers nobody, which is the safe
    // outcome; a thrown error here would take down the cron, and a caller that
    // treated the failure as "allow" would answer strangers.
    return { callers: [], error: err instanceof Error ? err.message : String(err) }
  }
}

export interface PepperQuestion {
  caller: PepperCaller
  mailbox: string
  threadId: string
  /** The RFC Message-ID to answer, so other mail clients thread it too. */
  inReplyTo: string | null
  subject: string
  /** What they actually asked, with the quoted note stripped. */
  question: string
  receivedAt: string
}

/**
 * The threads Pepper has sent to, per mailbox, inside the reply window.
 *
 * Read from `notification_log` rather than by searching Gmail for her own
 * messages: the log is the record of what she sent, it is already written on
 * every send, and a search would have to guess at her own From line — which is
 * exactly the display-name coupling §12 says not to build.
 */
async function recentlySentThreads(
  sinceIso: string
): Promise<Map<string, { memberId: string | null }>> {
  const out = new Map<string, { memberId: string | null }>()
  const { data, error } = await createAdminClient()
    .from('notification_log')
    .select('gmail_thread_id, team_member_id')
    .eq('channel', 'email')
    .eq('status', 'sent')
    .not('gmail_thread_id', 'is', null)
    .gte('created_at', sinceIso)
    .limit(500)
  if (error) {
    console.error(`[pepper-inbound] could not read sent threads: ${error.message}`)
    return out
  }
  for (const row of (data ?? []) as { gmail_thread_id: string | null; team_member_id: string | null }[]) {
    if (row.gmail_thread_id) out.set(row.gmail_thread_id, { memberId: row.team_member_id })
  }
  return out
}

/**
 * Strip the quoted note off a reply.
 *
 * ⚠ WITHOUT THIS THE AGENT IS HANDED PEPPER'S OWN NOTE AS THE QUESTION. A
 * phone replies by quoting the whole message, so the body is four words
 * followed by nine hundred of her own prose — which is both a waste of a
 * single-threaded model's prefill and, worse, the shape that produced the
 * self-loop in the commitment ledger. The first quote marker wins; anything
 * before it is what the human typed.
 */
export function stripQuotedReply(body: string): string {
  const markers = [
    /^On .{3,80}wrote:$/m,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{10,}$/m,
    /^From:\s/m,
    /^>/m,
    /^Good morning, /m,
  ]
  let cut = body.length
  for (const re of markers) {
    const m = re.exec(body)
    if (m && m.index < cut) cut = m.index
  }

  // ⚠ AND THE MOBILE SIGNATURE, WHICH IS NOT A QUESTION. Caught in the dry run:
  // a reply typed with nothing above the signature left "Sent from my iPhone"
  // as the question, which would spend a whole agent turn — on a box that
  // serves one model request at a time — answering a phone's footer. Stripped
  // after the quote cut, because the signature sits between the two.
  return body
    .slice(0, cut)
    .replace(/^\s*(Sent|Get Outlook)\b.*$/gim, '')
    .trim()
}

/**
 * Find questions waiting for Pepper.
 *
 * One Gmail read per sent thread, which is bounded by how many notes she has
 * sent in the window — two people times a few days, not a search over a
 * mailbox.
 */
export async function findQuestions(
  now = new Date()
): Promise<{ questions: PepperQuestion[]; scanned: number; error: string | null }> {
  const { callers, error } = await pepperCallers()
  if (error) return { questions: [], scanned: 0, error }
  if (callers.length === 0) {
    return { questions: [], scanned: 0, error: 'no callers on the roster — answering nobody' }
  }

  const sinceIso = new Date(now.getTime() - REPLY_WINDOW_HOURS * 3_600_000).toISOString()
  const threads = await recentlySentThreads(sinceIso)
  if (threads.size === 0) return { questions: [], scanned: 0, error: null }

  const byId = new Map(callers.map((c) => [c.member.id, c]))
  const questions: PepperQuestion[] = []
  let scanned = 0

  for (const [threadId, { memberId }] of threads) {
    const caller = memberId ? byId.get(memberId) : undefined
    // A sent row with no member, or a member no longer on the roster, is not
    // somebody to answer. Skipped rather than broadened.
    if (!caller) continue

    let messages: MailMessage[]
    try {
      messages = await fetchThread(caller.member.mailbox, threadId)
      scanned += 1
    } catch (err) {
      // One unreadable thread must not cost the others.
      console.error(
        `[pepper-inbound] could not read ${threadId}: ${err instanceof Error ? err.message : String(err)}`
      )
      continue
    }

    // Newest first: only the LAST message matters. An older reply has either
    // been answered already (her answer is newer) or been superseded by the
    // human's own follow-up.
    const last = messages[messages.length - 1]
    if (!last) continue

    const from = last.from?.address?.toLowerCase() ?? ''
    // ⚠ THE ALLOWLIST, APPLIED TO THE ONE MESSAGE BEING ANSWERED. Checking the
    // thread's participants instead would answer anybody cc'd onto it.
    if (!caller.addresses.has(from)) continue
    if (last.receivedAt < sinceIso) continue

    const question = stripQuotedReply(last.bodyText ?? '')
    // An empty reply is a tap, not a question. Answering "" would hand the
    // agent her own note back, which is the self-loop shape again.
    if (question.length < 3) continue

    questions.push({
      caller,
      mailbox: caller.member.mailbox,
      threadId,
      inReplyTo: last.messageId || null,
      subject: last.subject || 'Your morning note',
      question,
      receivedAt: last.receivedAt,
    })
  }

  // Oldest first, and capped per person, so one reader cannot starve the other.
  questions.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const perMember = new Map<string, number>()
  const capped = questions.filter((q) => {
    const n = perMember.get(q.caller.member.id) ?? 0
    if (n >= MAX_PER_MEMBER) return false
    perMember.set(q.caller.member.id, n + 1)
    return true
  })

  return { questions: capped, scanned, error: null }
}
