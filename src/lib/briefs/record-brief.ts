/**
 * Record brief — assemble everything known about one project, deterministically,
 * then make exactly one model call to write it up.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT AN AGENT LOOP.
 *
 * Asked "tell me what I need to know about the Stockton project", the agent did
 * a creditable job: 15 tool calls, 135 seconds, and a brief that correctly found
 * the kill conditions, the water constraint and the Superfund exposure. It also
 * stated, as its single highest-ranked risk, that the town had gone quiet since
 * June 23rd. Eleven later threads existed, including one titled "Response from
 * Stockton Mayor" from eleven days earlier. The mail was fetched, stored and
 * indexed — semantic search returns it as the top hit — but the model reached
 * for keyword thread search, read one thread, and concluded.
 *
 * That is the failure worth designing against. Not a missing answer: a confident
 * wrong one, delivered in the house style, ranked first. It happens because
 * choosing what to retrieve is left to a model that gets five rounds and 36
 * tools, and any single miss becomes an assertion about the world.
 *
 * So a brief is assembled in code. The same sources every time, in the same
 * order, whether or not a model thinks to ask for them:
 *
 *   - the record itself, and its structured children (tasks, milestones,
 *     diligence, financing, compliance, players)
 *   - every document on the record, by AI summary, duplicates collapsed
 *   - ALL correspondence linked to the record, newest first, with dates
 *   - a semantic sweep for mail that is clearly about this record but has not
 *     been linked yet — which is most of it, and is the half that caused the
 *     wrong answer above
 *
 * The model's job shrinks to writing, which is the part it is reliably good at.
 * One call instead of fifteen also takes roughly a third of the time.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { fetchOpenTasks, formatTasksForPrompt } from '@/lib/tasks/queries'
import { searchCorrespondence } from '@/lib/ai/thread-embeddings'
import { matchChunks } from '@/lib/ai/match-chunks'
import { generateEmbedding } from '@/lib/ai/embeddings'
import { dedupeByContent, normalizeForDedupe } from '@/lib/ai/dedupe'
import { sweepDb } from '@/lib/email-sweep/db'

type Admin = SupabaseClient<Database>

/** A thing the brief was built from, so the reader can go and check it. */
export interface BriefSource {
  kind: 'document' | 'correspondence' | 'update'
  label: string
  detail: string | null
  /** Correspondence only: whether it is filed against this record or merely matched. */
  linked?: boolean
}

export interface AssembledBrief {
  projectName: string
  /** The evidence block handed to the model. */
  prompt: string
  sources: BriefSource[]
  stats: {
    documents: number
    linkedThreads: number
    matchedThreads: number
    openTasks: number
    updates: number
    /** Most recent correspondence of any kind, linked or matched. */
    lastContact: string | null
  }
}

/** Newest first, and never crash on a null. */
function byDateDesc(a: string | null, b: string | null): number {
  return (b ?? '').localeCompare(a ?? '')
}

function ymd(value: string | null): string {
  if (!value) return 'undated'
  return value.slice(0, 10)
}

/** Days between a date and now, for stating staleness in words. */
function ageInDays(value: string | null, now: Date): number | null {
  if (!value) return null
  const t = Date.parse(value)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * The same file reaching the platform by two doors is one document to a reader.
 *
 * Hand upload, email attachment and Drive sync each dedupe within their own key,
 * so a file that arrived by email and later appeared in Drive is imported twice
 * — live on this data, the Stockton proposal and its one-pager are both indexed
 * in duplicate. Listing both would spend the brief's attention saying the same
 * thing, and imply two sources agree where there is only one.
 */
function dedupeDocuments<T extends { file_name: string | null; ai_summary: string | null }>(
  docs: T[]
): T[] {
  const seen = new Map<string, T>()
  for (const doc of docs) {
    const key = normalizeForDedupe(doc.file_name ?? '')
    if (!key) continue
    const existing = seen.get(key)
    // Keep whichever copy actually carries a summary; between two that do, the
    // longer one has more to say.
    if (!existing || (doc.ai_summary?.length ?? 0) > (existing.ai_summary?.length ?? 0)) {
      seen.set(key, doc)
    }
  }
  return [...seen.values()]
}

interface ThreadRecord {
  id: string
  subject: string | null
  mailbox: string | null
  last_at: string | null
  message_count: number | null
  summary: unknown
  linked: boolean
  reason: string | null
}

/** Pull the one-line gist out of a stored thread summary, whatever shape it is in. */
function threadGist(summary: unknown): string | null {
  if (!summary || typeof summary !== 'object') return null
  const s = summary as Record<string, unknown>
  const parts: string[] = []
  if (typeof s.summary === 'string' && s.summary.trim()) parts.push(s.summary.trim())
  const facts = s.key_facts
  if (Array.isArray(facts) && facts.length > 0) {
    parts.push(facts.filter((f) => typeof f === 'string').slice(0, 3).join(' · '))
  }
  return parts.length > 0 ? parts.join(' — ') : null
}

/**
 * Correspondence for one record: every FILED thread, then a semantic sweep for
 * mail that looks like it belongs here but has not been filed. Shared by the
 * project and opportunity assemblers so the two kinds of brief cannot drift in
 * how they treat mail — the sweep phrasing is the caller's, since only the
 * caller knows what a reader would ask about its record.
 */
async function gatherCorrespondence(
  recordKind: 'project' | 'opportunity',
  recordId: string,
  sweepQuery: string
): Promise<ThreadRecord[]> {
  const threads: ThreadRecord[] = []
  const seenThreads = new Set<string>()

  const { data: links } = await sweepDb()
    .from('thread_links')
    .select('thread_id, certainty, reason')
    .eq('record_kind', recordKind)
    .eq('record_id', recordId)

  const linkRows = (links ?? []) as unknown as Array<{
    thread_id: string
    certainty: string
    reason: string | null
  }>
  if (linkRows.length > 0) {
    const { data: linked } = await sweepDb()
      .from('email_threads')
      .select('id, subject, mailbox, last_at, message_count, summary')
      .in('id', linkRows.map((l) => l.thread_id))
    const reasonById = new Map(linkRows.map((l) => [l.thread_id, l.reason]))
    for (const raw of linked ?? []) {
      const row = raw as unknown as Omit<ThreadRecord, 'linked' | 'reason'>
      seenThreads.add(row.id)
      threads.push({ ...row, linked: true, reason: reasonById.get(row.id) ?? null })
    }
  }

  // The sweep asks the question a reader would, not the record's formal title:
  // a thread saying "Water Questions from Ber Wilson" is about this record and
  // shares no words with its name.
  let matched: Awaited<ReturnType<typeof searchCorrespondence>> = []
  try {
    matched = await searchCorrespondence(sweepQuery, { limit: 10 })
  } catch (err) {
    // Correspondence search is an enrichment, not the spine. If the index is
    // unavailable the brief still stands on the record and its documents, which
    // is better than failing the whole request.
    console.error('[brief] correspondence sweep failed:', err)
  }

  const matchedIds = [...new Set(matched.map((h) => h.threadId))].filter(
    (id) => !seenThreads.has(id)
  )
  if (matchedIds.length > 0) {
    const { data: extra } = await sweepDb()
      .from('email_threads')
      .select('id, subject, mailbox, last_at, message_count, summary')
      .in('id', matchedIds)
    for (const raw of extra ?? []) {
      const row = raw as unknown as Omit<ThreadRecord, 'linked' | 'reason'>
      threads.push({ ...row, linked: false, reason: null })
    }
  }

  threads.sort((a, b) => byDateDesc(a.last_at, b.last_at))
  return threads
}

/**
 * The CONTACT RECENCY block. Recency is measured from FILED correspondence
 * only — the semantic sweep deliberately casts wide, so it surfaces mail that
 * merely resembles the record, and letting a loose match set the date would
 * claim contact that never happened.
 */
function contactRecencyLines(
  threads: ThreadRecord[],
  now: Date
): { lines: string[]; lastContact: string | null } {
  const filed = threads.filter((t) => t.linked)
  const lastContact = filed[0]?.last_at ?? null
  if (lastContact) {
    const age = ageInDays(lastContact, now)
    return {
      lastContact,
      lines: [
        `## CONTACT RECENCY`,
        `- Most recent correspondence FILED on this record: ${ymd(lastContact)}${age !== null ? ` (${age} days ago)` : ''} — "${filed[0].subject ?? '(no subject)'}".`,
        `- Do not describe this record as stalled, quiet or unanswered on any date earlier than that.`,
        `- Threads above marked "matched, not yet filed" are NOT evidence of contact on this record — they merely resemble it. Do not cite them as activity here.`,
        '',
      ],
    }
  }
  return {
    lastContact: null,
    lines: [
      '## CONTACT RECENCY',
      '- No correspondence is filed on this record.',
      threads.length > 0
        ? '- Some mail matched it but none has been filed, so there is no confirmed contact history. Say that the record has no filed correspondence rather than that the deal is quiet.'
        : '- No correspondence was retrieved at all.',
      '',
    ],
  }
}

/** Render the CORRESPONDENCE section rows — one thread per bullet, with gist. */
function correspondenceLines(threads: ThreadRecord[], now: Date): string[] {
  return threads.map((t) => {
    const age = ageInDays(t.last_at, now)
    const gist = threadGist(t.summary)
    const tag = t.linked ? 'filed on this record' : 'matched, not yet filed'
    return [
      `- [${ymd(t.last_at)}${age !== null ? `, ${age}d ago` : ''}] ${t.subject ?? '(no subject)'} — ${t.message_count ?? 1} message(s), ${t.mailbox ?? 'unknown mailbox'} (${tag})`,
      gist ? `    ${gist.replace(/\s+/g, ' ').slice(0, 400)}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  })
}

/**
 * Everything the record knows, plus everything that looks like it belongs to it.
 *
 * Correspondence arrives two ways on purpose. Linked threads are what the
 * platform has filed against this record and are listed in full, because a gap
 * in that list is what makes a brief claim a deal has gone quiet. The semantic
 * sweep then catches mail nobody has filed yet — 83% of this corpus — and is
 * labelled as unfiled so the writing can be honest about which is which.
 */
export async function assembleProjectBrief(
  admin: Admin,
  projectId: string,
  now: Date = new Date()
): Promise<AssembledBrief | null> {
  const { data: project } = await admin
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const name = project.name ?? 'Untitled project'

  const [
    openTasks,
    { data: updates },
    { data: milestones },
    { data: ddItems },
    { data: financing },
    { data: compliance },
    { data: players },
    { data: documents },
  ] = await Promise.all([
    fetchOpenTasks(admin, { projectId, limit: 50 }),
    admin.from('updates')
      .select('summary, waiting_on, risks, decisions, created_at')
      .eq('project_id', projectId)
      .eq('review_state', 'approved')
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('milestones')
      .select('label, stage, target_date, completed_at')
      .eq('project_id', projectId)
      .order('sort_order'),
    admin.from('dd_items')
      .select('category, item, status, severity, notes')
      .eq('project_id', projectId),
    admin.from('financing_structures')
      .select('structure_type, senior_debt, equity_amount, equity_pct, lender, pe_partner, notes')
      .eq('project_id', projectId),
    admin.from('compliance_items')
      .select('framework, requirement, status, due_date, notes')
      .eq('project_id', projectId),
    admin.from('project_players')
      .select('role, party:parties(full_name, company, email)')
      .eq('project_id', projectId),
    admin.from('documents')
      .select('id, file_name, doc_type, ai_summary, uploaded_at')
      .eq('project_id', projectId)
      .order('uploaded_at', { ascending: false }),
  ])

  // ---- correspondence: filed first, then whatever else is clearly about this.
  // thread_links and email_threads are deliberately outside the generated types
  // (gen-types cannot run against this self-hosted stack), so the shared helper
  // goes through the sweep's own untyped client.
  const threads = await gatherCorrespondence(
    'project',
    projectId,
    `${name}${project.location ? ` in ${project.location}` : ''} — status, decisions, next steps, open questions, risks`
  )

  // ---- documents, and the passages behind them
  const docs = dedupeDocuments((documents ?? []) as Array<{
    id: string
    file_name: string | null
    doc_type: string | null
    ai_summary: string | null
    uploaded_at: string | null
  }>)

  let passages: Array<{ content: string }> = []
  try {
    const embedding = await generateEmbedding(
      `${name} — scope, status, obligations, deadlines, financials, risks`
    )
    const { data } = await matchChunks(admin, {
      query_embedding: JSON.stringify(embedding),
      filter_project_ids: [projectId],
      filter_after: '1900-01-01',
      match_count: 6,
      filter_entity_ids: [],
      filter_include_company: false,
    })
    passages = dedupeByContent(
      ((data ?? []) as Array<{ content?: string | null }>).map((r) => ({ content: r.content ?? '' })),
      (p) => p.content,
      6
    )
  } catch (err) {
    console.error('[brief] document passage sweep failed:', err)
  }

  // ---- build the evidence block
  const lines: string[] = []
  const push = (heading: string, body: string[]) => {
    if (body.length === 0) return
    lines.push(`## ${heading}`, ...body, '')
  }

  lines.push(`# RECORD: ${name}`, '')
  const facts: string[] = []
  const fact = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    facts.push(`- ${label}: ${String(value)}`)
  }
  fact('Sector', project.sector)
  fact('Stage', project.stage)
  fact('Status', project.status)
  fact('Estimated value', project.estimated_value)
  fact('Location', project.location)
  fact('Client', project.client_entity)
  fact('Contract type', project.contract_type)
  fact('Delivery method', project.delivery_method)
  fact('Solicitation number', project.solicitation_number)
  fact('Bid due', project.bid_due_date)
  fact('Win probability', project.win_probability)
  fact('Award date', project.award_date)
  fact('NTP date', project.ntp_date)
  fact('Substantial completion', project.substantial_completion_date)
  fact('Description', project.description)
  push('RECORD FIELDS', facts)

  // Absence is information, and stating it is what stops the writer inferring
  // health from a silent section. "No milestones recorded" means the schedule is
  // untracked, not that the schedule is fine.
  const gaps: string[] = []
  if (openTasks.length === 0) gaps.push('- No open tasks are assigned on this record.')
  if ((milestones ?? []).length === 0) gaps.push('- No milestones are recorded, so there is no tracked schedule.')
  if ((ddItems ?? []).length === 0) gaps.push('- No due-diligence items are recorded.')
  if ((financing ?? []).length === 0) gaps.push('- No financing structure is recorded.')
  if (project.estimated_value === null) gaps.push('- No estimated value is recorded.')
  push('RECORDED-DATA GAPS (state these as gaps in tracking, never as good news)', gaps)

  push('OPEN TASKS', openTasks.length > 0 ? [formatTasksForPrompt(openTasks, now)] : [])

  push(
    'RECENT UPDATES (newest first)',
    (updates ?? []).map((u) => {
      const bits = [`- [${ymd(u.created_at)}] ${u.summary ?? ''}`]
      const risks = (u.risks ?? []) as Array<{ text?: string; severity?: string }>
      for (const r of risks.slice(0, 4)) {
        if (r?.text) bits.push(`    risk (${r.severity ?? 'unrated'}): ${r.text}`)
      }
      const waiting = (u.waiting_on ?? []) as Array<{ text?: string }>
      for (const w of waiting.slice(0, 4)) if (w?.text) bits.push(`    waiting on: ${w.text}`)
      const decisions = (u.decisions ?? []) as Array<{ text?: string }>
      for (const d of decisions.slice(0, 4)) if (d?.text) bits.push(`    decision: ${d.text}`)
      return bits.join('\n')
    })
  )

  push(
    'MILESTONES',
    (milestones ?? []).map(
      (m) => `- ${m.label ?? 'Unnamed'} — target ${ymd(m.target_date)}${m.completed_at ? ` (completed ${ymd(m.completed_at)})` : ' (open)'}`
    )
  )
  push(
    'DUE DILIGENCE',
    (ddItems ?? []).map(
      (d) => `- [${d.status ?? 'unknown'}${d.severity ? `/${d.severity}` : ''}] ${d.category ?? ''}: ${d.item ?? ''}${d.notes ? ` — ${d.notes}` : ''}`
    )
  )
  push(
    'FINANCING',
    (financing ?? []).map(
      (f) => `- ${f.structure_type ?? 'structure'}: senior ${f.senior_debt ?? 'n/a'}, equity ${f.equity_amount ?? 'n/a'} (${f.equity_pct ?? '?'}%), lender ${f.lender ?? 'n/a'}, partner ${f.pe_partner ?? 'n/a'}${f.notes ? ` — ${f.notes}` : ''}`
    )
  )
  push(
    'COMPLIANCE',
    (compliance ?? []).map(
      (c) => `- [${c.status ?? 'unknown'}] ${c.framework ?? ''}: ${c.requirement ?? ''}${c.due_date ? ` (due ${ymd(c.due_date)})` : ''}`
    )
  )
  push(
    'PEOPLE ON THIS RECORD',
    (players ?? []).map((p) => {
      const party = p.party as unknown as { full_name?: string; company?: string | null } | null
      return `- ${party?.full_name ?? 'Unknown'}${party?.company ? ` (${party.company})` : ''} — ${p.role ?? 'unspecified role'}`
    })
  )

  push(
    'DOCUMENTS ON THIS RECORD',
    docs.map(
      (d) => `- ${d.file_name ?? 'Untitled'} [${d.doc_type ?? 'document'}, added ${ymd(d.uploaded_at)}]${d.ai_summary ? `\n    ${d.ai_summary.replace(/\s+/g, ' ').slice(0, 600)}` : '\n    (no summary available)'}`
    )
  )

  push(
    'PASSAGES FROM THOSE DOCUMENTS',
    passages.map((p, i) => `- [${i + 1}] ${p.content.replace(/\s+/g, ' ').slice(0, 900)}`)
  )

  push(
    'CORRESPONDENCE (newest first — this is the complete set retrieved)',
    correspondenceLines(threads, now)
  )

  const recency = contactRecencyLines(threads, now)
  lines.push(...recency.lines)
  const lastContact = recency.lastContact

  const sources: BriefSource[] = [
    ...docs.map((d) => ({
      kind: 'document' as const,
      label: d.file_name ?? 'Untitled document',
      detail: d.doc_type,
    })),
    ...threads.map((t) => ({
      kind: 'correspondence' as const,
      label: t.subject ?? '(no subject)',
      detail: ymd(t.last_at),
      linked: t.linked,
    })),
  ]

  return {
    projectName: name,
    prompt: lines.join('\n'),
    sources,
    stats: {
      documents: docs.length,
      linkedThreads: threads.filter((t) => t.linked).length,
      matchedThreads: threads.filter((t) => !t.linked).length,
      openTasks: openTasks.length,
      updates: (updates ?? []).length,
      lastContact,
    },
  }
}

/**
 * The opportunity-shaped loader for the same brief.
 *
 * Same spine as the project assembler — record fields, stated gaps, documents
 * by AI summary, ALL filed correspondence plus a labelled semantic sweep, and a
 * recency block measured from filed mail only. The children differ because the
 * tables differ: an opportunity's running commentary is `opportunity_notes`
 * rather than `updates`, its files live in `opportunity_documents`, and it has
 * no milestones/diligence/financing tables to report on.
 *
 * Passages come from `match_chunks` scoped to this opportunity — the RPC
 * learned an opportunity filter in migration 20260919000001, so the index does
 * the ranking rather than Node pulling several hundred vectors to sort by hand.
 */
export async function assembleOpportunityBrief(
  admin: Admin,
  opportunityId: string,
  now: Date = new Date()
): Promise<AssembledBrief | null> {
  const { data: opp } = await admin
    .from('opportunities')
    .select('*')
    .eq('id', opportunityId)
    .single()

  if (!opp) return null

  const name = opp.name ?? 'Untitled opportunity'

  const [openTasks, { data: notes }, { data: documents }] = await Promise.all([
    fetchOpenTasks(admin, { opportunityId, limit: 50 }),
    admin
      .from('opportunity_notes')
      .select('body, author, created_at')
      .eq('opportunity_id', opportunityId)
      .order('created_at', { ascending: false })
      .limit(12),
    admin
      .from('opportunity_documents')
      .select('id, file_name, doc_type, ai_summary, uploaded_at')
      .eq('opportunity_id', opportunityId)
      .order('uploaded_at', { ascending: false }),
  ])

  const threads = await gatherCorrespondence(
    'opportunity',
    opportunityId,
    `${name}${opp.counterparty ? ` with ${opp.counterparty}` : ''}${opp.location ? ` in ${opp.location}` : ''} — status, negotiations, terms, next steps, open questions, risks`
  )

  const docs = dedupeDocuments(
    (documents ?? []) as Array<{
      id: string
      file_name: string | null
      doc_type: string | null
      ai_summary: string | null
      uploaded_at: string | null
    }>
  )

  // ---- passages: the index does the ranking, scoped to this opportunity
  let passages: Array<{ content: string }> = []
  try {
    const embedding = await generateEmbedding(
      `${name} — deal terms, status, obligations, valuation, risks`
    )
    const { data } = await matchChunks(admin, {
      query_embedding: JSON.stringify(embedding),
      filter_project_ids: [],
      filter_opportunity_ids: [opportunityId],
      filter_after: '1900-01-01',
      match_count: 6,
      filter_entity_ids: [],
      filter_include_company: false,
    })
    passages = dedupeByContent(
      ((data ?? []) as Array<{ content?: string | null }>).map((r) => ({ content: r.content ?? '' })),
      (p) => p.content,
      6
    )
  } catch (err) {
    console.error('[brief] opportunity passage sweep failed:', err)
  }

  // ---- build the evidence block
  const lines: string[] = []
  const push = (heading: string, body: string[]) => {
    if (body.length === 0) return
    lines.push(`## ${heading}`, ...body, '')
  }

  lines.push(`# RECORD: ${name}`, '')
  const facts: string[] = []
  const fact = (label: string, value: unknown) => {
    if (value === null || value === undefined || value === '') return
    facts.push(`- ${label}: ${String(value)}`)
  }
  fact('Kind', 'Strategic opportunity (not a construction project)')
  fact('Type', opp.opp_type)
  fact('Status', opp.status)
  fact('Priority', opp.priority)
  fact('Sector', opp.sector)
  fact('Location', opp.location)
  fact('Target / company', opp.target_name)
  fact('Counterparty', opp.counterparty)
  fact('Estimated value', opp.estimated_value)
  fact('Deal structure', opp.deal_structure)
  fact('Ownership stake %', opp.ownership_stake)
  fact('Probability %', opp.probability)
  fact('Lead', opp.lead)
  fact('Source', opp.source)
  fact('Identified', opp.identified_date)
  fact('Target close', opp.target_close_date)
  fact('Next step', opp.next_step)
  fact('Objective', opp.objective)
  fact('Strategic thesis', opp.thesis)
  fact('Description', opp.description)
  push('RECORD FIELDS', facts)

  const gaps: string[] = []
  if (openTasks.length === 0) gaps.push('- No open tasks are assigned on this record.')
  if ((notes ?? []).length === 0) gaps.push('- No notes are recorded, so there is no written progress trail here.')
  if (docs.length === 0) gaps.push('- No documents are attached to this record.')
  if (opp.estimated_value === null) gaps.push('- No estimated value is recorded.')
  if (!opp.next_step) gaps.push('- No next step is recorded.')
  push('RECORDED-DATA GAPS (state these as gaps in tracking, never as good news)', gaps)

  push('OPEN TASKS', openTasks.length > 0 ? [formatTasksForPrompt(openTasks, now)] : [])

  push(
    'NOTES (newest first)',
    (notes ?? []).map(
      (n) => `- [${ymd(n.created_at)}]${n.author ? ` ${n.author}:` : ''} ${(n.body ?? '').replace(/\s+/g, ' ').slice(0, 500)}`
    )
  )

  push(
    'DOCUMENTS ON THIS RECORD',
    docs.map(
      (d) => `- ${d.file_name ?? 'Untitled'} [${d.doc_type ?? 'document'}, added ${ymd(d.uploaded_at)}]${d.ai_summary ? `\n    ${d.ai_summary.replace(/\s+/g, ' ').slice(0, 600)}` : '\n    (no summary available)'}`
    )
  )

  push(
    'PASSAGES FROM THOSE DOCUMENTS',
    passages.map((p, i) => `- [${i + 1}] ${p.content.replace(/\s+/g, ' ').slice(0, 900)}`)
  )

  push(
    'CORRESPONDENCE (newest first — this is the complete set retrieved)',
    correspondenceLines(threads, now)
  )

  const recency = contactRecencyLines(threads, now)
  lines.push(...recency.lines)

  const sources: BriefSource[] = [
    ...docs.map((d) => ({
      kind: 'document' as const,
      label: d.file_name ?? 'Untitled document',
      detail: d.doc_type,
    })),
    ...threads.map((t) => ({
      kind: 'correspondence' as const,
      label: t.subject ?? '(no subject)',
      detail: ymd(t.last_at),
      linked: t.linked,
    })),
  ]

  return {
    projectName: name,
    prompt: lines.join('\n'),
    sources,
    stats: {
      documents: docs.length,
      linkedThreads: threads.filter((t) => t.linked).length,
      matchedThreads: threads.filter((t) => !t.linked).length,
      openTasks: openTasks.length,
      updates: (notes ?? []).length,
      lastContact: recency.lastContact,
    },
  }
}
