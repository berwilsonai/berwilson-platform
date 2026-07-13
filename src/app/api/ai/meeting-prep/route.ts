/**
 * POST /api/ai/meeting-prep
 *
 * Generates a meeting prep brief for a calendar event.
 * Body: { subject: string, attendees: {name: string, email: string}[], date: string }
 *
 * Steps:
 * 1. Match attendees to known parties/contacts
 * 2. Match subject/attendees to related projects
 * 3. Pull recent updates, open items, risks for matched projects
 * 4. Generate a prep brief
 * 5. Store in stored_briefs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { callGemini } from '@/lib/ai/gemini'
import { checkRateLimit } from '@/lib/rate-limit'
import { fetchOpenTasks, formatTasksForPrompt } from '@/lib/tasks/queries'

const MEETING_PREP_PROMPT = `You are a chief of staff preparing an executive for a meeting.
Generate a concise meeting prep brief. Be specific, name names, cite exact numbers and dates.

Structure:
## Meeting Prep: [Subject]
**[Date] · [Attendees count] attendees**

### Who's in the Room
(For each known attendee: name, title, company, their relationship to Ber Wilson, any recent interactions or open items involving them)

### Context
(What projects, deals, or topics this meeting likely relates to. Pull from recent updates, risks, decisions.)

### Open Items to Address
(Action items, waiting-on blockers, or risks that should come up in this meeting)

### Suggested Talking Points
(3-5 specific, actionable points — not generic. Reference real data.)

### Watch Out For
(Political sensitivities, relationship tensions, or risks to be aware of)

Rules:
- If you don't have data on an attendee, say so — don't fabricate.
- Keep it under 500 words.
- Lead with the most important relationship or issue.`

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = checkRateLimit(`meeting-prep:${user.id}`, 10, 60_000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let body: { subject?: string; attendees?: { name: string; email: string }[]; date?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { subject, attendees = [], date } = body
  if (!subject) return NextResponse.json({ error: 'subject is required' }, { status: 400 })

  const admin = createAdminClient()

  // 1. Match attendees to known parties
  const attendeeEmails = attendees.map(a => a.email.toLowerCase()).filter(Boolean)

  let matchedParties: { id: string; full_name: string; company: string | null; title: string | null; email: string | null; relationship_notes: string | null }[] = []

  if (attendeeEmails.length > 0) {
    const { data: byEmail } = await admin
      .from('parties')
      .select('id, full_name, company, title, email, relationship_notes')
      .in('email', attendeeEmails)

    matchedParties = byEmail ?? []
  }

  // Also try name matching for anyone not found by email
  const foundEmails = new Set(matchedParties.map(p => p.email?.toLowerCase()))
  const unmatchedNames = attendees.filter(a => !foundEmails.has(a.email.toLowerCase())).map(a => a.name)

  if (unmatchedNames.length > 0) {
    for (const name of unmatchedNames.slice(0, 5)) {
      const pattern = `%${name.split(' ')[0]}%`
      const { data: byName } = await admin
        .from('parties')
        .select('id, full_name, company, title, email, relationship_notes')
        .ilike('full_name', pattern)
        .limit(1)
      if (byName && byName.length > 0) {
        matchedParties.push(byName[0])
      }
    }
  }

  // 2. Find related projects — through project_players or subject matching
  const partyIds = matchedParties.map(p => p.id)
  const relatedProjectIds: string[] = []
  const projectMap: Record<string, string> = {}

  // Via players
  if (partyIds.length > 0) {
    const { data: playerLinks } = await admin
      .from('project_players')
      .select('project_id, projects(id, name)')
      .in('party_id', partyIds)

    for (const link of playerLinks ?? []) {
      const proj = link.projects as unknown as { id: string; name: string } | null
      if (proj) {
        relatedProjectIds.push(proj.id)
        projectMap[proj.id] = proj.name
      }
    }
  }

  // Also fuzzy match subject to project names
  const { data: allProjects } = await admin
    .from('projects')
    .select('id, name')
    .eq('status', 'active')

  for (const p of allProjects ?? []) {
    projectMap[p.id] = p.name
    const subjectLower = subject.toLowerCase()
    const nameParts = p.name.toLowerCase().split(' ')
    if (nameParts.some(part => part.length > 3 && subjectLower.includes(part))) {
      if (!relatedProjectIds.includes(p.id)) relatedProjectIds.push(p.id)
    }
  }

  // 3. Pull recent updates, open tasks, open items for matched projects
  let recentUpdates: { summary: string; waiting_on: unknown[]; risks: unknown[]; created_at: string; project_name: string }[] = []
  let openDdItems: { item: string; severity: string; project_name: string }[] = []
  let openTasksContext = ''

  if (relatedProjectIds.length > 0) {
    const [{ data: updates }, { data: dd }, openTasks] = await Promise.all([
      admin
        .from('updates')
        .select('summary, waiting_on, risks, created_at, project_id, projects(name)')
        .eq('review_state', 'approved')
        .in('project_id', relatedProjectIds)
        .order('created_at', { ascending: false })
        .limit(5),
      admin
        .from('dd_items')
        .select('item, severity, project_id, projects(name)')
        .neq('status', 'resolved')
        .in('project_id', relatedProjectIds)
        .in('severity', ['critical', 'blocker']),
      fetchOpenTasks(admin, { projectIds: relatedProjectIds, limit: 30 }),
    ])

    openTasksContext = formatTasksForPrompt(openTasks)

    recentUpdates = (updates ?? []).map(u => ({
      summary: u.summary ?? '',
      waiting_on: (u.waiting_on ?? []) as unknown[],
      risks: (u.risks ?? []) as unknown[],
      created_at: u.created_at ?? '',
      project_name: (u.projects as unknown as { name: string } | null)?.name ?? 'Unknown',
    }))

    openDdItems = (dd ?? []).map(d => ({
      item: d.item,
      severity: d.severity ?? 'info',
      project_name: (d.projects as unknown as { name: string } | null)?.name ?? 'Unknown',
    }))
  }

  // 4. Build context and generate
  const partiesContext = matchedParties.map(p =>
    `- ${p.full_name}${p.title ? `, ${p.title}` : ''}${p.company ? ` at ${p.company}` : ''}${p.relationship_notes ? ` — Notes: ${p.relationship_notes}` : ''}`
  ).join('\n')

  const unknownAttendees = attendees.filter(a =>
    !matchedParties.some(p => p.email?.toLowerCase() === a.email.toLowerCase() || p.full_name.toLowerCase().includes(a.name.toLowerCase().split(' ')[0]))
  )

  const updatesContext = recentUpdates.map(u =>
    `[${u.project_name}, ${new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}] ${u.summary}\n  Waiting: ${JSON.stringify(u.waiting_on).slice(0, 200)}\n  Risks: ${JSON.stringify(u.risks).slice(0, 200)}`
  ).join('\n\n')

  const ddContext = openDdItems.map(d => `- ${d.item} (${d.severity}, ${d.project_name})`).join('\n')

  const userMessage = `Meeting: "${subject}"
Date: ${date ?? 'unspecified'}
Total attendees: ${attendees.length}

KNOWN ATTENDEES (matched to our contacts):
${partiesContext || '(none matched)'}

UNKNOWN ATTENDEES:
${unknownAttendees.map(a => `- ${a.name} <${a.email}>`).join('\n') || '(none)'}

RELATED PROJECTS: ${relatedProjectIds.map(id => projectMap[id]).join(', ') || '(no project match found)'}

OPEN TASKS ON RELATED PROJECTS:
${openTasksContext || '(none)'}

RECENT UPDATES:
${updatesContext || '(no recent updates for matched projects)'}

OPEN CRITICAL/BLOCKER ITEMS:
${ddContext || '(none)'}`

  const result = await callGemini<string>({
    task: 'synthesize',
    systemPrompt: MEETING_PREP_PROMPT,
    userMessage,
    userId: user.id,
    promptVersion: 'meeting-prep-v1',
    maxTokens: 2500,
    jsonMode: false,
  })

  const brief = result.data as string

  // 5. Store brief
  await admin.from('stored_briefs').insert({
    brief_type: 'meeting_prep',
    title: `Prep: ${subject}`,
    content: brief,
    model_used: result.model,
    latency_ms: result.latencyMs,
    metadata: {
      subject,
      date,
      attendee_count: attendees.length,
      matched_parties: matchedParties.length,
      related_projects: relatedProjectIds.map(id => projectMap[id]),
    },
  })

  return NextResponse.json({
    brief,
    matched_parties: matchedParties.map(p => ({ name: p.full_name, company: p.company })),
    related_projects: relatedProjectIds.map(id => ({ id, name: projectMap[id] })),
    model_used: result.model,
    latency_ms: result.latencyMs,
  })
}
