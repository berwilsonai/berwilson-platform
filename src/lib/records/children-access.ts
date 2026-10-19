/**
 * Who may write a child row — the question the two registry routes share.
 *
 * Kept apart from children.ts so the specs stay importable without pulling in
 * `next/headers`: getViewer() reads cookies, and a module that does cannot be
 * loaded by a test or a verification script (§12 — a verification script
 * importing src/lib hits failures neither tsc nor the build can see).
 *
 * ⚠ AND THE REFUSALS ARE A PLAIN `Response`, NOT `NextResponse`. Importing
 * `next/server` here made this module unloadable by a script — exactly the
 * load-time failure §12 warns about, which neither tsc nor the build can see —
 * and a route handler may return either. `forbiddenJson` already uses the web
 * Response for the same reason.
 *
 * Both answers come from `canAccessRecord`, which is the one function that
 * resolves the role's grant AND the project's confidentiality together. A
 * create reads the parent out of the BODY; an edit or a delete reads it off the
 * ROW, because the id in the path is all the client sends and a row's parent is
 * not something a client may assert.
 */

import { canAccessRecord, forbiddenJson, type Viewer } from '@/lib/auth/viewer'
import type { ChildSpec } from '@/lib/records/children'
import { scopeFromBody } from '@/lib/records/scope'
import { createUntypedAdminClient } from '@/lib/supabase/admin'

export type GuardResult<T> = { ok: true; value: T } | { ok: false; response: Response }

/** The `{ project_id, opportunity_id }` pair a create writes. */
export type ChildScope = { project_id: string | null; opportunity_id: string | null }

/**
 * Resolve and guard the parent named in a create body.
 *
 * `record-optional` is the one shape that tolerates neither column — a
 * compliance item with no record is a company-level obligation. That write has
 * no record to check against, so the answer is the ROLE: admin only. The role
 * gate already enforced that by leaving the path out of every allowlist; saying
 * it here is what makes it survive someone widening that list later (§12 —
 * `matchesPrefix` is not method-aware).
 */
export async function guardCreateScope(
  viewer: Viewer,
  spec: ChildSpec,
  body: Record<string, unknown>
): Promise<GuardResult<ChildScope>> {
  const scope = scopeFromBody(body)

  if (!scope) {
    const bothNamed = !!body.project_id && !!body.opportunity_id
    if (spec.parent === 'record-optional' && !bothNamed) {
      if (!viewer.isAdmin) return { ok: false, response: forbiddenJson('Admin only') }
      return { ok: true, value: { project_id: null, opportunity_id: null } }
    }
    return {
      ok: false,
      response: Response.json(
        { error: `exactly one of project_id or opportunity_id is required for a ${spec.label}` },
        { status: 400 }
      ),
    }
  }

  if (!(await canAccessRecord(viewer, scope.kind, scope.id))) {
    return { ok: false, response: forbiddenJson() }
  }

  return {
    ok: true,
    value: {
      project_id: scope.kind === 'project' ? scope.id : null,
      opportunity_id: scope.kind === 'opportunity' ? scope.id : null,
    },
  }
}

/**
 * Read an existing row's parent and guard it.
 *
 * ⚠ THIS IS THE CHECK SIX ROUTE FILES DID NOT HAVE. A PATCH or DELETE carries
 * only an id, so the parent has to be read before the write — which is exactly
 * why it was skipped: it costs a query, and `createAdminClient().update().eq(id)`
 * works without it. What it bought was that any authenticated session could
 * edit or remove a diligence item, a financing structure, a compliance item, a
 * player or an entity link on any record, protected or not.
 *
 * A row that does not exist is reported as missing rather than forbidden: the
 * id came from a list the viewer was already shown, so "it is gone" is the
 * truthful answer and the useful one.
 */
export async function guardExistingRow(
  viewer: Viewer,
  spec: ChildSpec,
  id: string
): Promise<GuardResult<ChildScope>> {
  const { data, error } = await createUntypedAdminClient()
    .from(spec.table)
    .select('project_id, opportunity_id')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error(`[records/${spec.table}] could not read parent of ${id}:`, error.message)
    // Fails CLOSED. A parent we could not read is not a parent we may write to.
    return { ok: false, response: forbiddenJson() }
  }
  if (!data) {
    return {
      ok: false,
      response: Response.json({ error: `That ${spec.label} no longer exists.` }, { status: 404 }),
    }
  }

  const row = data as ChildScope
  if (row.project_id) {
    if (!(await canAccessRecord(viewer, 'project', row.project_id))) {
      return { ok: false, response: forbiddenJson() }
    }
  } else if (row.opportunity_id) {
    if (!(await canAccessRecord(viewer, 'opportunity', row.opportunity_id))) {
      return { ok: false, response: forbiddenJson() }
    }
  } else if (!viewer.isAdmin) {
    // A parentless row — only `record-optional` can produce one — is a
    // company-level record, so the role answers for it.
    return { ok: false, response: forbiddenJson('Admin only') }
  }

  return { ok: true, value: row }
}
