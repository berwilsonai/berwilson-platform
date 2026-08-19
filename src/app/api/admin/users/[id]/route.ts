import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { isRole } from '@/lib/auth/permissions'

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

  const admin = createAdminClient()

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

  const update: { role?: string; active?: boolean; is_steel_rep?: boolean } = {}
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
  if ('active' in body) update.active = !!body.active

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
 * Guarded: the member must be deactivated first, so a permanent delete is
 * always a deliberate two-step action. FKs to team_members are ON DELETE SET
 * NULL (tasks/deals/objectives/investors just lose the assignee) or CASCADE
 * (access_grants), so this never orphans or blocks.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const viewer = await getViewer()
  if (!viewer) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { id } = await params
  if (id === viewer.teamMemberId) {
    return Response.json({ error: "You can't delete your own account." }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: member, error: memberError } = await admin
    .from('team_members')
    .select('active, auth_user_id, name')
    .eq('id', id)
    .single()
  if (memberError) return Response.json({ error: memberError.message }, { status: 500 })
  if (member.active) {
    return Response.json(
      { error: 'Deactivate this user before deleting them permanently.' },
      { status: 400 }
    )
  }

  // Remove the auth login first (frees the email for reuse); non-fatal.
  if (member.auth_user_id) {
    await admin.auth.admin.deleteUser(member.auth_user_id)
  }

  const { error: delError } = await admin.from('team_members').delete().eq('id', id)
  if (delError) return Response.json({ error: delError.message }, { status: 500 })

  return Response.json({ ok: true })
}
