/**
 * One recording's promotion step: create what it earned, then say so by text.
 *
 * ⚠ ONE FUNCTION, TWO SWEEPS, AND THAT IS THE POINT. §12's hardest fork to see
 * is "two sibling modules written days apart, because neither looks like a
 * copy" — which is exactly what `voicememos/` and `driveaudio/` became, ~90 of
 * ~110 identical lines down to the wording of the paging advice, and the cause
 * of one bug fixed twice. The shared core in this directory exists because of
 * that; a promotion step pasted into both sweeps would rebuild the same trap in
 * a week. A third recorder calls this and gets the whole behaviour.
 *
 * Non-fatal by construction. A recording's value is its transcript, which is
 * already filed and indexed by the time this runs — so a failure here costs the
 * record and the text, never the words.
 */

import {
  promoteRecordingRecords,
  type CreatedRecord,
  type PromoteResult,
} from '@/lib/records/from-recording'
import { sendRecordAlert } from '@/lib/pepper/record-alert'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'

export interface PromotionReport {
  /** Records created, each with the fact that opened the gate. */
  created: CreatedRecord[]
  /** Every candidate refused, with the reason. An unlabelled zero is not a signal. */
  skipped: { name: string; why: string }[]
  /** How the text went, or null when there was nothing to say. */
  alert: { sent: number; failed: number; skipped: number; notes: string[] } | null
  /** Anything a reader of the sweep log needs to know. */
  notes: string[]
}

export function emptyPromotionReport(): PromotionReport {
  return { created: [], skipped: [], alert: null, notes: [] }
}

/**
 * Promote one recording's named-but-missing deals, and text both executives.
 *
 * `extraction` is the recap the sweep has already paid a model call for — see
 * `LocalRecordingResult.extraction`. Nothing here calls a model.
 */
export async function promoteAndAlert(args: {
  extraction: MeetingIntakeExtraction | null
  /** `voicememo:<id>` / `driveaudio:<id>`. */
  sourceRef: string
  /** 'YYYY-MM-DD' — when it was recorded. */
  recordedOn: string
  /** The recording's outside-world title, for the log only. */
  sourceTitle?: string | null
  mailboxes?: string[]
  dryRun?: boolean
}): Promise<PromotionReport> {
  const report = emptyPromotionReport()
  if (!args.extraction) {
    report.notes.push('no recap, so nothing could be promoted')
    return report
  }

  let promoted: PromoteResult
  try {
    promoted = await promoteRecordingRecords({
      extraction: args.extraction,
      sourceRef: args.sourceRef,
      recordedOn: args.recordedOn,
      mailboxes: args.mailboxes,
      dryRun: args.dryRun,
    })
  } catch (err) {
    report.notes.push(
      `could not check whether this recording names a new deal: ${err instanceof Error ? err.message : String(err)}`
    )
    return report
  }

  report.created = promoted.created
  report.skipped = promoted.skipped
  if (promoted.created.length === 0) return report

  try {
    const alert = await sendRecordAlert({
      created: promoted.created,
      recordedOn: args.recordedOn,
      sourceTitle: args.sourceTitle,
      dryRun: args.dryRun,
    })
    report.alert = {
      sent: alert.sent,
      failed: alert.failed,
      skipped: alert.skipped,
      notes: alert.notes,
    }
  } catch (err) {
    // ⚠ THE RECORD STANDS. A text that did not send is a notification problem;
    // deleting the deal it was about would be a data problem. The morning note
    // reads the same rows, so the news is not lost either way.
    report.notes.push(
      `records created, but the text failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return report
}
