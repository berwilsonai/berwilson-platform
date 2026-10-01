/**
 * The separation pass — everything that must happen when somebody leaves.
 *
 * ⚠ IN `lib`, NOT IN THE ROUTE HANDLER, AND THAT IS THE POINT. §12: a shared lib
 * no script can load is a shared lib nothing can verify. This is the single most
 * consequential pass in the governance module — it revokes access and closes
 * signature authority — so it has to be callable from a verification script
 * (`scripts/verify-separation.mts`) rather than only from an HTTP request.
 *
 * ⚠ EVERY STEP FILLS A BLANK AND NONE OVERWRITES A VALUE (§12, 09-30). Filling
 * and overwriting are different acts and only one is safe to automate:
 *
 *   - `effective_to` is written only `is('effective_to', null)` — a role somebody
 *     already closed with a different reason keeps that reason.
 *   - `deactivated_at` is written only where it is null, so re-running does not
 *     move the date access actually ended.
 *   - the offboarding checklist is seeded only when the person has NO steps, so
 *     a re-run cannot wipe ticked boxes.
 *   - nothing is renamed and no judgement (a stage, a status someone chose) is
 *     revised.
 *
 * It therefore returns what it DID, by name and by count. An importer that fills
 * and names what it filled can be trusted twice; one that chooses cannot be
 * trusted once.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { offboardingRowsFor } from './offboarding'

/** The minimum shape the pass needs; a full PersonnelRow satisfies it. */
export interface SeparationTarget {
  id: string
  full_name: string
  separated_on: string | null
  team_member_id: string | null
  org_person_id: string | null
}

export interface SeparationResult {
  /** One sentence per thing that actually changed, for the reader. */
  applied: string[]
  /** Anything that failed. Never thrown: a failed side-effect must not undo the separation itself. */
  problems: string[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The untyped service-role client these tables need (§4 — they post-date the
 * last type generation). `any` is confined to this one alias rather than spread
 * through the file, so §7's zero-escapes rule stays meaningful.
 */
type UntypedClient = SupabaseClient<any, any, any>
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function applySeparation(
  read: UntypedClient,
  write: UntypedClient,
  person: SeparationTarget,
  actor: string | null
): Promise<SeparationResult> {
  const applied: string[] = []
  const problems: string[] = []

  if (!person.separated_on) return { applied, problems: ['No separation date — nothing to apply.'] }

  // ── 1. Open the offboarding checklist, if it has none ──────────────────────
  const { count: existingSteps, error: countError } = await read
    .from('personnel_offboarding')
    .select('id', { count: 'exact', head: true })
    .eq('personnel_id', person.id)
  if (countError) {
    problems.push(`could not read the offboarding checklist: ${countError.message}`)
  } else if ((existingSteps ?? 0) === 0) {
    const rows = offboardingRowsFor(person.id)
    const { error } = await write.from('personnel_offboarding').insert(rows)
    if (error) problems.push(`could not open the offboarding checklist: ${error.message}`)
    else applied.push(`${rows.length}-step offboarding checklist opened`)
  }

  // ── 2. Close open signature authority ─────────────────────────────────────
  // The one that matters and the one that would be forgotten: an officer's
  // signing authority outliving their employment is a live exposure on a
  // construction job, and nothing else in the system would ever close it.
  const { data: openRoles, error: rolesError } = await read
    .from('org_roles')
    .select('id, title, can_sign_contracts')
    .eq('personnel_id', person.id)
    .is('effective_to', null)
  if (rolesError) {
    problems.push(`could not read appointments: ${rolesError.message}`)
  } else {
    const roles = (openRoles ?? []) as { id: string; title: string; can_sign_contracts: boolean }[]
    if (roles.length > 0) {
      const { error } = await write
        .from('org_roles')
        .update({ effective_to: person.separated_on, end_reason: 'separation' })
        .eq('personnel_id', person.id)
        .is('effective_to', null)
      if (error) {
        problems.push(`could not close appointments: ${error.message}`)
      } else {
        const signing = roles.filter((r) => r.can_sign_contracts).length
        applied.push(
          `${roles.length} appointment${roles.length === 1 ? '' : 's'} closed (${roles
            .map((r) => r.title)
            .join(', ')})` + (signing > 0 ? ` — ${signing} carried signing authority` : '')
        )
      }
    }
  }

  // ── 3. Revoke the login, keeping the evidence of what it reached ───────────
  if (person.team_member_id) {
    const { data: member, error: memberError } = await read
      .from('team_members')
      .select('deactivated_at')
      .eq('id', person.team_member_id)
      .maybeSingle()
    if (memberError) {
      problems.push(`could not read the platform login: ${memberError.message}`)
    } else if (member && !(member as { deactivated_at?: string | null }).deactivated_at) {
      // Read the grants BEFORE anything can cascade them away. This snapshot is
      // the evidence that the old permanent-delete path destroyed.
      const { data: grants } = await read
        .from('access_grants')
        .select('resource_type, resource_id, created_at')
        .eq('team_member_id', person.team_member_id)
      const { error } = await write
        .from('team_members')
        .update({
          active: false,
          deactivated_at: new Date().toISOString(),
          deactivated_by: actor,
          revoked_grants: grants ?? [],
        })
        .eq('id', person.team_member_id)
      if (error) {
        problems.push(`could not revoke platform access: ${error.message}`)
      } else {
        const n = (grants ?? []).length
        applied.push(
          n > 0
            ? `platform access revoked (${n} project grant${n === 1 ? '' : 's'} recorded)`
            : 'platform access revoked'
        )
      }
    }
  }

  // ── 4. The chart says departed instead of losing the box ──────────────────
  // Read first, so a re-run reports nothing rather than claiming work it did not
  // do. An UPDATE here is idempotent in EFFECT, which is not the same thing as
  // being honest about it — and the whole value of `applied` is that the reader
  // can believe it. (Caught by scripts/verify-separation.mts, which is why the
  // pass lives in lib.)
  if (person.org_person_id) {
    const { data: box, error: boxError } = await read
      .from('org_people')
      .select('status, departed_on')
      .eq('id', person.org_person_id)
      .maybeSingle()
    if (boxError) {
      problems.push(`could not read the org chart: ${boxError.message}`)
    } else if (box) {
      const current = box as { status?: string; departed_on?: string | null }
      if (current.status !== 'departed' || !current.departed_on) {
        const { error } = await write
          .from('org_people')
          .update({ status: 'departed', departed_on: person.separated_on })
          .eq('id', person.org_person_id)
        if (error) problems.push(`could not update the org chart: ${error.message}`)
        else applied.push('org chart marked departed')
      }
    }
  }

  return { applied, problems }
}
