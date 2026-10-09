import { NextRequest } from 'next/server'
import { getViewer, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'
import { isRole } from '@/lib/auth/permissions'
import type { Json, JsonIn } from '@/lib/supabase/types'

interface RouteContext {
  params: Promise<{ id: string }>
}

interface PatchBody {
  role?: string
  active?: boolean
  is_steel_rep?: boolean // whether this person is a steel sales rep (Salesperson list)
  grants?: { resource_type: string; resource_id: string }[]
  password?: string
  email?: string // used when granting access to a login-less member
}

/** PATCH — update a member's role/active flag, replace their grants, or set a new login password */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { id } = await params

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const admin = await actorAdminClient()

  // Set a password directly through the auth admin API — the self-hosted stack
  // can't send reset emails, so admin-set passwords are the access path. When
  // the member has no login yet, this GRANTS access (creates the auth account
  // and links it); when they already have one, it RESETS the password.
  if ('password' in body) {
    if (typeof body.password !== 'string' || body.password.length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    const { data: member, error: memberError } = await admin
      .from('team_members')
      .select('auth_user_id, email')
      .eq('id', id)
      .single()
    if (memberError) return Response.json({ error: memberError.message }, { status: 500 })

    if (member.auth_user_id) {
      const { error } = await admin.auth.admin.updateUserById(member.auth_user_id, {
        password: body.password,
      })
      if (error) return Response.json({ error: error.message }, { status: 500 })
    } else {
      // Grant access: create the login now.
      const email = body.email?.trim().toLowerCase() || member.email
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return Response.json({ error: 'An email is required to grant sign-in access' }, { status: 400 })
      }
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password: body.password,
        email_confirm: true,
      })
      let authUserId = created?.user?.id ?? null
      if (!authUserId) {
        const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        authUserId = existing?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null
        if (authUserId) {
          await admin.auth.admin.updateUserById(authUserId, { password: body.password })
        } else {
          return Response.json(
            { error: `Could not grant access: ${createError?.message ?? 'unknown error'}` },
            { status: 500 }
          )
        }
      }
      const { error: linkError } = await admin
        .from('team_members')
        .update({ auth_user_id: authUserId, email })
        .eq('id', id)
      if (linkError) return Response.json({ error: linkError.message }, { status: 500 })
    }
  }

  const update: {
    role?: string
    active?: boolean
    is_steel_rep?: boolean
    deactivated_at?: string | null
    deactivated_by?: string | null
    revoked_grants?: Json | null
  } = {}
  if ('is_steel_rep' in body) update.is_steel_rep = !!body.is_steel_rep
  if ('role' in body) {
    if (!isRole(body.role)) return Response.json({ error: 'Invalid role' }, { status: 400 })
    // Don't let the last admin demote themselves into a locked-out platform.
    if (id === viewer.teamMemberId && body.role !== 'admin') {
      const { count } = await admin
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('active', true)
        .neq('id', id)
      if ((count ?? 0) === 0) {
        return Response.json({ error: 'You are the only active admin — assign another admin first.' }, { status: 400 })
      }
    }
    update.role = body.role
  }
  /**
   * Deactivating IS revoking platform access, so this is the offboarding
   * evidence date — the answer to "when did their access go away", which for a
   * federal contractor is the question most often asked about a departed
   * employee and which nothing recorded before 2026-09-30.
   *
   * ⚠ AND IT SNAPSHOTS THE GRANTS. access_grants is `on delete cascade` from
   * team_members, so a later permanent delete destroys the record of WHAT the
   * person could see. Taking the snapshot at deactivation — the step that
   * always happens first — means the evidence exists before anything can eat
   * it. Deliberately no reason column here: a reason is an HR fact and lives in
   * exactly one place, personnel_notes on /company/people.
   */
  const deactivating = 'active' in body && !body.active
  const reactivating = 'active' in body && !!body.active
  let grantSnapshot: { resource_type: string; resource_id: string }[] = []

  if ('active' in body) update.active = !!body.active

  if (deactivating) {
    const { data: current } = await admin
      .from('team_members')
      .select('active, deactivated_at')
      .eq('id', id)
      .maybeSingle()
    // Fill, never overwrite (§12): re-pressing deactivate must not move the
    // date access actually ended.
    if (current && !current.deactivated_at) {
      const { data: grants } = await admin
        .from('access_grants')
        .select('resource_type, resource_id, created_at')
        .eq('team_member_id', id)
      grantSnapshot = (grants ?? []) as { resource_type: string; resource_id: string }[]
      update.deactivated_at = new Date().toISOString()
      update.deactivated_by = viewer.teamMemberName ?? viewer.email ?? null
      update.revoked_grants = grantSnapshot as unknown as JsonIn
    }
  }
  if (reactivating) {
    update.deactivated_at = null
    update.deactivated_by = null
  }

  if (Object.keys(update).length > 0) {
    const { error } = await admin.from('team_members').update(update).eq('id', id)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // Replace grants wholesale when provided
  if (Array.isArray(body.grants)) {
    const { error: delError } = await admin.from('access_grants').delete().eq('team_member_id', id)
    if (delError) return Response.json({ error: delError.message }, { status: 500 })
    const rows = body.grants
      .filter((g) => (g.resource_type === 'project' || g.resource_type === 'opportunity') && g.resource_id)
      .map((g) => ({ team_member_id: id, resource_type: g.resource_type, resource_id: g.resource_id }))
    if (rows.length > 0) {
      const { error } = await admin.from('access_grants').insert(rows)
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
  }

  return Response.json({ ok: true })
}

/**
 * DELETE — permanently remove a team_member (and their auth login, if any).
 *
 * Still guarded by deactivation first, so a permanent delete is always a
 * deliberate two-step action. FKs to team_members are ON DELETE SET NULL
 * (tasks/deals/objectives/investors just lose the assignee) or CASCADE
 * (access_grants), so this never orphans or blocks.
 *
 * ⚠ CHANGED 2026-09-30. Someone who ever held a LOGIN is no longer deletable on
 * a single press. The cascade on access_grants means deleting them destroys the
 * record of what they could see, and that record is the point: a deactivated row
 * carrying deactivated_at and revoked_grants answers "when did their access end
 * and what did it reach", and a deleted row answers nothing. §12's rule is that
 * the row is the tombstone.
 *
 * `?purge=1` is the deliberate override, for a genuine mis-entry rather than a
 * person who left. Even then the row survives in activity_log.metadata, because
 * log_activity now fires on team_members and writes to_jsonb(old) on DELETE into
 * a table with no UPDATE or DELETE policy.
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { id } = await params
  if (id === viewer.teamMemberId) {
    return Response.json({ error: "You can't delete your own account." }, { status: 400 })
  }

  const purge = new URL(request.url).searchParams.get('purge') === '1'

  const admin = await actorAdminClient()
  const { data: member, error: memberError } = await admin
    .from('team_members')
    .select('active, auth_user_id, name, deactivated_at')
    .eq('id', id)
    .single()
  if (memberError) return Response.json({ error: memberError.message }, { status: 500 })
  if (member.active) {
    return Response.json(
      { error: 'Deactivate this user before deleting them permanently.' },
      { status: 400 }
    )
  }

  const everHadALogin = Boolean(member.auth_user_id) || Boolean(member.deactivated_at)
  if (everHadALogin && !purge) {
    return Response.json(
      {
        error:
          `${member.name} held a login, so their deactivated record is the evidence of when their access ended and what it reached. ` +
          'Keep it, and record why they left on /company/people. Delete permanently only if this row was created in error.',
        requiresPurge: true,
      },
      { status: 409 }
    )
  }

  // Last chance to record what the cascade is about to destroy. The UPDATE
  // fires log_activity, so the grants land in the append-only log even though
  // the row itself is a moment from being gone.
  const { data: grants } = await admin
    .from('access_grants')
    .select('resource_type, resource_id, created_at')
    .eq('team_member_id', id)
  if ((grants ?? []).length > 0) {
    await admin
      .from('team_members')
      .update({ revoked_grants: (grants ?? []) as unknown as JsonIn })
      .eq('id', id)
  }

  // Remove the auth login first (frees the email for reuse); non-fatal.
  if (member.auth_user_id) {
    await admin.auth.admin.deleteUser(member.auth_user_id)
  }

  const { error: delError } = await admin.from('team_members').delete().eq('id', id)
  if (delError) return Response.json({ error: delError.message }, { status: 500 })

  return Response.json({ ok: true })
}
