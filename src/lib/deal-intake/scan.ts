/**
 * Deal intake scan — Drive folder → lead.
 *
 * The website form creates one folder per submitted deal and writes its
 * checklist answers into `_intake.json`. This finds folders that have no lead
 * yet and stages them.
 *
 * A pull rather than a push because the platform is tailnet-only: there is no
 * public endpoint for a form to POST to, and adding one would put the Studio
 * back on the internet. The manifest carries the answers verbatim, so nothing is
 * re-extracted by a model on the way in — the structure the form collected is
 * the structure that lands.
 *
 * Nothing here creates a project. The lead sits in the queue with a fit
 * assessment until a human presses Promote (§11).
 */

import { leadsDb } from '@/lib/leads/db'
import {
  listSubfolders,
  listFolder,
  fetchDriveFile,
  dealIntakeFolderId,
  type DriveFile,
} from '@/lib/integrations/google-drive'
import { CHECKLIST_BY_KEY, DEAL_CHECKLIST } from './checklist'
import { MANIFEST_NAME, parseManifestBytes, type DealIntake } from './parse'

export interface DealScanProgress {
  /** Subfolders found under the intake parent. */
  seen: number
  /** Leads created this run. */
  created: number
  /** Folders that already had a lead. */
  known: number
  /** Folders with no manifest yet — a submission still being written. */
  awaitingManifest: number
  failed: number
  errors: string[]
  outOfTime: boolean
}

/** The questions whose absence is worth telling the fit assessor about. */
const DEAL_REQUIRED = DEAL_CHECKLIST.filter((i) => i.required)

function folderUrl(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

/**
 * Turn the parsed manifest into a `leads` row.
 *
 * Field names mirror what triage writes for an email lead, so the queue, the
 * detail sheet, promotion, and the agent tools all treat both sources alike.
 */
function leadFromManifest(intake: DealIntake, folder: DriveFile) {
  // The checklist is what the fit assessor should weigh, so it is folded into
  // key_facts in the same string[] shape triage produces for email leads.
  // Written out with the question's LABEL, not its key: `fin_capital_stack` is
  // meaningless to a model reading it as evidence, and to a person reading the
  // card.
  const answered = Object.entries(intake.checklist)
    .filter(([, v]) => v.provided && v.answer)
    .map(([key, v]) => `${CHECKLIST_BY_KEY[key]?.label ?? key}: ${v.answer}`)

  // Required questions left blank are exactly what the fit assessor should
  // treat as gaps, and it already has a slot for that shape.
  const missing = DEAL_REQUIRED.filter(
    (spec) => !intake.checklist[spec.key]?.provided
  ).map((spec) => `Not provided at intake: ${spec.label}`)

  return {
    thread_id: null,
    source: 'web_form',
    mailbox: null,
    route: intake.route === 'unknown' ? 'construction' : intake.route,
    status: 'new',
    title: intake.title,
    received_at: intake.submitted_at ?? folder.modifiedTime ?? new Date().toISOString(),
    sender_name: intake.contact.name,
    sender_email: intake.contact.email,
    sender_company: intake.contact.company,
    sender_phone: intake.contact.phone,
    summary: intake.deal.summary,
    scope: intake.deal.scope,
    location: intake.deal.location,
    sector: intake.deal.sector,
    estimated_value: intake.deal.estimated_value,
    bid_due_date: intake.deal.bid_due_date,
    key_facts: answered,
    requirements: missing,
    // The website form is a known channel, not something triage guessed at.
    triage_confidence: 1,
    intake_answers: intake.checklist,
    drive_folder_id: folder.id,
    drive_folder_url: folderUrl(folder.id),
    // The sweep's score phase picks it up from here.
    score_state: 'pending',
  }
}

export async function scanDealIntake(
  opts: { budgetMs?: number; folderId?: string } = {}
): Promise<DealScanProgress> {
  const parentId = opts.folderId ?? dealIntakeFolderId()
  if (!parentId) {
    throw new Error(
      'No deal intake folder configured. Set GOOGLE_DEAL_INTAKE_FOLDER_ID to the Drive folder the website form creates deal folders inside.'
    )
  }

  const deadline = Date.now() + (opts.budgetMs ?? 4 * 60 * 1000)
  const db = leadsDb()

  const progress: DealScanProgress = {
    seen: 0,
    created: 0,
    known: 0,
    awaitingManifest: 0,
    failed: 0,
    errors: [],
    outOfTime: false,
  }

  const folders = await listSubfolders(parentId)
  progress.seen = folders.length
  if (folders.length === 0) return progress

  // One query for every folder rather than one per folder: this runs every 15
  // minutes forever, and all but the newest folder is already known.
  const { data: existing, error } = await db
    .from('leads')
    .select('drive_folder_id')
    .in('drive_folder_id', folders.map((f) => f.id))
  if (error) throw new Error(`Could not check existing leads: ${error.message}`)

  const seenIds = new Set(
    ((existing ?? []) as { drive_folder_id: string | null }[])
      .map((r) => r.drive_folder_id)
      .filter((id): id is string => !!id)
  )

  for (const folder of folders) {
    if (Date.now() >= deadline) {
      progress.outOfTime = true
      break
    }

    if (seenIds.has(folder.id)) {
      progress.known++
      continue
    }

    try {
      // Depth 1: the manifest lives at the folder root by contract, and a file
      // called _intake.json inside an uploaded subfolder is not the manifest.
      const contents = await listFolder(folder.id, { maxDepth: 1 })
      const manifest = contents.find((f) => f.name === MANIFEST_NAME)
      if (!manifest) {
        // The form writes the manifest last, so this is the normal state of a
        // submission still uploading — not an error, and it will be picked up
        // on the next pass.
        progress.awaitingManifest++
        continue
      }

      const content = await fetchDriveFile(manifest)
      if (!content) {
        progress.awaitingManifest++
        continue
      }

      const parsed = parseManifestBytes(content.buffer)
      if (!parsed.ok) throw new Error(parsed.error)

      const { error: insertErr } = await db
        .from('leads')
        .insert(leadFromManifest(parsed.value, folder))
      if (insertErr) {
        // 23505: the unique index on drive_folder_id caught a double-insert
        // (two runs overlapping). That is the latch working, not a failure.
        if (insertErr.code === '23505') {
          progress.known++
          continue
        }
        throw new Error(insertErr.message)
      }

      progress.created++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[deal-intake] ${folder.name} failed:`, message)
      progress.errors.push(`${folder.name}: ${message.slice(0, 200)}`)
      progress.failed++
    }
  }

  return progress
}
