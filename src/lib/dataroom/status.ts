/**
 * WHAT A DATA ROOM HOLDS AND WHAT IT IS STILL MISSING — computed once.
 *
 * This is the answer behind both surfaces that need it: the Data Room view in
 * the platform, and `00.2 — Master Document Index & Outstanding Items`
 * published back into the deal's own Drive folder. §12 has been bitten
 * repeatedly by one quantity computed twice — three "needs attention" numbers
 * on one screen reading 1, 99+ and 197 — so there is one function and both
 * callers read its result.
 *
 * ⚠ IT NEVER GUESSES WHICH FILE SATISFIES WHICH REQUIREMENT, and that is the
 * central design decision. Richard's template lists the documents each section
 * expects ("ALTA/NSPS survey and parcel/legal descriptions", "Executed electric
 * service agreements and applicable tariffs"); matching those phrases to actual
 * file names is the same fuzzy problem that has cost this codebase more hours
 * than anything else, and a tracker that claims a requirement is satisfied when
 * it is not is worse than an empty one — a lender reads it as an assertion.
 *
 * So the structure is honest about what it knows:
 *
 *   - A CHECKLIST ROW per expected document, whose status comes from the
 *     `dd_items` row a human made, or is `Missing` when nobody has said
 *     otherwise. It links to the SECTION FOLDER, which is always right, and
 *     shows how many documents sit in that section.
 *   - A section's DOCUMENTS ON FILE, listed as they are. Nothing is hidden
 *     behind a requirement it might not answer.
 *
 * The human closes the gap by saying which document satisfies which line, and
 * `dd_items.document_id` records that decision. That is data entry the platform
 * genuinely cannot do for them, and it is the only kind left here.
 */

import { createAdminClient, createUntypedAdminClient } from '@/lib/supabase/admin'
import { attachSignoffs, type SectionSignoff } from './signoff'
import {
  DATA_CENTER_ROOM,
  UNSORTED_SECTION,
  WORKING_FOLDERS,
  isDraftPath,
  leafSections,
  sectionOf,
  sectionPath,
  type DataRoomSection,
} from '@/lib/drive/data-room'

/**
 * Richard's status vocabulary, verbatim.
 *
 * ⚠ DECLARED HERE AND NOT AS A CHECK ON THE COLUMN. A value outside a Postgres
 * CHECK fails the whole query rather than the row (§12, `22P02`), and this
 * vocabulary is still settling. An unrecognised stored value renders as itself.
 *
 * The first three and `Effective` can be DERIVED from what is on file. The rest
 * are judgements only a person holds — which is the whole point of
 * `Signed—Conditional`: Richard's instruction is to "track unresolved
 * conditions in signed agreements, not just whether we have a signed copy", and
 * no amount of reading the folder can tell you a condition is unmet.
 */
export const DATA_ROOM_STATUSES = [
  'Missing',
  'Requested',
  'Draft',
  'Signed—Conditional',
  'Effective',
  'Expired',
  'Not Applicable',
  'In Progress',
  'Final',
  'Approved',
] as const

export type DataRoomStatus = (typeof DATA_ROOM_STATUSES)[number]

/** Statuses that leave the item outstanding — what the summary counts. */
const OPEN_STATUSES = new Set<string>([
  'Missing',
  'Requested',
  'Draft',
  'Signed—Conditional',
  'Expired',
  'In Progress',
])

export function isOpenStatus(status: string): boolean {
  return OPEN_STATUSES.has(status)
}

/** One document sitting in the room, as the tracker shows it. */
export interface RoomDocument {
  id: string
  fileName: string
  /** The section it is filed in, or null for a working folder / unfiled. */
  section: string | null
  drivePath: string | null
  driveFileId: string | null
  uploadedAt: string | null
  /** Filed under `Drafts/` — never the operative instrument. */
  draft: boolean
  summary: string | null
}

/** One line of Richard's 00.2 tracker. */
export interface TrackerRow {
  sectionKey: string
  sectionLabel: string
  /** The expected-document line from the template. */
  expected: string
  status: DataRoomStatus | string
  /** True when the platform computed the status; false when a human set it. */
  derived: boolean
  /** How many documents are filed in this section at all. */
  documentsInSection: number
  /** The document a human nominated as satisfying this line, if any. */
  document: RoomDocument | null
  responsible: string | null
  counterparty: string | null
  documentDate: string | null
  expiresOn: string | null
  outstandingAction: string | null
  dueDate: string | null
  notes: string | null
  /** The `dd_items` row behind this line, when one exists. */
  itemId: string | null
}

export interface SectionStatus {
  section: DataRoomSection
  path: string
  documents: RoomDocument[]
  drafts: number
  rows: TrackerRow[]
  /** Nothing on file and nobody has said it is not needed. */
  missing: boolean
  /** A human's sign-off on this shelf, with whether it has gone stale. */
  signoff: SectionSignoff | null
}

export interface RoomStatus {
  kind: 'project' | 'opportunity'
  recordId: string
  recordName: string
  driveFolderId: string | null
  sections: SectionStatus[]
  /** Live documents in the room, filed into a numbered section. */
  filed: number
  /** In `Correspondence` / `Meetings` / `Proposals & Bids` — working, not diligence. */
  working: number
  /** In `00.0 — _Unsorted` — the classifier could not place them. */
  unsorted: number
  /** On the record but with no Drive folder path at all. */
  notInDrive: number
  /** In a Drive folder that is neither a section nor a working folder. */
  outsideTemplate: number
  /**
   * Requirements a PERSON has recorded as outstanding.
   *
   * ⚠ HUMAN-RECORDED ONLY, AND THAT IS THE WHOLE POINT. Counting derived
   * statuses too gave **112 on every single room** — Riverdale with 39
   * documents, Steelton with 159 and GridEdge with none all read 112 — because
   * every requirement without a `dd_items` row derives to `Missing` or
   * `In Progress`, and both are "open". 119 requirements minus the 7 under the
   * one optional section is 112, for everybody, forever. §12: a line that is
   * identical for every reader carries no information, and when every row is
   * red, red has stopped signifying. So this counts the judgements somebody
   * actually made, which is 0 until the tracker is used — honest, and it moves.
   */
  openItems: number
  /**
   * Requirements whose section holds nothing at all.
   *
   * The quantity the other one was being asked to carry, and it VARIES:
   * Riverdale 13 sections empty, Steelton 8, GridEdge 18. Named apart from
   * `openItems` and never summed with it — two different questions.
   */
  missingRequirements: number
  /** Sections with nothing on file and no decision recorded. */
  emptySections: number
  /**
   * Sections a human has signed off and whose document set has NOT changed
   * since. This is the completion figure — `11 of 19`.
   */
  signedOff: number
  /**
   * Signed off, but the documents have changed since. Counted APART and never
   * summed with `signedOff`: a stale tick is not progress, and §12 is explicit
   * that two different quantities must be named apart.
   */
  staleSignoffs: number
  /** Leaf sections on this template — the denominator. 19. */
  sectionCount: number
}

interface DocRow {
  id: string
  file_name: string
  drive_folder_path: string | null
  drive_file_id: string | null
  uploaded_at: string | null
  ai_summary: string | null
}

interface ItemRow {
  id: string
  item: string
  status: string
  section_key: string | null
  counterparty: string | null
  document_date: string | null
  expires_on: string | null
  outstanding_action: string | null
  due_date: string | null
  notes: string | null
  document_id: string | null
  assigned_to: string | null
}

const WORKING = new Set<string>(WORKING_FOLDERS)

/**
 * Derive a status from what is on file, when no human has recorded one.
 *
 * ⚠ IT ONLY EVER RETURNS THE THREE THINGS A FOLDER CAN PROVE. A document being
 * present means a document is present — not that it is effective, not that its
 * conditions are met, not that it is the right one. `Effective` is deliberately
 * NOT derived from presence: Richard's own filing instruction is "do not label
 * site control, power, or compute capacity as secured solely because an LOI or
 * preliminary letter exists", and deriving `Effective` from a file in a folder
 * would do exactly that, on the section where it matters most.
 */
export function deriveStatus(section: DataRoomSection, docs: RoomDocument[]): DataRoomStatus {
  if (docs.length === 0) return section.optional ? 'Not Applicable' : 'Missing'
  if (docs.every((d) => d.draft)) return 'Draft'
  return 'In Progress'
}

function asDocument(row: DocRow): RoomDocument {
  return {
    id: row.id,
    fileName: row.file_name,
    section: sectionOf(row.drive_folder_path),
    drivePath: row.drive_folder_path,
    driveFileId: row.drive_file_id,
    uploadedAt: row.uploaded_at,
    draft: isDraftPath(row.drive_folder_path),
    summary: row.ai_summary,
  }
}

/**
 * Read one record's room.
 *
 * Returns null when the record is not on the data-room template — the caller
 * should show nothing rather than an empty room, because a room of nineteen
 * "Missing" rows on a plumbing acquisition is noise that teaches people to
 * ignore the surface.
 *
 * ⚠ CONTAINMENT IS THE CALLER'S, exactly as `recordDriveFolder` says of itself:
 * this answers "what is in the room", not "may this leave the box". Anything
 * that PUBLISHES must check `isConfidentialProject` first.
 */
export async function readRoomStatus(
  kind: 'project' | 'opportunity',
  recordId: string
): Promise<RoomStatus | null> {
  const supabase = createAdminClient()
  const table = kind === 'project' ? 'projects' : 'opportunities'
  const docTable = kind === 'project' ? 'documents' : 'opportunity_documents'
  const parentCol = kind === 'project' ? 'project_id' : 'opportunity_id'

  const { data: record, error: recErr } = await supabase
    .from(table)
    .select('id, name, drive_source_folder_id, data_room_template')
    .eq('id', recordId)
    .maybeSingle()
  if (recErr) throw new Error(`${table}: ${recErr.message}`)
  if (!record || record.data_room_template !== 'data_center') return null

  /**
   * ⚠ `superseded_at is null` AND `excluded_at is null`. §12: read `documents`
   * with the first or the graveyard reads as a gap — and a document a human
   * marked "not knowledge" is a tombstone, not a holding.
   */
  // ⚠ The untyped client, because the TABLE is chosen at run time. §4 keeps it
  // for exactly this: a dynamic-table read the generated client cannot infer.
  // The shape is asserted by `DocRow` and the column list below is the contract.
  const { data: docRows, error: docErr } = await createUntypedAdminClient()
    .from(docTable)
    .select('id, file_name, drive_folder_path, drive_file_id, uploaded_at, ai_summary')
    .eq(parentCol, recordId)
    .is('superseded_at', null)
    .is('excluded_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(2000)
  if (docErr) throw new Error(`${docTable}: ${docErr.message}`)

  const docs = ((docRows ?? []) as DocRow[]).map(asDocument)
  const byId = new Map(docs.map((d) => [d.id, d]))

  const { data: signoffRows, error: signErr } = await supabase
    .from('data_room_signoffs')
    .select(
      'id, section_key, signed_off_by, signed_off_by_name, signed_off_at, document_count, document_fingerprint, note'
    )
    .eq(parentCol, recordId)
  if (signErr) throw new Error(`data_room_signoffs: ${signErr.message}`)

  const { data: itemRows, error: itemErr } = await supabase
    .from('dd_items')
    .select(
      'id, item, status, section_key, counterparty, document_date, expires_on, outstanding_action, due_date, notes, document_id, assigned_to'
    )
    .eq(parentCol, recordId)
  if (itemErr) throw new Error(`dd_items: ${itemErr.message}`)
  const items = (itemRows ?? []) as unknown as ItemRow[]

  // Responsible person is a name, not a uuid, or the tracker is unreadable.
  const partyIds = [...new Set(items.map((i) => i.assigned_to).filter(Boolean) as string[])]
  const partyNames = new Map<string, string>()
  if (partyIds.length) {
    // ⚠ `full_name`, not `name` — caught by the typed client, which is the
    // argument for using it everywhere the table is known at compile time.
    const { data: parties } = await supabase
      .from('parties')
      .select('id, full_name')
      .in('id', partyIds)
    for (const p of parties ?? []) if (p.full_name) partyNames.set(p.id, p.full_name)
  }

  // An item is matched to its line by (section, item text) — the pair a human
  // filled in. Keyed rather than searched: two lines in one section may
  // legitimately read similarly and only exact text is evidence of sameness.
  const itemByLine = new Map<string, ItemRow>()
  for (const i of items) {
    if (i.section_key) itemByLine.set(`${i.section_key} ${i.item}`, i)
  }

  // Grouped once, so the sign-off staleness check and the section rows read the
  // same set — two passes filtering independently is how one quantity becomes
  // two answers.
  const bySection = new Map<string, RoomDocument[]>()
  for (const d of docs) {
    if (!d.section) continue
    const list = bySection.get(d.section)
    if (list) list.push(d)
    else bySection.set(d.section, [d])
  }
  const signoffs = attachSignoffs(signoffRows ?? [], bySection)

  const sections: SectionStatus[] = []
  for (const section of leafSections(DATA_CENTER_ROOM)) {
    if (section.key === UNSORTED_SECTION) continue
    const mine = bySection.get(section.key) ?? []
    const rows: TrackerRow[] = section.expects.map((expected) => {
      const item = itemByLine.get(`${section.key} ${expected}`) ?? null
      const derived = !item
      return {
        sectionKey: section.key,
        sectionLabel: section.label,
        expected,
        status: item?.status || deriveStatus(section, mine),
        derived,
        documentsInSection: mine.length,
        document: item?.document_id ? (byId.get(item.document_id) ?? null) : null,
        responsible: item?.assigned_to ? (partyNames.get(item.assigned_to) ?? null) : null,
        counterparty: item?.counterparty ?? null,
        documentDate: item?.document_date ?? null,
        expiresOn: item?.expires_on ?? null,
        outstandingAction: item?.outstanding_action ?? null,
        dueDate: item?.due_date ?? null,
        notes: item?.notes ?? null,
        itemId: item?.id ?? null,
      }
    })

    sections.push({
      section,
      path: sectionPath(section, DATA_CENTER_ROOM),
      documents: mine,
      drafts: mine.filter((d) => d.draft).length,
      rows,
      missing: mine.length === 0 && !section.optional,
      signoff: signoffs.get(section.key) ?? null,
    })
  }

  const filed = docs.filter((d) => d.section && d.section !== UNSORTED_SECTION).length
  const unsorted = docs.filter((d) => d.section === UNSORTED_SECTION).length
  const notInDrive = docs.filter((d) => !d.drivePath).length
  const working = docs.filter((d) => {
    if (!d.drivePath || d.section) return false
    return WORKING.has(d.drivePath.split('/')[0]?.trim() ?? '')
  }).length

  return {
    kind,
    recordId,
    recordName: record.name ?? '',
    driveFolderId: record.drive_source_folder_id,
    sections,
    filed,
    working,
    unsorted,
    notInDrive,
    outsideTemplate: docs.length - filed - unsorted - notInDrive - working,
    openItems: sections.reduce(
      (n, s) => n + s.rows.filter((r) => !r.derived && isOpenStatus(String(r.status))).length,
      0
    ),
    missingRequirements: sections.reduce(
      (n, s) => n + s.rows.filter((r) => r.derived && r.status === 'Missing').length,
      0
    ),
    signedOff: sections.filter((s) => s.signoff && !s.signoff.stale).length,
    staleSignoffs: sections.filter((s) => s.signoff?.stale).length,
    sectionCount: sections.length,
    emptySections: sections.filter((s) => s.missing).length,
  }
}
