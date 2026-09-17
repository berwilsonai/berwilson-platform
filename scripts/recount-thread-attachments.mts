/**
 * Recount attachments on stored threads after the inline-classification fix.
 *
 * `email_threads.attachment_count` is not decoration: it GATES two things.
 * apply-phase imports a linked record's new attachments only when it is > 0,
 * and thread-embeddings indexes attachment text only when it is > 0. Every
 * thread fetched while Gmail-composed attachments were being read as inline
 * chrome therefore stored 0 and is permanently invisible to both — fixing the
 * classifier only helps mail fetched from now on.
 *
 * Cheap by construction: only threads Gmail itself reports as having an
 * attachment are re-read. `has:attachment` is a superset of what we count
 * (it matches some inline images too), which is the safe direction — a thread
 * it misses had nothing to find.
 *
 * Where a count grows, `embedded_at` is cleared so the sweep's embed phase
 * re-indexes that conversation WITH its attachment text. That queues real local
 * model work; it drains over subsequent sweep runs, which is the intended pace.
 *
 * Paced, because Gmail meters by query-cost-units-per-MINUTE and reading whole
 * threads back to back exhausts even googleFetch's retry. A thread skipped that
 * way keeps its old count, so simply re-running picks it up — but pacing means
 * the run finishes instead of needing a second pass to repair the first.
 *
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/recount-thread-attachments.mts [--dry] [--limit N]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchThread,
  listThreads,
  isGoogleConfigured,
  MAILBOXES,
  LEAD_MAILBOXES,
} from '@/lib/integrations/google-workspace'

const dry = process.argv.includes('--dry')
const paceIdx = process.argv.indexOf('--pace')
/** ms between thread reads. 250 keeps a long run under Gmail's per-minute cost cap. */
const PACE_MS = paceIdx >= 0 ? Number(process.argv[paceIdx + 1]) : 250
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const limitIdx = process.argv.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity

if (!isGoogleConfigured()) {
  console.error('Google Workspace is not configured.')
  process.exit(1)
}

const supabase = createAdminClient()
const mailboxes = [...new Set([...MAILBOXES, ...LEAD_MAILBOXES])]

let checked = 0
let grew = 0
let shrank = 0
let unchanged = 0
let failed = 0
const growth: { subject: string; from: number; to: number }[] = []

for (const mailbox of mailboxes) {
  // Every thread this mailbox says carries an attachment, paged.
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const page = await listThreads(mailbox, {
      q: 'has:attachment -in:spam -in:trash',
      maxResults: 500,
      pageToken,
    })
    for (const t of page.threads) ids.push(t.threadId)
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < 5000)

  console.log(`\n${mailbox}: ${ids.length} thread(s) with attachments in Gmail`)

  // Only the ones we actually store — PostgREST caps `in` lists, so chunk it.
  const stored = new Map<string, { id: string; attachment_count: number; subject: string }>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase
      .from('email_threads')
      .select('id, gmail_thread_id, attachment_count, subject')
      .eq('mailbox', mailbox)
      .in('gmail_thread_id', ids.slice(i, i + 100))
    for (const r of (data ?? []) as any[]) {
      stored.set(r.gmail_thread_id, {
        id: r.id,
        attachment_count: r.attachment_count ?? 0,
        subject: r.subject,
      })
    }
  }
  console.log(`  ${stored.size} of those are stored here`)

  for (const [gmailThreadId, row] of stored) {
    if (checked >= limit) break
    checked++
    if (PACE_MS > 0) await pause(PACE_MS)
    try {
      const messages = await fetchThread(mailbox, gmailThreadId)
      const count = messages.reduce(
        (n, m) => n + m.attachments.filter((a) => !a.isInline).length,
        0
      )
      if (count === row.attachment_count) {
        unchanged++
        continue
      }
      if (count > row.attachment_count) {
        grew++
        growth.push({ subject: row.subject, from: row.attachment_count, to: count })
      } else {
        shrank++
      }
      if (!dry) {
        const patch: Record<string, unknown> = { attachment_count: count }
        // Only a GROWN thread has unindexed content. Clearing embedded_at on a
        // thread that merely shed a misread logo would buy nothing and cost a
        // local-model pass.
        if (count > row.attachment_count) patch.embedded_at = null
        const { error } = await supabase.from('email_threads').update(patch).eq('id', row.id)
        if (error) {
          failed++
          console.error(`  update failed (${row.subject}): ${error.message}`)
        }
      }
    } catch (err) {
      failed++
      console.error(`  read failed (${row.subject}): ${err instanceof Error ? err.message : err}`)
    }
  }
  if (checked >= limit) break
}

if (failed > 0) {
  console.log(
    `\n${failed} thread(s) could not be read (usually Gmail's per-minute cost cap). They keep their old count — re-run to pick them up, optionally with a longer --pace.`
  )
}
console.log(`\n${dry ? '[dry] ' : ''}checked ${checked} · grew ${grew} · shrank ${shrank} · unchanged ${unchanged} · failed ${failed}`)
console.log('\nLargest gains:')
for (const g of growth.sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 15)) {
  console.log(`  ${g.from} → ${g.to}   ${g.subject.slice(0, 70)}`)
}
if (!dry && grew > 0) {
  console.log(`\n${grew} thread(s) queued for re-embedding (embedded_at cleared) — the sweep's embed phase drains these.`)
}
