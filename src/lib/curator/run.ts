/**
 * The nightly curator pass.
 *
 * ⚠ A PROTECTED PROJECT IS SKIPPED ENTIRELY, AND THE REASON IS THE DESIGN
 * RATHER THAN THE SCHEMA. Nothing here is outbound, so a confidentiality
 * filter is not strictly required to write to a protected record. But the only
 * thing that makes unattended writing safe is that every change is REPORTED —
 * in the morning note, which is an outbound channel a protected deal may never
 * reach (§12: anything that leaves the box takes the absolute answer with no
 * opt-out). A change she cannot report is a change nobody will ever see, which
 * is the one failure mode this whole design must not have. So: she does not
 * make it. The count of skipped protected records IS reported, because
 * withholding from a reader means handing them the count (§12).
 */

import { assertPepper, provDb } from '@/lib/provenance/db'
import { applyPeople, curateRecord, type CurateOutcome, type PersonMention, type PersonOutcome } from './fold'
import type { RecordKind } from './evidence'

export interface CuratorRunResult {
  ok: boolean
  dryRun: boolean
  /** Records examined, which is not the same as records changed. */
  considered: number
  skippedUnchanged: number
  skippedProtected: number
  fieldsWritten: number
  fieldsProposed: number
  peopleEnriched: number
  outcomes: CurateOutcome[]
  /** Contacts enriched, deduped by party across the whole run. */
  peopleOutcomes: PersonOutcome[]
  /** Named in the mail, matched to no contact. Reported, never created (§11). */
  unmatchedPeople: string[]
  errors: string[]
}

export async function runCurator(
  opts: { dryRun?: boolean; force?: boolean; only?: string } = {}
): Promise<CuratorRunResult> {
  const { dryRun = false, force = false, only } = opts

  // ⚠ Fail the run rather than write unattributed. If Pepper's seat has moved,
  // every change below would be logged as "system" and the audit trail that
  // replaces the approval gate would be silently worthless.
  await assertPepper()

  const result: CuratorRunResult = {
    ok: true,
    dryRun,
    considered: 0,
    skippedUnchanged: 0,
    skippedProtected: 0,
    fieldsWritten: 0,
    fieldsProposed: 0,
    peopleEnriched: 0,
    outcomes: [],
    peopleOutcomes: [],
    unmatchedPeople: [],
    errors: [],
  }

  const [projects, opportunities] = await Promise.all([
    provDb().from('projects').select('id, name, confidential').order('name'),
    provDb().from('opportunities').select('id, name').order('name'),
  ])
  if (projects.error) {
    result.ok = false
    result.errors.push(`projects: ${projects.error.message}`)
    return result
  }
  if (opportunities.error) {
    result.ok = false
    result.errors.push(`opportunities: ${opportunities.error.message}`)
    return result
  }

  const records: { kind: RecordKind; id: string; name: string; confidential: boolean }[] = [
    ...((projects.data ?? []) as { id: string; name: string; confidential: boolean | null }[]).map(
      (p) => ({ kind: 'project' as const, id: p.id, name: p.name, confidential: Boolean(p.confidential) })
    ),
    ...((opportunities.data ?? []) as { id: string; name: string }[]).map((o) => ({
      kind: 'opportunity' as const,
      id: o.id,
      name: o.name,
      confidential: false,
    })),
  ]

  const mentions: PersonMention[] = []

  for (const record of records) {
    if (only && record.id !== only && record.name !== only) continue
    if (record.confidential) {
      result.skippedProtected += 1
      continue
    }
    result.considered += 1

    const outcome = await curateRecord({
      kind: record.kind,
      recordId: record.id,
      name: record.name,
      dryRun,
      force,
    })

    if (outcome.error) {
      result.errors.push(`${record.kind} ${record.name}: ${outcome.error}`)
      result.ok = false
    }
    if (outcome.skippedUnchanged) {
      result.skippedUnchanged += 1
      continue
    }

    result.fieldsWritten += outcome.written.length
    result.fieldsProposed += outcome.proposed.length
    mentions.push(...outcome.mentions)

    // Only records where something happened are carried, so the report is the
    // changes rather than a roll call. A record that was examined and found
    // correct is counted in `considered` and named nowhere, which is right.
    if (outcome.written.length > 0 || outcome.proposed.length > 0) {
      result.outcomes.push(outcome)
    }
  }

  // ── Contacts, once, across the whole run ──────────────────────────────────
  //
  // ⚠ AFTER THE LOOP ON PURPOSE. `parties` is global: enriching inside the
  // per-record loop wrote to Eric's row eleven times in one pass, each with a
  // different reading of his own title, and the last record to run won. See
  // the note in fold.ts on deduping by the matched party.
  const people = await applyPeople({ mentions, dryRun })
  if (people.error) {
    result.ok = false
    result.errors.push(`people: ${people.error}`)
  }
  result.peopleOutcomes = people.outcomes
  result.unmatchedPeople = people.unmatched
  for (const p of people.outcomes) {
    result.fieldsWritten += p.written.length
    result.fieldsProposed += p.proposed.length
    if (p.written.length > 0) result.peopleEnriched += 1
  }

  return result
}
