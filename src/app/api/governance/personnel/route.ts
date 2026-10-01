import { NextRequest, NextResponse } from 'next/server'
import { getViewer, forbiddenJson } from '@/lib/auth/viewer'
import { govDb, govDbAs } from '@/lib/governance/db'
import { explainDbError } from '@/lib/governance/registers'

/**
 * The personnel register — GET the roll, POST an employment record.
 *
 * Deliberately NOT one of the generic registers: creating an employment record
 * reaches across to org_people and team_members to tie the three people-concepts
 * together, and a separation is a whole pass rather than a column write (see
 * [id]/route.ts). A register whose write is special but routed through the
 * generic pass anyway is how a shortcut silently throws away the work (§12).
 *
 * Admin-only by default-deny plus its own guard; see the generic register route.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CLASSIFICATIONS = [
  'employee',
  'contractor_1099',
  'seconded',
  'temp',
  'intern',
  'officer_only',
  'board_only',
]

function text(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t : null
}

function date(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !DATE_RE.test(v.trim())) return false
  return v.trim()
}

function uuid(v: unknown): string | null | false {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !UUID_RE.test(v.trim())) return false
  return v.trim()
}

export async function GET() {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const { data, error } = await govDb()
    .from('personnel')
    .select('*')
    .order('full_name', { ascending: true })
    .limit(1000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rows: data ?? [] })
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!viewer.isAdmin) return forbiddenJson('Admin only')

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const fullName = text(body.full_name)
  if (!fullName) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })

  const classification = text(body.classification) ?? 'employee'
  if (!CLASSIFICATIONS.includes(classification)) {
    return NextResponse.json({ error: 'Unrecognised employment classification.' }, { status: 400 })
  }

  const engagedOn = date(body.engaged_on)
  if (engagedOn === false) return NextResponse.json({ error: 'Start date must be YYYY-MM-DD.' }, { status: 400 })

  const links = {
    party_id: uuid(body.party_id),
    org_person_id: uuid(body.org_person_id),
    team_member_id: uuid(body.team_member_id),
    employing_entity_id: uuid(body.employing_entity_id),
  }
  for (const [key, value] of Object.entries(links)) {
    if (value === false) return NextResponse.json({ error: `${key} is not a valid id.` }, { status: 400 })
  }

  const db = govDb()

  // Snapshot the employing entity's name, for the same reason the corporate
  // record snapshots everywhere else: the org chart is a board people drag
  // boxes around on, and "who was the employer of record" must survive it.
  let employingEntityName: string | null = null
  if (links.employing_entity_id) {
    const { data: node } = await db
      .from('org_nodes')
      .select('name')
      .eq('id', links.employing_entity_id as string)
      .maybeSingle()
    employingEntityName = (node as { name?: string } | null)?.name ?? null
  }

  const { data, error } = await govDbAs({ id: viewer.authUserId, email: viewer.email })
    .from('personnel')
    .insert({
      full_name: fullName,
      title: text(body.title),
      classification,
      engaged_on: engagedOn,
      employing_entity_name: employingEntityName,
      retention_until: date(body.retention_until) || null,
      ...links,
    })
    .select('*')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: explainDbError(error.message, error.code) }, { status: 400 })
  }
  return NextResponse.json({ row: data })
}
