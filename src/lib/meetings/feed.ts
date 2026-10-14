/**
 * What a meeting writes onto a record — composed once, for every path.
 *
 * Extracted from `api/meeting-intake/confirm` on 2026-10-14, when a call stopped
 * writing the same narrative to every deal it touched. These are pure string
 * builders over the confirmed recap, which is what makes the per-record rule
 * testable rather than only observable after a confirm.
 */

export interface MeetingMeta {
  title: string | null
  date: string | null
  summary: string | null
  minutes: string | null
  decisions: string[]
}

/** The part of a confirm target these builders read. */
export interface FeedTarget {
  discussion?: string | null
}

function str(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** Compose the feed body (minutes + decisions) added to each record's update/note. */
export function feedBody(meeting: MeetingMeta): string {
  const parts: string[] = []
  if (str(meeting.summary)) parts.push(meeting.summary!.trim())
  if (str(meeting.minutes)) parts.push(meeting.minutes!.trim())
  if (meeting.decisions.length > 0) {
    parts.push(`Decisions:\n${meeting.decisions.map((d) => `- ${d}`).join('\n')}`)
  }
  return parts.join('\n\n').slice(0, 100_000)
}

/**
 * What goes on ONE record's feed.
 *
 * ⚠ A CALL COVERS SEVERAL DEALS, AND EVERY ONE OF THEM USED TO GET ALL OF IT.
 * Measured across every staged meeting on 2026-10-14: 9 of 10 named between 2
 * and 8 records, median 5. This loop wrote `feedBody(meeting)` — one narrative
 * of the whole call — to each one, so Riverdale's feed carried the Steelton
 * negotiation and the Weirton walk-through, and a feed whose entries are mostly
 * about other deals stops being read at all. §12 records the sharper form of the
 * same failure: one thread covering Steelton, Riverdale and Weirton had
 * newest-wins rewrite each deal's own address to "Steelton, Riverdale, Weirton".
 *
 * So each record gets the paragraph the recap wrote about IT (prompt 1.2's
 * `discussion`), headed by the line naming what else the call covered — because
 * an entry that is a slice must say so, or the reader believes the call was only
 * about this deal. The whole call is not lost: the minutes document is saved on
 * every target in the same loop, and the verbatim transcript is on the meeting.
 *
 * ⚠ AND IT FALLS BACK TO THE WHOLE CALL RATHER THAN TO NOTHING, in three cases
 * that are all the same case — there is no per-deal text to use: a session
 * staged before prompt 1.2, a target the reviewer added by hand (no referenced
 * record behind it), or a deal the recap judged to be merely MENTIONED and so
 * left null. Writing an empty entry would read as a call about nothing.
 */
export function recordFeedBody(
  meeting: MeetingMeta,
  target: FeedTarget,
  otherRecordNames: string[]
): string {
  const own = str(target.discussion) ? target.discussion!.trim() : null
  if (!own) return feedBody(meeting)

  const parts: string[] = []
  if (otherRecordNames.length > 0) {
    parts.push(
      `This call also covered ${otherRecordNames.join(', ')}. Below is what was said about this record; the full minutes are in the attached meeting notes.`
    )
  }
  parts.push(own)
  if (meeting.decisions.length > 0) {
    parts.push(`Decisions from the call:\n${meeting.decisions.map((d) => `- ${d}`).join('\n')}`)
  }
  return parts.join('\n\n').slice(0, 100_000)
}

/**
 * Compose the standalone meeting-minutes markdown document.
 *
 * This is where the WHOLE call lives, and it is saved on every record the call
 * touched — which is what makes a per-deal feed entry safe (see
 * {@link recordFeedBody}). It names the deals covered, so a reader who opens it
 * from one record knows the other deals in it are not misfiled.
 */
export function meetingDoc(
  meeting: MeetingMeta,
  attendees: { name: string; role: string | null }[],
  recordNames: string[] = []
): string {
  const title = str(meeting.title) || 'Meeting notes'
  const lines: string[] = [`# ${title}`]
  if (str(meeting.date)) lines.push(`\n_${meeting.date}_`)
  if (recordNames.length > 1) {
    lines.push(`\n**This call covered ${recordNames.length} records:** ${recordNames.join(', ')}`)
  }
  if (attendees.length > 0) {
    lines.push(`\n**Attendees:** ${attendees.map((a) => (a.role ? `${a.name} (${a.role})` : a.name)).join(', ')}`)
  }
  if (str(meeting.summary)) lines.push(`\n## Summary\n\n${meeting.summary!.trim()}`)
  if (meeting.decisions.length > 0) {
    lines.push(`\n## Decisions\n\n${meeting.decisions.map((d) => `- ${d}`).join('\n')}`)
  }
  if (str(meeting.minutes)) lines.push(`\n## Minutes\n\n${meeting.minutes!.trim()}`)
  return lines.join('\n')
}
