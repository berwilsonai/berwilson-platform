import {
  CalendarDays, MessageSquare, CheckSquare, Flag, FileUp, type LucideIcon,
} from 'lucide-react'

/**
 * WHAT A HUMAN CAN LOG BY HAND ON A DEAL, AND WHERE EACH ONE LANDS.
 *
 * In `src/lib` rather than exported from the `'use client'` menu component,
 * so the verification script (and anything server-side that wants to name
 * these destinations) can read it without the request-time failure §12
 * describes.
 *
 * ⚠ `autoOpens` IS THE CONTRACT, NOT A HINT. `?new=1` is only appended where
 * the destination page actually reads it and opens its form — `meetings`,
 * `tasks`, and the record's own feed (`updates` on a project,
 * `notes` on an opportunity). Milestones and Documents are offered WITHOUT
 * it, because their add control is already in place on arrival and a param
 * nothing reads would make the menu a promise the page fails to keep.
 */
export interface LogEntry {
  /** What is being logged, as the reader would say it. */
  label: string
  /** One line on what goes in it. */
  hint: string
  /** Where it lands, relative to the record. */
  segment: string
  /** The destination opens its form from `?new=1`. */
  autoOpens: boolean
  icon: LucideIcon
}

export type RecordKind = 'project' | 'opportunity'

/**
 * A project's running commentary is `updates`; an opportunity's is
 * `opportunity_notes` at /notes (§4). Same act, two tables, so the wording
 * follows the record rather than pretending they are one thing — and the
 * project's names the AI pass, because that is what the extra step buys.
 */
function feedEntry(kind: RecordKind): LogEntry {
  return kind === 'opportunity'
    ? { label: 'Note', hint: 'Type progress, a call, a decision', segment: 'notes', autoOpens: true, icon: MessageSquare }
    : { label: 'Update', hint: 'Type or paste notes — AI extracts the rest', segment: 'updates', autoOpens: true, icon: MessageSquare }
}

/**
 * The menu, in the order a deal generates these: something was said, it got
 * written down, it created work, the work has a date, and paper arrived.
 *
 * `canLogMeeting` mirrors `MeetingsView`'s own `canEdit` — only an admin
 * creates a meeting record, so a non-admin is not offered a form they cannot
 * submit.
 */
export function logEntries(kind: RecordKind, canLogMeeting: boolean): LogEntry[] {
  return [
    ...(canLogMeeting
      ? [{
          label: 'Meeting',
          hint: 'Attendees, notes, decisions, a transcript',
          segment: 'meetings',
          autoOpens: true,
          icon: CalendarDays,
        } satisfies LogEntry]
      : []),
    feedEntry(kind),
    { label: 'Task', hint: 'Something we owe, with an owner', segment: 'tasks', autoOpens: true, icon: CheckSquare },
    { label: 'Milestone', hint: 'A date that binds us', segment: 'milestones', autoOpens: false, icon: Flag },
    { label: 'Document', hint: 'Upload a file to this deal', segment: 'documents', autoOpens: false, icon: FileUp },
  ]
}

/** The href for one entry on one record. */
export function logHref(basePath: string, entry: LogEntry): string {
  return `${basePath}/${entry.segment}${entry.autoOpens ? '?new=1' : ''}`
}
