/**
 * ROUTE — decide which record a thread belongs to.
 *
 * The gap this closes: every path in the platform created something NEW. Triage
 * made a lead, clustering made a session, confirming made a project. A reply to
 * a conversation that already had a record had nowhere to go, so a deal's
 * correspondence stopped at whatever was said before the project existed.
 *
 * Two kinds of answer, and the difference matters more than the matching does:
 *
 *   'linked'   — derived, not guessed. The thread IS the record: its lead was
 *                promoted to it, or its cluster was confirmed into it. Nothing
 *                here can be wrong, so the apply phase posts it directly.
 *   'inferred' — matched on solicitation number, deal name and shared external
 *                contacts. Good enough to propose, not good enough to assert, so
 *                the apply phase stages it for review.
 *
 * Deliberately NOT an AI pass. `cluster-phase.ts` already proves deterministic
 * name-and-participant scoring works on this mail; reusing it keeps routing free
 * (the local model is the scarce resource, at 25-50s a call), reproducible, and
 * explainable — the `reason` column says why in words a person can argue with,
 * which is what makes a misfiling correctable rather than merely visible.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { ThreadSummary } from '@/lib/ai/prompts/thread-summary'
import {
  tokenize,
  externalParticipants,
  sharesExternal,
  STRONG_NAME_SIM,
  WEAK_NAME_SIM,
} from './cluster-phase'
import {
  sweepDb,
  type EmailThreadRow,
  type ThreadClusterRow,
  type ThreadLinkRow,
  type LinkRecordKind,
  type LinkCertainty,
} from './db'

/**
 * PostgREST takes filters in the query string, so a `.in()` over a few hundred
 * UUIDs exceeds the URL length limit and comes back as "URI too long" — a
 * failure that only appears once a batch grows past roughly 150 ids, which is
 * to say in production rather than in testing.
 */
const ID_CHUNK = 100

function chunk<T>(items: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const BATCH = 200

export interface RouteProgress {
  threadsConsidered: number
  linked: number
  inferred: number
  unmatched: number
  reasons: Record<string, number>
}

/** One record a thread could belong to, reduced to what matching needs. */
export interface Target {
  kind: LinkRecordKind
  id: string
  name: string
  tokens: Set<string>
  /** Free-text counterparty/customer, folded into the name tokens. */
  counterparty: string | null
  location: string | null
  solicitationNumber: string | null
  /**
   * External addresses already associated with this record (its players).
   *
   * This is what makes the weaker name signal usable: "Bid Invite: Harrisville
   * 1750 N" and a project called "Harrisville City Complex" share few tokens,
   * but a message from the estimator already on the project settles it.
   */
  contacts: Set<string>
}

function target(
  kind: LinkRecordKind,
  id: string,
  name: string,
  extra: {
    counterparty?: string | null
    location?: string | null
    solicitation?: string | null
    contacts?: Iterable<string>
  } = {}
): Target {
  // The counterparty is part of a deal's identity in practice — "Walmart
  // #7450" and "Bid Invite: NEGOTIATED WALMART #7450" only look alike once the
  // customer name is in the same bag of words.
  const tokenSource = [name, extra.counterparty ?? ''].join(' ')
  return {
    kind,
    id,
    name,
    tokens: tokenize(tokenSource),
    counterparty: extra.counterparty ?? null,
    location: extra.location ?? null,
    solicitationNumber: normalizeSolicitation(extra.solicitation ?? null),
    contacts: externalParticipants([...(extra.contacts ?? [])]),
  }
}

/**
 * How much of the shorter name the two have in common.
 *
 * Jaccard is the right measure for the clusterer, which compares two email
 * subjects — similar things of similar length. Matching a subject against a
 * record name is asymmetric: "Giovanni campus schedule" against "DUBHES Helper
 * / Giovanni Resilience Campus" shares both meaningful words of the subject, yet
 * scores 0.33 on Jaccard purely because the project's formal name is longer.
 * Penalising a record for having a long name is not a signal about anything.
 */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / Math.min(a.size, b.size)
}

/**
 * Solicitation numbers are written inconsistently across a bid's life —
 * "RFQ 2027-06", "rfq2027_06", "#2027-06". Comparing the digits and letters
 * alone is what makes an exact match actually exact.
 */
export function normalizeSolicitation(value: string | null): string | null {
  if (!value) return null
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  // Two or three characters is not an identifier, it is a coincidence waiting
  // to happen.
  return cleaned.length >= 4 ? cleaned : null
}

export interface MatchResult {
  target: Target
  confidence: number
  reason: string
}

/**
 * Best record for a thread, or null when nothing clears the bar.
 *
 * Falling through to null is a first-class outcome, not a failure: an unmatched
 * thread keeps today's behavior (a new lead, or a new cluster), which is correct
 * for genuinely new work. Reaching for the closest record regardless is how
 * correspondence lands on the wrong project.
 */
export function bestMatch(
  subject: string,
  summary: ThreadSummary | null,
  participants: string[],
  targets: Target[]
): MatchResult | null {
  const dealName = summary?.deal_name ?? subject ?? ''
  // The thread's counterparty is deliberately NOT folded in here.
  //
  // Doing so cross-matched one side's counterparty against the other's name and
  // produced confident nonsense: mail about the Hafoka residence, an LA
  // commercial building and a Myton campus all landed on the "Dino Plumbing"
  // opportunity, purely because Dino was the subcontractor on the other end.
  // Who is on a thread is corroboration; it is not what the deal IS.
  const threadTokens = tokenize(dealName)
  const threadExternal = externalParticipants(participants)

  // A solicitation number is an identifier rather than a description, so it
  // outranks every similarity score — including a name that looks unrelated,
  // which is exactly the case name matching cannot solve.
  const threadSolicitation = normalizeSolicitation(
    extractSolicitation(summary, subject)
  )
  if (threadSolicitation) {
    // Containment rather than equality: the same number really is stored with
    // extra prefixes in this data — a parcel recorded as "(2) 4-6-034: 019"
    // against a bid that cites "Solicitation No. 4-6-034-019". Six characters is
    // the floor at which a contained run of digits stops being a coincidence.
    const exact = targets.find((t) => {
      const s = t.solicitationNumber
      if (!s) return false
      if (s === threadSolicitation) return true
      const [long, short] = s.length >= threadSolicitation.length
        ? [s, threadSolicitation]
        : [threadSolicitation, s]
      return short.length >= 6 && long.includes(short)
    })
    if (exact) {
      return { target: exact, confidence: 1, reason: `same solicitation number` }
    }
  }

  if (threadTokens.size === 0) return null

  const scored: MatchResult[] = []
  for (const t of targets) {
    const sim = overlap(threadTokens, t.tokens)
    if (sim === 0) continue

    let shared = 0
    for (const tok of threadTokens) if (t.tokens.has(tok)) shared++
    const sharedContact = sharesExternal(threadExternal, t.contacts)

    // Either two distinctive words in common, or the record's whole name
    // present. One word out of several is a coincidence: this portfolio holds
    // "Myton Rail", "Myton Development" and an unrelated Myton data centre
    // pursuit, and sharing only "Myton" was collecting all of them onto
    // whichever record happened to have a contact attached.
    //
    // Full coverage is different in kind — when a record is called "GridEdge"
    // and a thread says GridEdge, the entire name is there, and there is nothing
    // more the name could have said.
    //
    // Note this cannot be solved by discounting place names: several records ARE
    // named for their location ("West Wendover", "Tooele"), and those are among
    // the most reliable matches in the corpus.
    // A one-word name is ambiguous evidence by nature — it is either a
    // distinctive brand ("GridEdge") or a common place ("Tooele"), and nothing
    // in the name says which. So the whole name being present counts on its own
    // only when the name is more than one word; a single word needs a contact to
    // corroborate it.
    const fullyCoversName = shared === t.tokens.size
    const strongEnough = shared >= 2 || (fullyCoversName && sharedContact)
    if (!strongEnough) continue

    // The same two-signal rule the clusterer uses, for the same reason: a
    // strong name match stands alone, a weaker one needs a person in common.
    if (sim >= STRONG_NAME_SIM) {
      scored.push({ target: t, confidence: sim, reason: 'same deal name' })
    } else if (sim >= WEAK_NAME_SIM && sharedContact) {
      scored.push({ target: t, confidence: sim, reason: 'similar deal name + shared contact' })
    }
  }

  if (scored.length === 0) return null
  scored.sort((a, b) => b.confidence - a.confidence)

  // Ambiguity is a reason to do nothing, not to pick one.
  //
  // "Myton Rail" and "Myton Development" are different projects that score
  // identically against a thread that says only "Myton". Choosing whichever
  // sorted first would file real correspondence on the wrong record roughly half
  // the time, and leaving it unmatched costs only that it stays where it is.
  const [top, runnerUp] = scored
  if (runnerUp && top.confidence - runnerUp.confidence < AMBIGUITY_MARGIN) return null

  return top
}

/**
 * How far ahead the best match must be before it is treated as the answer.
 *
 * Set against real data: the portfolio contains several projects sharing a
 * place name, and those are exactly the pairs a thread scores evenly against.
 */
const AMBIGUITY_MARGIN = 0.1

/** Pull a solicitation number out of whatever the summary and subject carry. */
function extractSolicitation(summary: ThreadSummary | null, subject: string): string | null {
  const haystack = [subject, ...(summary?.key_facts ?? [])].join(' ')
  // Solicitation-shaped tokens: four or more characters, typically hyphenated,
  // introduced by a word that announces an identifier. Deliberately narrow — a
  // loose pattern matches dates, dollar figures and phone numbers, and a wrong
  // identifier match is worse than none because it outranks everything else.
  const pattern =
    /\b(?:rf[pqi]|ib|itb|sol(?:icitation)?|bid|project)\s*(?:no\.?|number|#)?\s*([a-z0-9][a-z0-9-]{3,})/gi

  // Every candidate, not just the first: "Bid Invite: Solicitation No.
  // 4-6-034-019" matches on "Bid" before it reaches the actual number, and
  // captures the word "Invite". A solicitation number always contains a digit,
  // which is what tells the two apart.
  for (const m of haystack.matchAll(pattern)) {
    if (/\d/.test(m[1])) return m[1]
  }
  return null
}

export async function routeThreads(
  opts: { threadIds?: string[]; limit?: number; includeRouted?: boolean } = {}
): Promise<RouteProgress> {
  const db = sweepDb()
  const progress: RouteProgress = {
    threadsConsidered: 0,
    linked: 0,
    inferred: 0,
    unmatched: 0,
    reasons: {},
  }

  const targets = await loadTargets()

  let query = db
    .from('email_threads')
    .select('id, subject, participants, summary, cluster_id, pipeline, message_count')
    .eq('summary_state', 'summarized')
    .order('last_at', { ascending: false })
    .limit(opts.limit ?? BATCH)

  // Unrouted only, unless the caller named specific threads (the backfill and
  // the tests both do). "No record matched" leaves no row behind, so without
  // this the phase would re-read the same newest page every run and never reach
  // anything older.
  if (opts.threadIds?.length) query = query.in('id', opts.threadIds)
  else if (!opts.includeRouted) query = query.is('routed_at', null)

  const { data, error } = await query
  if (error) throw new Error(`Could not load threads to route: ${error.message}`)

  const rows = (data ?? []) as Array<
    Pick<
      EmailThreadRow,
      'id' | 'subject' | 'participants' | 'summary' | 'cluster_id' | 'message_count'
    >
  >
  if (rows.length === 0) return progress

  const threadIds = rows.map((r) => r.id)
  const [existing, derivedByThread] = await Promise.all([
    loadLinks(threadIds),
    loadDerivedLinks(threadIds, rows),
  ])

  for (const row of rows) {
    progress.threadsConsidered++
    const links = existing.get(row.id) ?? []

    // Derived links first. These are facts about what the platform already did,
    // so they are reconciled on every pass — which also means a link lost to a
    // failed write, or predating this phase, heals itself.
    const derived = derivedByThread.get(row.id) ?? []
    let wroteLinked = false
    for (const d of derived) {
      const already = links.find((l) => l.record_kind === d.kind && l.record_id === d.id)
      if (already?.certainty === 'linked') {
        wroteLinked = true
        continue
      }
      await upsertLink(row.id, d.kind, d.id, 'linked', 1, d.reason, row.message_count ?? 0)
      progress.linked++
      progress.reasons[d.reason] = (progress.reasons[d.reason] ?? 0) + 1
      wroteLinked = true
    }

    // A thread that IS a record needs no guessing, and guessing anyway would
    // scatter its correspondence across records it merely resembles.
    if (wroteLinked || links.some((l) => l.certainty === 'linked')) {
      await markRouted(row.id)
      continue
    }

    const summary = (row.summary ?? null) as ThreadSummary | null
    const match = bestMatch(row.subject ?? '', summary, row.participants ?? [], targets)
    if (!match) {
      progress.unmatched++
      await markRouted(row.id)
      continue
    }

    const already = links.find(
      (l) => l.record_kind === match.target.kind && l.record_id === match.target.id
    )
    if (already) {
      await markRouted(row.id)
      continue
    }

    await upsertLink(
      row.id,
      match.target.kind,
      match.target.id,
      'inferred',
      match.confidence,
      `${match.reason} — ${match.target.name}`
    )
    progress.inferred++
    progress.reasons[match.reason] = (progress.reasons[match.reason] ?? 0) + 1
    await markRouted(row.id)
  }

  return progress
}

async function markRouted(threadId: string): Promise<void> {
  const { error } = await sweepDb()
    .from('email_threads')
    .update({ routed_at: new Date().toISOString() })
    .eq('id', threadId)
  if (error) console.error(`[sweep/route] could not mark ${threadId} routed:`, error.message)
}

/**
 * Links the platform can state as fact rather than infer, for a whole page at
 * once.
 *
 * A lead's thread is that lead's thread by definition; once promoted, it is the
 * promoted record's. A confirmed cluster's threads are the record it became.
 *
 * Batched deliberately: per-thread this was two round trips each, which on a
 * full backfill of 1,600 threads is 3,200 queries to answer something two
 * queries can.
 */
async function loadDerivedLinks(
  threadIds: string[],
  rows: Array<Pick<EmailThreadRow, 'id' | 'cluster_id'>>
): Promise<Map<string, DerivedLink[]>> {
  const db = sweepDb()
  const out = new Map<string, DerivedLink[]>()
  if (threadIds.length === 0) return out

  const push = (threadId: string, link: DerivedLink) => {
    const list = out.get(threadId) ?? []
    list.push(link)
    out.set(threadId, list)
  }

  const leadRows: unknown[] = []
  for (const ids of chunk(threadIds)) {
    const { data } = await db
      .from('leads')
      .select(
        'id, thread_id, status, promoted_project_id, promoted_opportunity_id, promoted_steel_deal_id'
      )
      .in('thread_id', ids)
    leadRows.push(...(data ?? []))
  }

  for (const raw of leadRows) {
    const lead = raw as {
      id: string
      thread_id: string
      status: string
      promoted_project_id: string | null
      promoted_opportunity_id: string | null
      promoted_steel_deal_id: string | null
    }
    if (lead.promoted_project_id) {
      push(lead.thread_id, {
        kind: 'project',
        id: lead.promoted_project_id,
        reason: 'promoted from this lead',
      })
    } else if (lead.promoted_opportunity_id) {
      push(lead.thread_id, {
        kind: 'opportunity',
        id: lead.promoted_opportunity_id,
        reason: 'promoted from this lead',
      })
    } else if (lead.promoted_steel_deal_id) {
      push(lead.thread_id, {
        kind: 'steel_deal',
        id: lead.promoted_steel_deal_id,
        reason: 'promoted from this lead',
      })
    } else if (lead.status !== 'spam') {
      // Still a lead: later mail refreshes it in place rather than going to a
      // record that does not exist yet.
      push(lead.thread_id, { kind: 'lead', id: lead.id, reason: 'this thread is the lead' })
    }
  }

  const clusterIds = [...new Set(rows.map((r) => r.cluster_id).filter((c): c is string => !!c))]
  if (clusterIds.length > 0) {
    const confirmed = new Map<string, Pick<ThreadClusterRow, 'project_id' | 'opportunity_id'>>()
    for (const ids of chunk(clusterIds)) {
      const { data: clusters } = await db
        .from('thread_clusters')
        .select('id, state, project_id, opportunity_id')
        .in('id', ids)
        .eq('state', 'confirmed')
      for (const raw of clusters ?? []) {
        const c = raw as ThreadClusterRow
        confirmed.set(c.id, c)
      }
    }

    for (const row of rows) {
      const c = row.cluster_id ? confirmed.get(row.cluster_id) : null
      if (!c) continue
      if (c.project_id) {
        push(row.id, {
          kind: 'project',
          id: c.project_id,
          reason: 'confirmed from this conversation',
        })
      }
      if (c.opportunity_id) {
        push(row.id, {
          kind: 'opportunity',
          id: c.opportunity_id,
          reason: 'confirmed from this conversation',
        })
      }
    }
  }

  return out
}

interface DerivedLink {
  kind: LinkRecordKind
  id: string
  reason: string
}

async function loadLinks(threadIds: string[]): Promise<Map<string, ThreadLinkRow[]>> {
  const db = sweepDb()
  const out = new Map<string, ThreadLinkRow[]>()
  if (threadIds.length === 0) return out

  for (const ids of chunk(threadIds)) {
    const { data, error } = await db.from('thread_links').select('*').in('thread_id', ids)
    if (error) throw new Error(`Could not load thread links: ${error.message}`)
    for (const raw of data ?? []) {
      const link = raw as ThreadLinkRow
      const list = out.get(link.thread_id) ?? []
      list.push(link)
      out.set(link.thread_id, list)
    }
  }
  return out
}

/**
 * Write a link, upgrading certainty but never downgrading it.
 *
 * An inferred match must not overwrite a link the platform knows to be fact —
 * that would demote a promoted record's own conversation to something needing
 * review, and would keep flapping every run.
 */
export async function upsertLink(
  threadId: string,
  kind: LinkRecordKind,
  recordId: string,
  certainty: LinkCertainty,
  confidence: number | null,
  reason: string,
  /**
   * How much of the thread the record has ALREADY absorbed.
   *
   * This is the difference between a link that describes work already done and
   * one that describes work outstanding. A lead was triaged from its whole
   * thread, and a promotion carried the conversation across — seeding those at
   * the current message count means only genuinely NEW mail produces an update.
   * Seeding them at zero instead would re-post every thread the platform has
   * ever read and requeue all 236 leads for scoring, some two hours of model
   * time to tell the records what they already knew.
   *
   * An inferred link is the opposite: that record has never seen this
   * conversation, so it starts at zero and receives the whole of it once.
   */
  appliedMessageCount = 0
): Promise<void> {
  const db = sweepDb()
  const { data: existing } = await db
    .from('thread_links')
    .select('id, certainty')
    .eq('thread_id', threadId)
    .eq('record_kind', kind)
    .eq('record_id', recordId)
    .maybeSingle()

  const prior = existing as { id: string; certainty: LinkCertainty } | null
  if (prior) {
    if (prior.certainty === 'linked' || certainty !== 'linked') return
    await db.from('thread_links').update({ certainty, confidence, reason }).eq('id', prior.id)
    return
  }

  const { error } = await db.from('thread_links').insert({
    thread_id: threadId,
    record_kind: kind,
    record_id: recordId,
    certainty,
    confidence,
    reason,
    applied_message_count: appliedMessageCount,
  })
  if (error) console.error(`[sweep/route] could not link ${threadId} → ${kind}:`, error.message)
}

/**
 * Every record a thread could belong to.
 *
 * Loaded whole rather than queried per thread: the portfolio is 15 projects, 4
 * opportunities and a handful of steel deals, so the entire matching space fits
 * in memory and costs one round trip instead of one per thread.
 */
export async function loadTargets(): Promise<Target[]> {
  const supabase = createAdminClient()
  const out: Target[] = []

  const [{ data: projects }, { data: opportunities }, { data: players }] = await Promise.all([
    supabase.from('projects').select('id, name, location, solicitation_number, status'),
    supabase.from('opportunities').select('id, name, counterparty, location, status'),
    supabase.from('project_players').select('project_id, party:parties(email)'),
  ])

  // Who is already on each project, so a message from a known counterparty can
  // carry a name match that is close but not decisive.
  const projectContacts = new Map<string, Set<string>>()
  for (const raw of players ?? []) {
    const row = raw as { project_id: string | null; party: { email: string | null } | null }
    const email = row.party?.email
    if (!row.project_id || !email) continue
    const set = projectContacts.get(row.project_id) ?? new Set<string>()
    set.add(email.toLowerCase())
    projectContacts.set(row.project_id, set)
  }

  for (const p of projects ?? []) {
    out.push(
      target('project', p.id, p.name ?? '', {
        location: p.location,
        solicitation: p.solicitation_number,
        contacts: projectContacts.get(p.id) ?? [],
      })
    )
  }
  for (const o of opportunities ?? []) {
    // Closed opportunities stay matchable: correspondence about a deal that
    // closed is still about that deal, and filing it is how the record stays
    // a complete account of what happened.
    out.push(
      target('opportunity', o.id, o.name ?? '', {
        counterparty: o.counterparty,
        location: o.location,
      })
    )
  }

  const steel = await sweepDb().from('steel_deals').select('id, name, customer')
  for (const raw of steel.data ?? []) {
    const d = raw as { id: string; name: string | null; customer: string | null }
    out.push(target('steel_deal', d.id, d.name ?? '', { counterparty: d.customer }))
  }

  return out.filter((t) => t.name.trim().length > 0)
}
