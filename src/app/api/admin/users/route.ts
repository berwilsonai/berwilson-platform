import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { isRole } from '@/lib/auth/permissions'

// Admin-only user management. A "user" is a team_members row; linking one to a
// Supabase auth account (via email invite) is what lets them sign in.

async function requireAdmin() {
  const viewer = await getViewer()
  if (!viewer) return { error: Response.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (!viewer.isAdmin) return { error: forbiddenJson('Admin only') }
  return { viewer }
}

/** GET — members with grants, plus the grantable projects/opportunities */
export async function GET() {
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  const admin = createAdminClient()
  const [{ data: members, error }, { data: grants }, { data: projects }, { data: opportunities }] =
    await Promise.all([
      admin.from('team_members').select('*').order('created_at', { ascending: true }),
      admin.from('access_grants').select('team_member_id, resource_type, resource_id'),
      admin.from('projects').select('id, name, parent_project_id').order('name'),
      admin.from('opportunities').select('id, name').not('status', 'in', '(closed_won,closed_passed)').order('name'),
    ])

  if (error) {
    // Pre-migration (role/auth columns missing) — tell the UI plainly.
    return Response.json(
      { error: 'User access migration not applied yet. Run the 20260704000005_user_access migration first.' },
      { status: 409 }
    )
  }

  const grantsByMember = new Map<string, { resource_type: string; resource_id: string }[]>()
  for (const g of grants ?? []) {
    const list = grantsByMember.get(g.team_member_id) ?? []
    list.push({ resource_type: g.resource_type, resource_id: g.resource_id })
    grantsByMember.set(g.team_member_id, list)
  }

  return Response.json({
    members: (members ?? []).map((m) => ({ ...m, grants: grantsByMember.get(m.id) ?? [] })),
    projects: projects ?? [],
    opportunities: opportunities ?? [],
  })
}

interface CreateBody {
  team_member_id?: string // link an existing member instead of creating one
  name?: string
  email?: string
  role?: string
  grants?: { resource_type: string; resource_id: string }[]
  create_login?: boolean // grant sign-in access now (sets a password directly)
  password?: string
}

/**
 * POST — add a user. Two modes:
 *   create_login=false (default) — just create/link the team_member row so the
 *     person is trackable (assignable tasks/deals, a pre-set role) WITHOUT any
 *     sign-in access. This is how you stage someone before they gain access.
 *   create_login=true — also create an auth login with the given password set
 *     directly. No email is sent (this self-hosted stack can't send mail) —
 *     the admin shares the password out of band.
 */
export async function POST(request: NextRequest) {
  const { error: authError } = await requireAdmin()
  if (authError) return authError

  let body: CreateBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() || null
  const role = body.role
  const createLogin = body.create_login === true

  if (!isRole(role)) {
    return Response.json({ error: 'A valid role is required' }, { status: 400 })
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: 'That email address looks invalid' }, { status: 400 })
  }
  if (createLogin) {
    if (!email) {
      return Response.json({ error: 'An email is required to create a sign-in login' }, { status: 400 })
    }
    if (typeof body.password !== 'string' || body.password.length < 8) {
      return Response.json({ error: 'A password of at least 8 characters is required' }, { status: 400 })
    }
  }

  const admin = createAdminClient()

  // Only touch auth when granting access now. A login on this stack is an
  // account with a password set directly — no invite email leaves the box.
  let authUserId: string | null = null
  if (createLogin) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: email!,
      password: body.password,
      email_confirm: true,
    })
    if (created?.user) {
      authUserId = created.user.id
    } else {
      // Email may already have an account (e.g. Richard/Eric) — reuse it and
      // set the shared password on it.
      const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      authUserId = existing?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null
      if (authUserId) {
        await admin.auth.admin.updateUserById(authUserId, { password: body.password })
      } else {
        return Response.json(
          { error: `Could not create login: ${createError?.message ?? 'unknown error'}` },
          { status: 500 }
        )
      }
    }
  }

  // Create or link the team_member row
  let memberId = body.team_member_id ?? null
  if (memberId) {
    const update: { role: string; email?: string; auth_user_id?: string } = { role }
    if (email) update.email = email
    if (authUserId) update.auth_user_id = authUserId
    const { error } = await admin.from('team_members').update(update).eq('id', memberId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
  } else {
    const name = body.name?.trim()
    if (!name) return Response.json({ error: 'name is required for a new member' }, { status: 400 })
    const { count } = await admin.from('team_members').select('*', { count: 'exact', head: true })
    const PALETTE = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange']
    const { data: created, error } = await admin
      .from('team_members')
      .insert({ name, email, role, auth_user_id: authUserId, color: PALETTE[(count ?? 0) % PALETTE.length] })
      .select('id')
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    memberId = created.id
  }

  // Set grants (project_manager only — ignored for other roles)
  if (role === 'project_manager' && Array.isArray(body.grants)) {
    const rows = body.grants
      .filter((g) => (g.resource_type === 'project' || g.resource_type === 'opportunity') && g.resource_id)
      .map((g) => ({ team_member_id: memberId!, resource_type: g.resource_type, resource_id: g.resource_id }))
    if (rows.length > 0) {
      const { error } = await admin.from('access_grants').insert(rows)
      if (error) return Response.json({ error: `Member added but grants failed: ${error.message}` }, { status: 500 })
    }
  }

  return Response.json({ ok: true, team_member_id: memberId, login_created: createLogin })
}
