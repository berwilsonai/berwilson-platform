/**
 * One-off repair: remove the tapback duplicates already ingested from Messages.
 *
 * WHAT HAPPENED. Messages stores a reaction as its own `message` row whose body
 * is `Liked “<the entire text it reacts to>”` and whose `is_from_me` is the
 * REACTOR's, not the author's. `read.ts` selected every message row without
 * looking at `associated_message_type`, so each reaction was ingested as a
 * message — a verbatim second copy of the message above it, under the wrong
 * name.
 *
 * It mattered immediately rather than cosmetically. Eric's rundown of every
 * outstanding deal on 2026-10-10 was liked by Richard a minute later, so the
 * commitment extractor read that rundown twice, once from each executive, and
 * could not tell who owed what: all five obligations off that thread landed
 * `side='them'` with `owner_name` NULL.
 *
 * ⚠ MEASURED BEFORE WRITING. 46,106 of 305,241 messages on this box are
 * tapbacks (15.1%); of the 115 text threads already stored, **23 carry at least
 * one** and they hold ~54 `Liked “` blocks between them. So this is a 23-thread
 * repair, not a re-ingest of the corpus.
 *
 * ⚠ WHY THIS EDITS `raw_markdown` IN PLACE RATHER THAN RE-INGESTING.
 * `storeFetchedThreads` writes a thread only when the incoming session is
 * LONGER than the stored one (a needless upsert would throw away a summary the
 * corpus has already paid for). A fixed sweep produces FEWER messages, so it
 * would skip every one of these threads and the duplicates would survive every
 * future pass. Editing the stored text to exactly what the fixed renderer would
 * now produce also leaves `message_count` equal to what the next sweep computes,
 * so the thread stays quiet instead of churning.
 *
 * What is re-done and what is not: `summary_state` goes back to `pending` and
 * `commitments_at`/`embedded_at` are cleared, so the summary, the ledger and the
 * retrieval chunks are rebuilt from the corrected text (the embed phase deletes
 * a thread's chunks before re-inserting, so there is no doubling). `routed_at`
 * is deliberately LEFT: a duplicate paragraph never changed which deal a thread
 * is about, and re-routing would re-run the apply phase for no gain.
 *
 * Dry by default. `--apply` writes.
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')

/**
 * The reaction verbs Messages renders. Taken from the stored corpus rather than
 * from memory — §12: build a code→name dictionary by querying the data.
 * `Removed a` covers the un-react, which carries the quoted body too.
 */
const TAPBACK = /^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked|Removed a [a-z]+ from) [“"]/

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set')
const db = createClient(url, key)

/** One `### <ts> — <sender>` block: its heading lines and its body. */
interface Block {
  raw: string
  body: string
}

/**
 * Split a rendered thread into its preamble and its message blocks.
 *
 * The format is renderThread()'s (gmail-search.ts): a `## subject` line, a
 * `Mailbox: … · N message(s), …` line, a blank, then one `### <ts> — <from>`
 * block per message with an optional `To:` line, a blank, and the body.
 */
function parse(markdown: string): { preamble: string[]; blocks: Block[] } {
  const lines = markdown.split('\n')
  const firstBlock = lines.findIndex((l) => l.startsWith('### '))
  if (firstBlock < 0) return { preamble: lines, blocks: [] }

  const preamble = lines.slice(0, firstBlock)
  const blocks: Block[] = []
  let current: string[] = []

  const flush = () => {
    if (current.length === 0) return
    // The body is everything after the heading, its optional `To:` line and the
    // blank that follows them.
    const rest = current.slice(1)
    const afterTo = rest[0]?.startsWith('To: ') ? rest.slice(1) : rest
    const body = afterTo.join('\n').trim()
    blocks.push({ raw: current.join('\n'), body })
    current = []
  }

  for (const line of lines.slice(firstBlock)) {
    if (line.startsWith('### ')) flush()
    current.push(line)
  }
  flush()

  return { preamble, blocks }
}

function rebuild(preamble: string[], kept: Block[]): string {
  // The count line states how many messages the thread holds, so it has to move
  // with them — a stale "78 message(s)" above 74 blocks is a small lie that the
  // summary prompt reads as fact.
  const fixedPreamble = preamble.map((l) =>
    l.startsWith('Mailbox: ')
      ? l.replace(/· \d+ message\(s\)/, `· ${kept.length} message(s)`)
      : l
  )
  return [...fixedPreamble, ...kept.map((b) => b.raw)].join('\n')
}

async function main() {
  const { data, error } = await db
    .from('email_threads')
    .select('id, subject, raw_markdown, message_count')
    .like('gmail_thread_id', 'imessage:%')
    .not('raw_markdown', 'is', null)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as { id: string; subject: string | null; raw_markdown: string; message_count: number | null }[]
  console.log(`Read ${rows.length} text threads.\n`)

  let touched = 0
  let blocksRemoved = 0
  let charsRemoved = 0
  const failures: string[] = []

  for (const row of rows) {
    const { preamble, blocks } = parse(row.raw_markdown)
    if (blocks.length === 0) continue

    const kept = blocks.filter((b) => !TAPBACK.test(b.body))
    const dropped = blocks.length - kept.length
    if (dropped === 0) continue

    // A thread that is ONLY reactions would be emptied, which is a different
    // decision (it is not a conversation at all) and must not be made silently.
    if (kept.length === 0) {
      failures.push(`${row.id} — every block is a tapback; left alone for a human`)
      continue
    }

    const next = rebuild(preamble, kept)
    touched++
    blocksRemoved += dropped
    charsRemoved += row.raw_markdown.length - next.length

    console.log(
      `${row.subject ?? '(no subject)'} — dropped ${dropped} of ${blocks.length} ` +
        `(${row.message_count ?? '?'} → ${kept.length} messages, ` +
        `−${(row.raw_markdown.length - next.length).toLocaleString()} chars)`
    )

    if (APPLY) {
      const { error: upErr } = await db
        .from('email_threads')
        .update({
          raw_markdown: next,
          message_count: kept.length,
          // Re-read from the corrected text. See the header for why routed_at
          // is left where it is.
          summary_state: 'pending',
          summary_error: null,
          commitments_at: null,
          embedded_at: null,
        })
        .eq('id', row.id)
      if (upErr) failures.push(`${row.id} — ${upErr.message}`)
    }
  }

  console.log(
    `\n${APPLY ? 'Repaired' : 'Would repair'} ${touched} thread(s): ` +
      `${blocksRemoved} tapback blocks, ${charsRemoved.toLocaleString()} characters.`
  )
  if (failures.length > 0) {
    console.log(`\n${failures.length} needing attention:`)
    for (const f of failures) console.log(`  ${f}`)
  }
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
