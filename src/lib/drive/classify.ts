/**
 * Choosing the subfolder a document is filed into.
 *
 * Two-stage by design, because the local model costs 30-60s per call and most
 * documents do not need it: a deterministic pass first for names that state
 * plainly what they are ("Quitclaim Deed - Parcel 4.pdf" against a folder called
 * "Deeds"), then the model only for what is genuinely a judgement.
 *
 * Everything funnels through `coerce()`, which accepts a folder name ONLY if it
 * is verbatim one of the candidates. A model that returns "Deeds folder" or
 * "deeds" gets nothing -- no fuzzy matching, no trimming into a match. The names
 * come from Drive and are compared against Drive; near-misses in this codebase
 * have historically been trailing-space bugs, and silently resolving one would
 * file into a folder the operator did not mean.
 */

import { callGemini } from '@/lib/ai/gemini'
import {
  DRIVE_FILING_PROMPT_VERSION,
  DRIVE_FILING_SYSTEM_PROMPT,
  buildDriveFilingMessage,
  type DriveFilingDecision,
} from '@/lib/ai/prompts/drive-filing'
import { SYSTEM_USER_ID } from '@/lib/email-ingestion/analyze'

/** Where a document goes when nothing else is clearly right. */
export const UNSORTED_FOLDER = '_Unsorted'

/** The one folder allowed to nest. Declared before STANDARD_FOLDERS, which names it. */
export const DILIGENCE_FOLDER = 'Diligence'

/**
 * Separator shown to the model in a nested candidate (`Diligence/Environmental`).
 *
 * ⚠ A Drive folder name CAN contain a slash -- this drive has one called
 * `Fort Polk / Johnson - Design Build Matocc`. So a candidate is NEVER split on
 * this to decide whether it is a path. Nesting is a property of the candidates
 * WE generate: `isDiligencePath` tests membership of {@link DILIGENCE_PATHS},
 * and anything else is one folder name however many slashes it contains.
 */
export const FOLDER_PATH_SEP = '/'

/**
 * The set EVERY record gets, whatever else it already has.
 *
 * This was a fallback until 2026-10-08 -- created only for a folder with no
 * subfolders, on the reasoning that a deal with its own names ("Deeds", "Land
 * Legal") knows how it is run better than we do. Measured against the real
 * drive, that reasoning cost exactly what it was meant to protect: the three
 * biggest deals (Steelton, Helper, Stockton) each offered the classifier a
 * different menu, so the same document filed three different ways, and the
 * filename rules below -- which hint on 'deed', 'title', 'contract' -- matched
 * on some projects and not others.
 *
 * So it is now a FLOOR: ensured alongside whatever a human made, never
 * replacing it. A record's own folders stay candidates too.
 */
export const STANDARD_FOLDERS = [
  'Contracts & Legal',
  'Correspondence',
  DILIGENCE_FOLDER,
  'Drawings & Plans',
  'Financials',
  'Insurance & Bonding',
  'Land & Title',
  'Meetings',
  'Proposals & Bids',
  'Reports & Studies',
  UNSORTED_FOLDER,
] as const

/**
 * The one folder allowed to nest, and the lanes under it.
 *
 * A land/power deal generates more paperwork than the ten top-level folders can
 * separate -- the Steelton data room is 175 files, 65 of them environmental.
 * Flattening that into "Reports & Studies" loses the thing a diligence list is
 * for. These names come from the vocabulary of the team's own due-diligence
 * workbook (power ramp, grid vs behind-the-meter, water for liquid cooling,
 * permits, fiber, rail), so a document and a checklist line share a word.
 *
 * NOT pre-created: they are offered to the classifier as `Diligence/<lane>`
 * paths and the folder is made when the first document actually lands in it, so
 * a prefab steel residence shows a bare `Diligence` and Steelton shows seven.
 */
export const DILIGENCE_SUBFOLDERS = [
  'Power & Utilities',
  'Environmental',
  'Permits & Entitlements',
  'Water & Wastewater',
  'Fiber & Telecom',
  'Rail & Transportation',
  'Geotech & Site Reports',
] as const

/** `Diligence/Environmental` and friends -- offered as candidates, made on demand. */
export const DILIGENCE_PATHS: string[] = DILIGENCE_SUBFOLDERS.map(
  (s) => `${DILIGENCE_FOLDER}${FOLDER_PATH_SEP}${s}`
)

/**
 * Is this candidate one of ours, meaning two folders deep?
 *
 * Membership, never parsing -- see the warning on {@link FOLDER_PATH_SEP}.
 */
export function isDiligencePath(candidate: string): boolean {
  return DILIGENCE_PATHS.includes(candidate)
}

/**
 * The segments to ensure for a chosen candidate.
 *
 * One element for an ordinary folder (whatever its name contains), two for a
 * diligence lane.
 */
export function folderSegments(candidate: string): string[] {
  return isDiligencePath(candidate) ? candidate.split(FOLDER_PATH_SEP) : [candidate]
}

/** Below this, the document goes to _Unsorted whatever the model picked. */
export const FILING_CONFIDENCE = 0.7

/**
 * The Drive folder name for a record.
 *
 * Lives in src/lib rather than beside the script that first needed it, because
 * two scripts must agree on it exactly: one creates `02 Projects/<name>` and the
 * other looks the folder up by that name. Drift between them would create a
 * second folder rather than find the first.
 *
 * Trimmed and whitespace-collapsed on purpose. 16 of the 233 folders on this
 * drive carry a trailing space today, and `coerce()` below accepts a model's
 * answer only when it is VERBATIM a candidate — so an invisible character in a
 * folder name is a filing failure that reads as the model being wrong.
 */
export function driveFolderName(recordName: string): string {
  return recordName.replace(/\s+/g, ' ').trim()
}

export interface FolderChoice {
  /** Verbatim one of the candidates, or null meaning _Unsorted. */
  folderName: string | null
  confidence: number
  reason: string
  /** True when no model call was made. */
  deterministic: boolean
}

/**
 * Filename tokens that identify a document type beyond reasonable doubt.
 *
 * Deliberately short and boring. Every entry here is a phrase that means the
 * same thing in every project; anything context-dependent belongs to the model.
 * Order matters -- the first matching rule wins, so the more specific phrases
 * are listed before the general ones ("title commitment" before "title").
 */
const FILENAME_RULES: Array<{ tokens: string[]; folderHints: string[] }> = [
  // Power & utilities, from the due-diligence workbook's own vocabulary. First,
  // because "will-serve letter" and "load study" are contracts and reports in
  // every other sense and would otherwise be caught by the broader rules below.
  {
    tokens: ['will serve', 'will-serve', 'load study', 'rapid response', 'one-line', 'one line diagram', 'single line', 'interconnection', 'nameplate', 'substation', 'switchyard', 'kv ', 'mva', 'behind the meter', 'behind-the-meter'],
    folderHints: ['power & utilities', 'power', 'utilit', 'will serve'],
  },
  {
    tokens: ['phase i ', 'phase 1', 'phase ii', 'phase 2', 'wetland', 'npdes', 'stormwater', 'consent order', 'rcra', 'remediation', 'environmental'],
    folderHints: ['environmental'],
  },
  {
    tokens: ['title v', 'zoning', 'subdivision', 'land disturbance', 'air permit', 'conditional use', 'entitlement', 'rezone'],
    folderHints: ['permits & entitlements', 'permit', 'zoning', 'entitlement'],
  },
  {
    tokens: ['water withdrawal', 'wastewater', 'water intake', 'discharge', 'effluent'],
    folderHints: ['water & wastewater', 'water'],
  },
  { tokens: ['fiber', 'carrier letter', 'dark fiber', 'route diversity'], folderHints: ['fiber'] },
  { tokens: ['rail ', 'railroad', 'railway', 'stracnet', 'trackage', 'spur'], folderHints: ['rail'] },
  { tokens: ['alta', 'parcel schedule', 'legal description', 'easement', 'boundary survey'], folderHints: ['land & title', 'land', 'title'] },
  { tokens: ['quitclaim', 'warranty deed', 'grant deed', ' deed'], folderHints: ['deed', 'land & title'] },
  { tokens: ['title commitment', 'title report', 'title policy'], folderHints: ['land & title', 'title', 'land legal', 'legal'] },
  { tokens: ['certificate of insurance', ' coi ', 'bonding', 'surety', 'performance bond'], folderHints: ['insurance', 'bonding'] },
  { tokens: ['meeting minutes', 'transcript', 'meeting notes', 'agenda'], folderHints: ['meeting'] },
  // ' mou ' is padded on BOTH sides on purpose: `lower` is the file name
  // wrapped in spaces, so a bare 'mou' would match "Amount.pdf" and "Mountain
  // Survey.pdf". Every short token added here needs that check run in its head.
  { tokens: ['purchase agreement', 'psa ', 'sales agreement', 'contract', 'executed', 'mnda', ' nda', 'operating agreement', ' mou ', 'memorandum'], folderHints: ['contract', 'legal'] },
  { tokens: ['rfp', 'rfq', 'itb', 'invitation to bid', 'solicitation', 'proposal', 'addendum', 'bid '], folderHints: ['proposal', 'bid', 'solicitation'] },
  { tokens: ['drawing', 'plan set', 'site plan', 'floor plan', 'elevation', 'blueprint', '.dwg'], folderHints: ['drawing', 'plan', 'pre construction', 'preconstruction'] },
  { tokens: ['survey', 'geotech', 'environmental', 'phase 1', 'phase i ', 'feasibility', 'market analysis', 'appraisal'], folderHints: ['report', 'stud', 'analysis', 'record'] },
  { tokens: ['invoice', 'budget', 'pro forma', 'proforma', 'financial', 'loi', 'letter of intent', 'term sheet', 'offer'], folderHints: ['financial', 'offer', 'fundraising'] },
]

/**
 * A confident filename match, or null to defer to the model.
 *
 * Requires exactly ONE candidate folder to match the hint. Two matching folders
 * is the ambiguity this whole module exists to refuse.
 */
export function classifyByFilename(fileName: string, candidates: string[]): FolderChoice | null {
  const lower = ` ${fileName.toLowerCase()} `
  for (const rule of FILENAME_RULES) {
    if (!rule.tokens.some((t) => lower.includes(t))) continue
    const hits = candidates.filter((c) => {
      const cl = c.toLowerCase()
      return rule.folderHints.some((h) => cl.includes(h))
    })
    if (hits.length === 1) {
      return {
        folderName: hits[0],
        confidence: 0.9,
        reason: `file name identifies it and "${hits[0].trim()}" is the only matching folder`,
        deterministic: true,
      }
    }
    // A rule fired but the folders are ambiguous (or absent) -- that is exactly
    // the case worth spending a model call on, so stop scanning and defer.
    return null
  }
  return null
}

/** Accept a model answer only if it is verbatim a candidate. */
function coerce(raw: Partial<DriveFilingDecision> | null, candidates: string[]): FolderChoice {
  if (!raw || typeof raw !== 'object') {
    return { folderName: null, confidence: 0, reason: 'no usable answer from the model', deterministic: false }
  }
  const confidence = Number(raw.confidence)
  const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 300) : ''
  const picked = typeof raw.folder === 'string' ? raw.folder : null

  if (!picked) {
    return { folderName: null, confidence: Number.isFinite(confidence) ? confidence : 0, reason: reason || 'model was unsure', deterministic: false }
  }
  if (!candidates.includes(picked)) {
    return {
      folderName: null,
      confidence: 0,
      reason: `model returned "${picked.slice(0, 60)}", which is not one of this record's folders`,
      deterministic: false,
    }
  }
  return {
    folderName: picked,
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
    reason: reason || 'classified from contents',
    deterministic: false,
  }
}

/**
 * Pick the folder for one document.
 *
 * Never throws: a classifier failure must degrade to _Unsorted rather than fail
 * the import that called it.
 */
export async function chooseFolder(input: {
  fileName: string
  mimeType: string | null
  aiSummary: string | null
  recordName: string
  candidates: string[]
  userId?: string
}): Promise<FolderChoice> {
  // Anything the model could not change the answer to is not worth 30-60s.
  const decidable = input.candidates.filter((c) => c !== UNSORTED_FOLDER)
  if (decidable.length === 0) {
    return { folderName: null, confidence: 1, reason: 'no subfolders to choose between', deterministic: true }
  }

  const quick = classifyByFilename(input.fileName, decidable)
  if (quick) return quick

  try {
    const { data } = await callGemini<Partial<DriveFilingDecision>>({
      task: 'drive-filing',
      systemPrompt: DRIVE_FILING_SYSTEM_PROMPT,
      userMessage: buildDriveFilingMessage({ ...input, candidates: decidable }),
      userId: input.userId ?? SYSTEM_USER_ID,
      promptVersion: DRIVE_FILING_PROMPT_VERSION,
    })
    const choice = coerce(typeof data === 'object' ? data : null, decidable)
    if (choice.folderName && choice.confidence < FILING_CONFIDENCE) {
      return {
        folderName: null,
        confidence: choice.confidence,
        reason: `unsure (${choice.confidence.toFixed(2)}): ${choice.reason}`,
        deterministic: false,
      }
    }
    return choice
  } catch (err) {
    return {
      folderName: null,
      confidence: 0,
      reason: `classifier failed: ${err instanceof Error ? err.message : String(err)}`,
      deterministic: false,
    }
  }
}
