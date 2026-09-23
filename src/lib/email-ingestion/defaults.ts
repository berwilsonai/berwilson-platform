/**
 * What a staged session would create if nobody changed anything.
 *
 * This existed twice in spirit and nowhere in fact. `EmailIngestReview` seeded
 * its form state from the extraction using four rules, and the only way to act
 * on a session was to render that form and press its button — so accepting a
 * session from anywhere else meant restating the rules. Two copies of a mapping
 * this load-bearing is exactly how the 2026-09-17 `runDocumentAiPass` fork
 * drifted, and that one silently discarded 413,000 characters.
 *
 * So the rules live here, once, and both the review screen and the Decide
 * queue's Accept button read them. The form still lets a human change anything;
 * what this removes is the need to OPEN the form in order to agree with it.
 *
 * ⚠ This creates nothing on its own. It builds a request body. CLAUDE.md §11 is
 * satisfied by the human who clicks, not by this function.
 */

import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'
import type { StagedAttachment } from '@/lib/email-ingestion/attachments'
import type { RecordKind } from '@/lib/email-ingestion/confirm-helpers'

export interface PartyAction {
  name: string
  email: string | null
  company: string | null
  title: string | null
  role: string | null
  is_organization: boolean
  action: 'create' | 'link' | 'skip'
  existing_party_id?: string | null
}

export interface TaskAction {
  title: string
  what: string | null
  why: string | null
  how: string | null
  assignee: string | null
  due_date: string | null
  include: boolean
}

export interface ConfirmBody {
  session_id: string
  record_kind: RecordKind
  record_fields: Record<string, unknown>
  party_actions: PartyAction[]
  task_actions: TaskAction[]
  /** Storage paths of staged attachments to promote onto the created record. */
  attachment_paths?: string[]
}

export interface SessionDraft {
  body: ConfirmBody
  /** False when the draft cannot be created as-is; `blocker` says why. */
  ready: boolean
  /** One short sentence naming what a human must supply. Null when ready. */
  blocker: string | null
  /** The record's name, for a confirmation dialog that names what it creates. */
  recordName: string | null
}

/**
 * The record's fields for a given kind, in the exact shape the confirm route
 * writes. Field-for-field with the two branches the review form renders — a
 * field added to one must be added to the other, which is why they sit
 * adjacent rather than in separate modules.
 */
export function recordFieldsFor(
  kind: RecordKind,
  e: EmailIntakeExtraction
): Record<string, unknown> {
  return kind === 'project'
    ? {
        name: e.project.name,
        sector: e.project.sector,
        stage: e.project.stage,
        description: e.project.description,
        estimated_value: e.project.estimated_value,
        contract_type: e.project.contract_type,
        delivery_method: e.project.delivery_method,
        location: e.project.location,
        client_entity: e.project.client_entity,
      }
    : {
        name: e.opportunity.name,
        opp_type: e.opportunity.opp_type,
        sector: e.opportunity.sector,
        location: e.opportunity.location,
        objective: e.opportunity.objective,
        thesis: e.opportunity.thesis,
        target_name: e.opportunity.target_name,
        counterparty: e.opportunity.counterparty,
        estimated_value: e.opportunity.estimated_value,
        next_step: e.opportunity.next_step,
      }
}

/**
 * Whether a person defaults to being linked to an existing contact or created.
 *
 * A match of any type other than 'none' links. That is the review form's own
 * rule and deliberately not stricter: the matcher already refuses when it is
 * unsure, so second-guessing it here would create duplicate contacts for people
 * the directory already holds.
 */
function partyAction(index: number, matches: PartyMatch[]): PartyAction['action'] {
  return matches.some((m) => m.extracted_index === index && m.match_type !== 'none')
    ? 'link'
    : 'create'
}

export function buildConfirmBody(input: {
  sessionId: string
  extraction: EmailIntakeExtraction
  partyMatches: PartyMatch[]
  stagedAttachments: StagedAttachment[]
}): SessionDraft {
  const { sessionId, extraction, partyMatches, stagedAttachments } = input
  const kind: RecordKind = extraction.suggested_record
  const record_fields = recordFieldsFor(kind, extraction)

  const name = typeof record_fields.name === 'string' ? record_fields.name.trim() : ''

  const body: ConfirmBody = {
    session_id: sessionId,
    record_kind: kind,
    record_fields,
    party_actions: extraction.people.map((p, i) => {
      const match = partyMatches.find(
        (m) => m.extracted_index === i && m.match_type !== 'none'
      )
      return {
        name: p.name,
        email: p.email,
        company: p.company,
        title: p.title,
        role: p.role,
        is_organization: p.is_organization,
        action: partyAction(i, partyMatches),
        existing_party_id: match?.matched_party_id ?? null,
      }
    }),
    // Every task and every attachment is included by default, matching the
    // form's own checkboxes. A task nobody wants is one click to close; a task
    // silently dropped is work that never happened.
    task_actions: extraction.tasks.map((t) => ({
      title: t.title,
      what: t.what,
      why: t.why,
      how: t.how,
      assignee: t.assignee,
      due_date: t.due_date,
      include: true,
    })),
    attachment_paths: stagedAttachments.map((a) => a.storage_path),
  }

  // The ONLY thing that blocks creation. Measured against the live backlog on
  // 2026-09-23: 65 of 69 `create` sessions carry a name for their suggested
  // kind and 4 do not. Everything else the record needs is optional at the
  // schema and optional in the form, so treating a missing value or sector as a
  // blocker would send a human to a form with nothing for them to do.
  if (!name) {
    return {
      body,
      ready: false,
      blocker: `Needs ${kind === 'opportunity' ? 'an' : 'a'} ${kind} name — the correspondence never states one.`,
      recordName: null,
    }
  }

  return { body, ready: true, blocker: null, recordName: name }
}
