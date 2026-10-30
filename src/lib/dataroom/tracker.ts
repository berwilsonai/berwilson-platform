/**
 * `00.2 — Master Document Index & Outstanding Items`, published into the deal's
 * own Drive folder.
 *
 * Richard's instruction for 00.2 is to "create one tracker listing every
 * requested document and linking to its folder or file", with columns for
 * document name, status, responsible person, counterparty, document date,
 * expiration date, outstanding action and deadline — and to "track unresolved
 * conditions in signed agreements, not just whether we have a signed copy".
 *
 * It is published rather than typed because the platform already knows most of
 * it: the requirement list is the template's own `expects` lines, what is on
 * file is a query, and the folder link is derivable. Which leaves exactly the
 * columns a person has to judge, and those come from `dd_items`.
 *
 * ⚠ READ-ONLY, AND IT SAYS SO IN ITS FIRST ROW. The sheet is rebuilt WHOLE on
 * every run, so anything typed into it is overwritten on the next one —
 * §12: a destination that does not carry what creating carries reads as losing
 * the work. The task board earns the right to be written to because it reads
 * one cell back and settles the task; this does not read anything back, so the
 * only safe thing is to be unmistakable about it. Editing happens in the
 * platform, where it lands on `dd_items` and survives.
 *
 * ⚠ CONTAINMENT IS CHECKED HERE, not at the callers. Publishing is the one hole
 * a lock cannot close after the fact: the sheet lands in a shared drive partners
 * can be given access to and is NOT retracted when a project is protected
 * later. `publishRecordToDrive` puts its check at the choke point for exactly
 * this reason, and this follows it rather than inventing a second rule.
 */

import { isConfidentialProject } from '@/lib/security/confidential'
import { isGoogleConfigured, PRIMARY_MAILBOX } from '@/lib/integrations/google-workspace'
import { ensureFolder, folderUrl, upsertSheetFromCsv } from '@/lib/integrations/google-drive-write'
import { csvRow } from '@/lib/utils/csv'
import { folderName, sectionByKey } from '@/lib/drive/data-room'
import { isOpenStatus, readRoomStatus, type RoomStatus } from './status'

/** The file name in Drive. Stable, because it is also the lookup key. */
export const TRACKER_SHEET_NAME = '00.2 Master Document Index & Outstanding Items'

export interface TrackerResult {
  recordName: string
  url: string | null
  created: boolean
  requirements: number
  /** Recorded by a person as outstanding. */
  open: number
  /**
   * Derived: requirements whose section holds nothing.
   *
   * ⚠ Carried here as well as in the CSV because this result is what the cron
   * LOGS, and a nightly line reporting `open: 0` with no `missing` beside it
   * reads as a room with nothing outstanding — the opposite of the truth on a
   * room where 112 of 119 requirements have no document.
   */
  missing: number
  documents: number
  skipped?: string
}

const REQUIREMENT_COLUMNS = [
  'Section',
  'Requested document',
  'Status',
  'Set by',
  'Responsible',
  'Counterparty / source',
  'Document date',
  'Expiration',
  'Outstanding action',
  'Deadline',
  'Notes',
  'Documents in section',
  'Folder',
] as const

const DOCUMENT_COLUMNS = [
  'Section',
  'Document on file',
  'Draft?',
  'Filed',
  'Drive path',
  'Summary',
] as const

/** The Drive link for a section inside one room, or the room itself. */
async function sectionFolderLinks(status: RoomStatus): Promise<Map<string, string>> {
  const links = new Map<string, string>()
  if (!status.driveFolderId) return links

  // Resolved once per PARENT, then once per leaf: nineteen leaves under three
  // parents is 22 lookups, and `ensureFolder` caches per process on top.
  for (const section of status.sections) {
    const parent = section.section.parent ? sectionByKey(section.section.parent) : null
    try {
      let folderId = status.driveFolderId
      if (parent) folderId = (await ensureFolder(folderName(parent), folderId)).id
      const leaf = await ensureFolder(folderName(section.section), folderId)
      links.set(section.section.key, folderUrl(leaf.id))
    } catch {
      // A folder that cannot be resolved costs one blank link, never the sheet.
    }
  }
  return links
}

/**
 * The sheet, and the three counts taken FROM THE SAME PASS that wrote the rows.
 *
 * ⚠ Not recomputed by the caller. §12: one quantity, one definition — three
 * "needs attention" numbers on one screen read 1, 99+ and 197 because each was
 * derived separately. A tally built while emitting the rows cannot disagree
 * with them.
 */
export interface TrackerCsv {
  csv: string
  requirements: number
  /** Recorded by a person as outstanding. See `RoomStatus.openItems`. */
  open: number
  /** Derived: the section holds nothing. A different question, never summed. */
  missing: number
  documents: number
}

export function buildTrackerCsv(status: RoomStatus, links: Map<string, string>): TrackerCsv {
  const lines: string[] = []

  lines.push(
    csvRow([
      `${status.recordName} — Master Document Index & Outstanding Items`,
      '',
      `Generated by Ber Intelligence ${new Date().toISOString().slice(0, 10)}`,
    ])
  )
  lines.push(
    csvRow([
      'READ ONLY — this sheet is rebuilt from the platform. Anything typed here is overwritten. Edit in Ber Intelligence.',
    ])
  )
  lines.push('')

  lines.push(csvRow(['REQUESTED DOCUMENTS']))
  lines.push(csvRow([...REQUIREMENT_COLUMNS]))
  let requirements = 0
  let open = 0
  let missing = 0
  for (const section of status.sections) {
    for (const row of section.rows) {
      requirements++
      // ⚠ Two counts, never one. See `RoomStatus.openItems`: counting a derived
      // status as outstanding read 112 on every room in the portfolio.
      if (!row.derived && isOpenStatus(String(row.status))) open++
      if (row.derived && row.status === 'Missing') missing++
      lines.push(
        csvRow([
          `${row.sectionKey} ${row.sectionLabel}`,
          row.expected,
          row.status,
          // ⚠ Which half of the sheet a value came from is part of the answer:
          // "Missing" because nobody has looked is not the same claim as
          // "Missing" because somebody checked and said so.
          row.derived ? 'derived from the folder' : 'recorded by a person',
          row.responsible ?? '',
          row.counterparty ?? '',
          row.documentDate ?? '',
          row.expiresOn ?? '',
          row.outstandingAction ?? '',
          row.dueDate ?? '',
          row.notes ?? '',
          row.documentsInSection,
          links.get(row.sectionKey) ?? '',
        ])
      )
    }
  }

  lines.push('')
  lines.push(csvRow(['DOCUMENTS ON FILE']))
  lines.push(csvRow([...DOCUMENT_COLUMNS]))
  let documents = 0
  for (const section of status.sections) {
    for (const doc of section.documents) {
      documents++
      lines.push(
        csvRow([
          `${section.section.key} ${section.section.label}`,
          doc.fileName,
          doc.draft ? 'DRAFT — not executed' : '',
          doc.uploadedAt?.slice(0, 10) ?? '',
          doc.drivePath ?? '',
          doc.summary ?? '',
        ])
      )
    }
  }

  lines.push('')
  lines.push(csvRow(['WHERE EVERYTHING IS']))
  lines.push(csvRow(['Filed into a numbered section', status.filed]))
  lines.push(csvRow(['In a working folder (correspondence, meetings, bids)', status.working]))
  lines.push(csvRow(['In 00.0 — _Unsorted, awaiting a filing decision', status.unsorted]))
  lines.push(csvRow(['On the record but not in Drive', status.notInDrive]))
  lines.push(csvRow(['In a folder outside the template', status.outsideTemplate]))
  lines.push(csvRow(['Sections with nothing on file', status.emptySections]))
  lines.push(csvRow(['Requested documents with nothing on file in their section', missing]))
  lines.push(csvRow(['Outstanding items a person has recorded', open]))

  return { csv: lines.join('\n'), requirements, open, missing, documents }
}

/**
 * Publish one record's tracker. Returns `skipped` with a reason rather than
 * throwing, so a nightly pass over every room is not taken down by one of them.
 */
export async function publishTracker(
  kind: 'project' | 'opportunity',
  recordId: string
): Promise<TrackerResult | null> {
  const status = await readRoomStatus(kind, recordId)
  if (!status) return null

  const base: TrackerResult = {
    recordName: status.recordName,
    url: null,
    created: false,
    requirements: 0,
    open: status.openItems,
    missing: status.missingRequirements,
    documents: status.filed,
  }

  if (kind === 'project' && (await isConfidentialProject(recordId))) {
    return {
      ...base,
      skipped:
        'the project is protected, so nothing about it is written to Drive — a published copy is shared outside the tailnet and cannot be withdrawn',
    }
  }
  if (!isGoogleConfigured()) return { ...base, skipped: 'Google Workspace is not configured' }
  if (!status.driveFolderId) return { ...base, skipped: 'no Drive folder is linked' }

  const links = await sectionFolderLinks(status)
  const built = buildTrackerCsv(status, links)

  // It belongs in `00 — Start Here`, which is where a reader is told to begin.
  const startHere = sectionByKey('00')
  if (!startHere) return { ...base, skipped: 'the template has no 00 section' }
  const parent = await ensureFolder(folderName(startHere), status.driveFolderId)
  const section = sectionByKey('00.2')
  const folder = section ? await ensureFolder(folderName(section), parent.id) : parent

  const { ref, created } = await upsertSheetFromCsv({
    folderId: folder.id,
    name: TRACKER_SHEET_NAME,
    csv: built.csv,
    mailbox: PRIMARY_MAILBOX,
  })

  return {
    ...base,
    url: ref.webViewLink ?? null,
    created,
    requirements: built.requirements,
    open: built.open,
    missing: built.missing,
    documents: built.documents,
  }
}

/**
 * Every data-room record's tracker, newest-published last.
 *
 * ⚠ BUDGETED, because this runs inside the nightly Drive cron behind two other
 * phases. A pass that overruns its slot is a pass that silently stops happening.
 */
export async function publishAllTrackers(opts: { budgetMs?: number } = {}): Promise<{
  published: TrackerResult[]
  skipped: TrackerResult[]
  outOfTime: boolean
}> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()
  const deadline = Date.now() + (opts.budgetMs ?? 300_000)

  const published: TrackerResult[] = []
  const skipped: TrackerResult[] = []
  let outOfTime = false

  for (const [table, kind] of [
    ['projects', 'project'],
    ['opportunities', 'opportunity'],
  ] as const) {
    const { data } = await supabase
      .from(table)
      .select('id')
      .eq('data_room_template', 'data_center')
      .order('name')

    for (const row of data ?? []) {
      if (Date.now() > deadline) {
        outOfTime = true
        break
      }
      try {
        const result = await publishTracker(kind, row.id)
        if (!result) continue
        if (result.skipped) skipped.push(result)
        else published.push(result)
      } catch (err) {
        skipped.push({
          recordName: row.id,
          url: null,
          created: false,
          requirements: 0,
          open: 0,
          missing: 0,
          documents: 0,
          skipped: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return { published, skipped, outOfTime }
}
