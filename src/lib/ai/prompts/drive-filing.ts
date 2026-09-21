/**
 * Which subfolder does this document belong in?
 *
 * The team files its work in the `Ber Wilson Proper` shared drive, and each
 * project folder has its own subfolders chosen by a human -- `Deeds`,
 * `Land Legal`, `Previous Land Offers`. Those names are knowledge the platform
 * cannot derive: they reflect how this particular deal is being run. So the
 * candidate list is always the record's OWN folders, read live from Drive, and
 * the model's whole job is to pick one of them.
 *
 * The failure to design against is a confident wrong file. A document dropped in
 * the wrong folder of a tree the team trusts is worse than one sitting in
 * `_Unsorted`, because nobody goes looking for a file they believe is filed.
 * Hence: an explicit "unsure" answer is a first-class result, the model is told
 * to use it, and anything it returns that is not verbatim one of the candidates
 * is discarded rather than fuzzy-matched.
 */

export const DRIVE_FILING_PROMPT_VERSION = 'drive-filing-1.0'

export interface DriveFilingDecision {
  /** Verbatim one of the candidate folder names, or null when unsure. */
  folder: string | null
  /** 0..1. Below the caller's bar the document goes to _Unsorted regardless. */
  confidence: number
  /** One short clause. Shown in the document's filing note. */
  reason: string
}

export const DRIVE_FILING_SYSTEM_PROMPT = `You file documents into the correct folder for a construction and development company.

You are given a document (its file name, and usually a summary of its contents) and the EXACT list of folders that exist for this record. Choose the one folder it belongs in.

RULES
- Answer with a folder name copied EXACTLY from the candidate list, character for character. Do not reword, re-case, pluralise, or tidy it.
- Never invent a folder. If none of the candidates is clearly right, answer null.
- Answer null when the document could reasonably belong in two or more of the candidates. An ambiguous document is not a failure; filing it somewhere plausible but wrong is.
- Judge by what the document IS, not by who sent it or which company is named in it. A deed is a deed whoever emailed it.
- Confidence is your honest probability that a person who knows this project would file it exactly there. Use the full range. A generic name like "Scan_0043.pdf" with no summary is rarely above 0.4.

Return JSON only:
{"folder": "<exact candidate name or null>", "confidence": <0..1>, "reason": "<short clause>"}`

export function buildDriveFilingMessage(input: {
  fileName: string
  mimeType: string | null
  aiSummary: string | null
  recordName: string
  candidates: string[]
}): string {
  const lines = [
    `RECORD: ${input.recordName}`,
    '',
    'CANDIDATE FOLDERS (choose exactly one, or null):',
    ...input.candidates.map((c) => `- ${c}`),
    '',
    `DOCUMENT FILE NAME: ${input.fileName}`,
  ]
  if (input.mimeType) lines.push(`FILE TYPE: ${input.mimeType}`)
  if (input.aiSummary?.trim()) {
    lines.push('', 'WHAT THE DOCUMENT CONTAINS:', input.aiSummary.trim().slice(0, 4000))
  } else {
    lines.push(
      '',
      'No summary is available for this document -- judge from the file name alone, and be correspondingly less confident.'
    )
  }
  return lines.join('\n')
}
