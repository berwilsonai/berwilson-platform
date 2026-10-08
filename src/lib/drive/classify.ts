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
  // ⚠ NO BARE 'title' HINT HERE OR BELOW. `'title'` is a SUBSTRING of
  // `Entitlements`, so it matches BOTH `Land & Title` and
  // `Diligence/Permits & Entitlements` — two hits, which `classifyByFilename`
  // correctly refuses as ambiguous. That made every land/title rule defer to
  // the model the moment the Diligence lanes became candidates (2026-10-08):
  // `alta`, `easement`, `title commitment`, `quitclaim` and `warranty deed` all
  // stopped firing, silently, on the deals with the most title work. `land` is
  // unambiguous and does the job. Asserted by `hintsAreUnambiguous()` below.
  { tokens: ['alta', 'parcel schedule', 'legal description', 'easement', 'boundary survey'], folderHints: ['land & title', 'land'] },
  { tokens: ['quitclaim', 'warranty deed', 'grant deed', ' deed'], folderHints: ['deed', 'land & title'] },
  { tokens: ['title commitment', 'title report', 'title policy'], folderHints: ['land & title', 'land legal'] },
  // `bond ` is padded, so "Bond Summary" matches and "Dura-Bond" (a contract
  // counterparty on Steelton) does not. 'claims' and 'loss run' are here
  // because a workers-comp claims register is an insurance exhibit, and
  // `Steelton WC Claims (Aug 2025).xlsx` had no rule at all.
  { tokens: ['certificate of insurance', 'certificate of liability', ' coi ', 'bonding', 'surety', 'performance bond', 'bond summary', 'bond ', 'wc claims', 'workers comp', 'loss run'], folderHints: ['insurance', 'bonding'] },
  { tokens: ['meeting minutes', 'transcript', 'meeting notes', 'agenda'], folderHints: ['meeting'] },
  // ' mou ' is padded on BOTH sides on purpose: `lower` is the file name
  // wrapped in spaces, so a bare 'mou' would match "Amount.pdf" and "Mountain
  // Survey.pdf". Every short token added here needs that check run in its head.
  // ⚠ `lease` and `assignment` were ABSENT, and both are the central document
  // class on a land/power acquisition — Steelton arrives by ASSIGNMENT of an
  // executed PSA, and the live thread is literally "Assignment Doc for
  // Steelton, Weirton and Riverdale". `consent decree` sits beside the existing
  // `consent order` for the same reason: one word apart, same document.
  { tokens: ['purchase agreement', 'psa ', 'sales agreement', 'contract', 'executed', 'mnda', ' nda', 'operating agreement', ' mou ', 'memorandum', 'assignment', 'lease', 'amendment', 'firpta', 'consent decree', 'organization chart', 'agreement'], folderHints: ['contract', 'legal'] },
  { tokens: ['rfp', 'rfq', 'itb', 'invitation to bid', 'solicitation', 'proposal', 'addendum', 'bid '], folderHints: ['proposal', 'bid', 'solicitation'] },
  { tokens: ['drawing', 'plan set', 'site plan', 'floor plan', 'elevation', 'blueprint', '.dwg'], folderHints: ['drawing', 'plan', 'pre construction', 'preconstruction'] },
  // ⚠ SPLIT, AND THE BARE 'report' HINT IS GONE. It matched both
  // `Reports & Studies` and `Diligence/Geotech & Site Reports` — so this rule,
  // the broadest in the table, had been refused as ambiguous on every record
  // since the Diligence lanes shipped. Found by `ambiguousHintRules()` while
  // fixing the 'title'/'Entitlements' collision, which is the argument for
  // having the guard rather than the fix.
  //
  // Splitting it is also more accurate than restoring it: a geotech report and
  // a market study are two different things, and there is now a lane for the
  // first. 'environmental' and 'phase 1' are dropped entirely — the
  // environmental rule above already claims them, so they were unreachable here.
  { tokens: ['geotech', 'soils report', 'boring log', 'site report', 'topographic', 'survey'], folderHints: ['geotech & site reports', 'geotech'] },
  { tokens: ['feasibility', 'market analysis', 'appraisal', 'quarterly report', 'progress report', 'annual report', 'study'], folderHints: ['reports & studies', 'stud'] },
  // Measured against the Steelton room: "2b - Accounts Receivable.xlsx",
  // "Balance Sheet Detail", "Fixed Asset Summary" and "Historical Scrap
  // Estimate.xlsx" all deferred to the model because none of them contains the
  // word "financial". An accounting exhibit is never named after the folder it
  // belongs in.
  { tokens: ['invoice', 'budget', 'pro forma', 'proforma', 'financial', 'loi', 'letter of intent', 'term sheet', 'offer', 'balance sheet', 'accounts payable', 'accounts receivable', 'fixed asset', 'income statement', 'general ledger', 'trial balance', 'cash flow', 'scrap estimate', 'rent roll'], folderHints: ['financial', 'offer', 'fundraising'] },
]

/**
 * A COUNTERPARTY'S OWN FOLDER NAME IS STRONGER EVIDENCE THAN A FILE NAME, AND
 * IT CLASSIFIES A WHOLE SUBTREE AT ONCE.
 *
 * ⚠ MEASURED 2026-10-08, which is the only reason these rules look like this.
 * `copy-data-room.mts` already had a folder map, keyed on the Steelton room's
 * EXACT folder names ("site reports-agencies", "water intake and discharge
 * information"). Against the real corpus that scored 24% on Steelton and
 * **0-6% on Weirton**, whose folders say the same things in different words
 * ("Project Weirton Steel-Railroad Information"). An exact-name map is a map of
 * one counterparty's habits.
 *
 * So these match on the DISTINGUISHING WORD. The value is highest exactly where
 * a file name is useless: `Project Weirton Steel-Railroad Information` holds 28
 * files called `2007 Brdg Insp-01.tif` … `-28.tif`, and the alternative to this
 * is 28 model calls at 30-60s each to re-derive what the folder already said.
 *
 * ORDER IS LOAD-BEARING — first match wins, so the narrower word goes first:
 * "Permits-TitleV" contains both `permit` and `title`, and it is a permit;
 * "Weirton Electrical Drawings" contains both `electrical` and `drawing`, and
 * it is electrical.
 */
const FOLDER_RULES: Array<{ tokens: string[]; folderHints: string[] }> = [
  { tokens: ['railroad', 'railway', 'rail info', 'trackage'], folderHints: ['rail'] },
  { tokens: ['electrical', 'single line', 'one-line', 'will serve', 'power verification', 'substation', 'utilit'], folderHints: ['power & utilities', 'power', 'utilit'] },
  { tokens: ['water intake', 'wastewater', 'discharge', 'water treatment'], folderHints: ['water & wastewater', 'water'] },
  { tokens: ['permit', 'title v', 'titlev', 'zoning', 'entitlement', 'licenses'], folderHints: ['permits & entitlements', 'permit', 'zoning'] },
  { tokens: ['environmental', 'rcra', 'vrp', 'stormwater', 'phase i', 'phase ii', 'hazardous'], folderHints: ['environmental'] },
  { tokens: ['fiber', 'telecom'], folderHints: ['fiber'] },
  { tokens: ['real estate', 'deed', 'alta', 'survey', 'parcel'], folderHints: ['land & title', 'land'] },
  { tokens: ['lease', 'legal', 'contract', 'organizational document', 'litigation', 'material contract', 'dura-bond'], folderHints: ['contract', 'legal'] },
  { tokens: ['insurance', 'bonding', 'surety'], folderHints: ['insurance', 'bonding'] },
  { tokens: ['financial', 'balance sheet', 'fixed asset', 'equipment', 'asset listing', 'income and expense', 'scrap estimate', 'accounts payable', 'accounts receivable'], folderHints: ['financial'] },
  { tokens: ['site overview', 'site report', 'site picture', 'site map', 'geotech', 'supplemental diligence'], folderHints: ['geotech & site reports', 'geotech'] },
  { tokens: ['drawing', 'plan set', 'blueprint'], folderHints: ['drawing', 'plan'] },
  { tokens: ['meeting', 'minutes'], folderHints: ['meeting'] },
  { tokens: ['proposal', 'bid', 'rfp', 'solicitation'], folderHints: ['proposal', 'bid'] },
]

/**
 * The folder a counterparty's own folder NAME implies, or null.
 *
 * Takes the whole relative path and reads it leaf-first: the deepest folder is
 * the most specific statement about the contents, and a parent is the fallback.
 * `Utilities/H2O Clarified or Demin (Tin Mill)/Clarification System` says
 * nothing at its leaf and "Utilities" at its root, which is the right answer.
 *
 * Same discipline as {@link classifyByFilename}: exactly ONE candidate may
 * match, because two is the ambiguity this module exists to refuse.
 */
export function classifyBySourceFolder(
  relativeFolder: string,
  candidates: string[]
): FolderChoice | null {
  const segments = relativeFolder.split(FOLDER_PATH_SEP).map((s) => s.trim()).filter(Boolean)
  for (const segment of [...segments].reverse()) {
    const lower = ` ${segment.toLowerCase()} `
    for (const rule of FOLDER_RULES) {
      if (!rule.tokens.some((t) => lower.includes(t))) continue
      const hits = candidates.filter((c) => {
        const cl = c.toLowerCase()
        return rule.folderHints.some((h) => cl.includes(h))
      })
      if (hits.length === 1) {
        return {
          folderName: hits[0],
          confidence: 0.9,
          reason: `the room filed it under "${segment}"`,
          deterministic: true,
        }
      }
      // A rule fired but the destination is ambiguous — stop scanning THIS
      // segment's rules and try the parent, rather than letting a later,
      // broader rule claim a folder this one already spoke for.
      break
    }
  }
  return null
}

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

/**
 * Every rule's hints must name AT MOST ONE of the standard candidates.
 *
 * ⚠ THIS EXISTS BECAUSE A HINT CAN MATCH A WORD THAT MERELY CONTAINS IT.
 * `'title'` is inside `Entitlements`, so the land rules matched both
 * `Land & Title` and `Diligence/Permits & Entitlements` and were refused as
 * ambiguous — correctly, by a guard doing its job on a collision nobody had
 * looked for. The rules then silently stopped firing on exactly the deals with
 * the most title work, and nothing reported it: a deferred file looks identical
 * to a file the model was always going to judge.
 *
 * Returns the offending rules, so a test or a script can name them. Checked
 * against the standard set only — a record's own curated folders are a caller's
 * business and may legitimately collide.
 */
export function ambiguousHintRules(): Array<{ tokens: string[]; hits: string[] }> {
  const candidates = [...STANDARD_FOLDERS, ...DILIGENCE_PATHS]
  const out: Array<{ tokens: string[]; hits: string[] }> = []
  for (const rule of [...FILENAME_RULES, ...FOLDER_RULES]) {
    const hits = candidates.filter((c) => {
      const cl = c.toLowerCase()
      return rule.folderHints.some((h) => cl.includes(h))
    })
    if (hits.length > 1) out.push({ tokens: rule.tokens, hits })
  }
  return out
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
