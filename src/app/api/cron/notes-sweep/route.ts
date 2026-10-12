/**
 * GET /api/cron/notes-sweep
 *
 * Read the notes Richard has filed into a nominated Apple Notes folder and
 * write them as `email_threads` rows, so the eight mail phases pick them up.
 * Driven by a launchd job (com.berwilson.cron-notes-sweep) at :45 past the
 * snapshot hours, 10 minutes behind the text sweep — both read the same
 * `bw-snapshot` copy and LM Studio serves one request at a time (§12).
 *
 * ⚠ IT READS ONLY A NOMINATED FOLDER, AND THAT IS THE FEATURE. Automatic
 * classification was built, measured against 334 real notes and thrown away:
 * a note has no participants, which is the text classifier's strongest signal,
 * so scoring against record names matched 30% of the corpus and essentially
 * all of it falsely (`Costco` matched *box*, `Reptilian brain` matched
 * *economy*). The signal that exists is a human filing decision — the same
 * control model as `GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID`. `NOTES_FOLDER_NAMES`
 * unset means this route does nothing at all.
 *
 * ⚠ AND IT REFUSES A NOTE THAT LOOKS LIKE CREDENTIALS, EVEN INSIDE THAT FOLDER.
 * Measured on the live corpus: 39 of 332 notes (12%) hold secrets, including a
 * live Anthropic API key, the office door and gate codes, bank details and the
 * password to `info@berwilson.com` — Pepper's own mailbox. An ingested note is
 * summarized, chunked and EMBEDDED, and there is no un-embedding a secret you
 * have already answered a question with. A refused note is skipped whole, title
 * included, and the count is reported.
 *
 * `?dry=1` reads and refuses and writes nothing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runNotesSweep } from '@/lib/notes/sweep'

/** A sqlite read plus one summarize pass per new note, sequential. */
export const maxDuration = 1800

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dryRun') === '1'

  const result = await runNotesSweep({ dryRun })
  return NextResponse.json({
    ...result,
    // ⚠ The count and the REASONS, never the refused bodies — and the titles
    // are already truncated by the sweep, because a title can be the secret.
    refused: result.refused.length,
    refusedReasons: summarize(result.refused.map((r) => r.reason)),
  })
}

/** "credential word: passcode ×4" — the reason beside the number (§12). */
function summarize(reasons: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1
  return out
}
