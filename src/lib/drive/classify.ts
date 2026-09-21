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

/**
 * The starter set created only for a record whose folder has no subfolders.
 *
 * Measured 2026-09-20: 14 of 15 project folders had no subfolders at all, and
 * the one that did used names specific to how that deal is run. So this is a
 * fallback, never an imposition -- a record that already has folders keeps them
 * and is never given these.
 */
export const STANDARD_FOLDERS = [
  'Correspondence',
  'Proposals & Bids',
  'Contracts & Legal',
  'Drawings & Plans',
  'Reports & Studies',
  'Financials',
  UNSORTED_FOLDER,
] as const

/** Below this, the document goes to _Unsorted whatever the model picked. */
export const FILING_CONFIDENCE = 0.7

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
  { tokens: ['quitclaim', 'warranty deed', 'grant deed', ' deed'], folderHints: ['deed'] },
  { tokens: ['title commitment', 'title report', 'title policy'], folderHints: ['title', 'land legal', 'legal'] },
  { tokens: ['purchase agreement', 'psa ', 'sales agreement', 'contract', 'executed', 'mnda', ' nda', 'operating agreement'], folderHints: ['contract', 'legal'] },
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
