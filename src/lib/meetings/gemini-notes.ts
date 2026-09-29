/**
 * Split a Google Meet "Notes by Gemini" document into its recap and its
 * verbatim transcript.
 *
 * Meet's Gemini note-taker writes ONE Google Doc per meeting, laid out as three
 * tabs which the text/plain export flattens into a single string separated by
 * emoji headings:
 *
 *   ✍️ Quick notes   — a short summary, duplicated from Full notes
 *   📝 Full notes    — Invited (with email addresses), Summary, Decisions,
 *                      Next steps (owners already in brackets), Details
 *   📖 Transcript    — the whole call, "Speaker Name: words", with timestamps
 *
 * Both halves are wanted, for different jobs:
 *
 * - the RECAP is what the extraction pass reads. It is ~10KB of dense,
 *   already-structured material in the exact shape the meeting-intake prompt
 *   expects, and feeding it alone keeps a 60-80KB export away from a local model
 *   whose real ceiling (LOCAL_MAX_CHARS, 40k) is lower than the MAX_CHARS guard
 *   that analyze-meeting.ts checks against.
 * - the TRANSCRIPT is the evidence. It is filed as the document so Ber AI can
 *   quote what somebody actually said, rather than only the recap of it.
 *
 * The Quick notes tab is dropped: it restates Full notes, and sending the model
 * the same summary twice invites it to treat the repetition as emphasis.
 */

/** Tab headings in the text/plain export. The emoji are Meet's, not ours. */
const QUICK_NOTES_MARKER = '✍️ Quick notes'
const FULL_NOTES_MARKER = '📝 Full notes'
const TRANSCRIPT_MARKER = '📖 Transcript'

/**
 * Google's own furniture: survey prompts and the transcript disclaimer. Left in,
 * these become chunks that compete with prose in retrieval — the same reason
 * mail-gateway wrappers are scrubbed in text-noise.ts.
 */
const BOILERPLATE = [
  'Please rate the new Quick notes tab by taking a short survey.',
  "You should review Gemini's notes to make sure they're accurate. Get tips and learn how Gemini takes notes",
  'How is the quality of these specific notes? Take a short survey to let us know your feedback, including how helpful the notes were for your needs.',
  'This editable transcript was computer generated and might contain errors. People can also change the text after it was created.',
]

export interface GeminiNotesParts {
  /** The recap — Full notes onward, or the whole document if it has no tabs. */
  notes: string
  /** The verbatim call, or null when transcription was off for the meeting. */
  transcript: string | null
}

/** Drop Google's survey/disclaimer lines and collapse the runs of blank lines
 *  the tab export leaves between every section. */
function tidy(text: string): string {
  const kept = text
    .split('\n')
    .filter((line) => !BOILERPLATE.includes(line.trim()))
    .join('\n')
  return kept.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Split one exported "Notes by Gemini" document.
 *
 * Tolerant by design: a document with no tab headings at all (transcription and
 * note-taking both off, or a format change at Google's end) comes back whole as
 * `notes` rather than empty. An empty `notes` would read to the importer as "too
 * short to review" and the meeting would be silently dropped.
 */
export function splitGeminiNotes(raw: string): GeminiNotesParts {
  // The export opens with a UTF-8 BOM and uses CRLF throughout; normalise both
  // so tidy()'s blank-run collapse and every downstream chunker see plain \n.
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

  const transcriptAt = text.indexOf(TRANSCRIPT_MARKER)
  const head = transcriptAt >= 0 ? text.slice(0, transcriptAt) : text
  const transcript = transcriptAt >= 0 ? tidy(text.slice(transcriptAt)) : null

  // Prefer Full notes; fall back to Quick notes, then to everything before the
  // transcript. Each step is a real document we would otherwise discard.
  const fullAt = head.indexOf(FULL_NOTES_MARKER)
  const quickAt = head.indexOf(QUICK_NOTES_MARKER)
  const notesRaw =
    fullAt >= 0 ? head.slice(fullAt) : quickAt >= 0 ? head.slice(quickAt) : head

  const notes = tidy(notesRaw)

  return {
    notes: notes || tidy(text),
    transcript: transcript && transcript.length > TRANSCRIPT_MARKER.length ? transcript : null,
  }
}

/** True when a file name looks like Meet's Gemini note-taker output. */
export function isGeminiNotesFile(name: string): boolean {
  return /notes by gemini/i.test(name)
}
