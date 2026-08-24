/**
 * Sweep phase 3 — CLUSTER.
 *
 * Groups summarized "deal" threads into candidate deals. One cluster becomes
 * one review session, so this is what stops a pursuit that ran across nine
 * threads from landing in the CRM as nine separate projects.
 *
 * Deliberately NOT an AI pass. The map phase already did the hard part by
 * writing a canonical `deal_name` for each thread; grouping on top of that is
 * cheap string work, and keeping it deterministic means the result is
 * explainable ("merged: same deal name + shared contact"), reproducible, and
 * free — which matters when the alternative is thousands more local-model calls.
 *
 * Two signals, both required to be meaningful:
 * - deal-name similarity (token Jaccard over normalized names)
 * - a shared EXTERNAL participant (internal-only overlap proves nothing —
 *   moose@ and tuaone@ are on everything)
 */

import { MAILBOXES } from '@/lib/integrations/google-workspace'
import type { ThreadSummary } from '@/lib/ai/prompts/thread-summary'
import { sweepDb, type EmailThreadRow, type ThreadClusterRow } from './db'

/** Merge outright at or above this name similarity. */
const STRONG_NAME_SIM = 0.6
/** Merge at or above this, but only with a shared external participant. */
const WEAK_NAME_SIM = 0.34

/** Domains treated as "us" — participants here carry no grouping signal. */
const INTERNAL_DOMAINS = new Set(
  MAILBOXES.map((m) => m.split('@')[1]).filter(Boolean)
)

const STOPWORDS = new Set([
  're', 'fw', 'fwd', 'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'on', 'at', 'in',
  'project', 'proposal', 'quote', 'quotation', 'bid', 'rfp', 'rfq', 'rfi', 'update',
  'question', 'questions', 'follow', 'up', 'meeting', 'call', 'info', 'information',
  'new', 'request', 'inquiry', 'discussion', 'regarding', 'ref',
])

export function normalizeDealName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^((re|fw|fwd)\s*:\s*)+/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(name: string): Set<string> {
  return new Set(
    normalizeDealName(name)
      .split(' ')
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

function externalParticipants(addresses: string[]): Set<string> {
  const out = new Set<string>()
  for (const a of addresses) {
    const domain = a.split('@')[1]
    if (!domain || INTERNAL_DOMAINS.has(domain)) continue
    out.add(a.toLowerCase())
  }
  return out
}

function sharesExternal(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true
  return false
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

interface Candidate {
  id: string
  dealName: string
  tokens: Set<string>
  external: Set<string>
  firstAt: string | null
  lastAt: string | null
  participants: string[]
}

/** Union-find — small, and the only honest way to make merges order-independent. */
class DisjointSet {
  private parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

/** Decide whether two candidates belong to the same deal, and say why. */
export function shouldMerge(a: Candidate, b: Candidate): string | null {
  const sim = jaccard(a.tokens, b.tokens)
  if (sim >= STRONG_NAME_SIM) return 'same deal name'
  if (sim >= WEAK_NAME_SIM && sharesExternal(a.external, b.external)) {
    return 'similar deal name + shared contact'
  }
  return null
}

export interface ClusterProgress {
  threadsConsidered: number
  clustersCreated: number
  threadsAttachedToExisting: number
  reasons: Record<string, number>
}

/**
 * Cluster every summarized deal thread that isn't in a cluster yet.
 *
 * New threads first try to join an EXISTING open cluster (so an incremental
 * sweep folds a reply into the deal it belongs to rather than opening a
 * duplicate); whatever is left is grouped among itself into new clusters.
 */
export async function clusterUnassigned(
  opts: { maxThreads?: number } = {}
): Promise<ClusterProgress> {
  const db = sweepDb()
  const progress: ClusterProgress = {
    threadsConsidered: 0,
    clustersCreated: 0,
    threadsAttachedToExisting: 0,
    reasons: {},
  }

  const { data: threadData, error } = await db
    .from('email_threads')
    .select('id, subject, participants, first_at, last_at, summary')
    .eq('summary_state', 'summarized')
    .is('cluster_id', null)
    .order('last_at', { ascending: false })
    .limit(opts.maxThreads ?? 2000)

  if (error) throw new Error(`Could not load unclustered threads: ${error.message}`)

  const candidates: Candidate[] = []
  for (const row of (threadData ?? []) as Pick<
    EmailThreadRow,
    'id' | 'subject' | 'participants' | 'first_at' | 'last_at' | 'summary'
  >[]) {
    const summary = row.summary as ThreadSummary | null
    // Only deal threads cluster. Operational and noise stay unclustered by
    // design — they're searchable, but they never propose a CRM record.
    if (!summary || summary.relevance !== 'deal') continue
    const dealName = summary.deal_name?.trim() || row.subject?.trim() || ''
    if (!dealName) continue

    candidates.push({
      id: row.id,
      dealName,
      tokens: tokenize(dealName),
      external: externalParticipants(row.participants ?? []),
      firstAt: row.first_at,
      lastAt: row.last_at,
      participants: row.participants ?? [],
    })
  }
  progress.threadsConsidered = candidates.length
  if (candidates.length === 0) return progress

  // ── Attach to existing open clusters first ────────────────────────────────
  const { data: openData } = await db
    .from('thread_clusters')
    .select('id, label, participants, first_at, last_at, thread_count')
    .eq('state', 'open')

  const openClusters = ((openData ?? []) as ThreadClusterRow[]).map((c) => ({
    row: c,
    candidate: {
      id: c.id,
      dealName: c.label ?? '',
      tokens: tokenize(c.label ?? ''),
      external: externalParticipants(c.participants ?? []),
      firstAt: c.first_at,
      lastAt: c.last_at,
      participants: c.participants ?? [],
    } as Candidate,
  }))

  const leftovers: Candidate[] = []
  for (const cand of candidates) {
    let best: { clusterId: string; reason: string; sim: number } | null = null
    for (const open of openClusters) {
      const reason = shouldMerge(cand, open.candidate)
      if (!reason) continue
      const sim = jaccard(cand.tokens, open.candidate.tokens)
      if (!best || sim > best.sim) best = { clusterId: open.row.id, reason, sim }
    }

    if (best) {
      await db.from('email_threads').update({ cluster_id: best.clusterId }).eq('id', cand.id)
      // Widen the cluster so the next thread can match on the new contacts too.
      const target = openClusters.find((o) => o.row.id === best!.clusterId)!
      for (const p of cand.participants) target.candidate.participants.push(p)
      target.candidate.external = externalParticipants(target.candidate.participants)
      progress.threadsAttachedToExisting++
      progress.reasons[best.reason] = (progress.reasons[best.reason] ?? 0) + 1
    } else {
      leftovers.push(cand)
    }
  }

  // ── Group the remainder among themselves ──────────────────────────────────
  const ds = new DisjointSet(leftovers.length)
  for (let i = 0; i < leftovers.length; i++) {
    for (let j = i + 1; j < leftovers.length; j++) {
      const reason = shouldMerge(leftovers[i], leftovers[j])
      if (reason) {
        ds.union(i, j)
        progress.reasons[reason] = (progress.reasons[reason] ?? 0) + 1
      }
    }
  }

  const groups = new Map<number, Candidate[]>()
  for (let i = 0; i < leftovers.length; i++) {
    const root = ds.find(i)
    const group = groups.get(root)
    if (group) group.push(leftovers[i])
    else groups.set(root, [leftovers[i]])
  }

  for (const group of groups.values()) {
    // Label with the most common deal name, tie-broken by the newest thread.
    const counts = new Map<string, number>()
    for (const c of group) counts.set(c.dealName, (counts.get(c.dealName) ?? 0) + 1)
    const label =
      [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ??
      group[0].dealName

    const participants = [...new Set(group.flatMap((c) => c.participants))]
    const firstAt = group.map((c) => c.firstAt).filter(Boolean).sort()[0] ?? null
    const lastAt = group.map((c) => c.lastAt).filter(Boolean).sort().reverse()[0] ?? null

    const { data: cluster, error: insertErr } = await db
      .from('thread_clusters')
      .insert({
        label,
        state: 'open',
        reason:
          group.length === 1
            ? 'single thread'
            : `${group.length} threads grouped by deal name and shared contacts`,
        thread_count: group.length,
        participants,
        first_at: firstAt,
        last_at: lastAt,
      })
      .select('id')
      .single()

    if (insertErr || !cluster) {
      console.error('[sweep/cluster] could not create cluster:', insertErr?.message)
      continue
    }

    const { error: assignErr } = await db
      .from('email_threads')
      .update({ cluster_id: (cluster as { id: string }).id })
      .in('id', group.map((c) => c.id))
    if (assignErr) {
      console.error('[sweep/cluster] could not assign threads:', assignErr.message)
      continue
    }
    progress.clustersCreated++
  }

  // Existing clusters that absorbed threads need their rollups refreshed.
  for (const open of openClusters) {
    await refreshClusterRollups(open.row.id)
  }

  return progress
}

/** Recompute a cluster's cached counts and date span from its threads. */
export async function refreshClusterRollups(clusterId: string): Promise<void> {
  const db = sweepDb()
  const { data } = await db
    .from('email_threads')
    .select('participants, first_at, last_at')
    .eq('cluster_id', clusterId)

  const rows = (data ?? []) as Pick<EmailThreadRow, 'participants' | 'first_at' | 'last_at'>[]
  if (rows.length === 0) return

  await db
    .from('thread_clusters')
    .update({
      thread_count: rows.length,
      participants: [...new Set(rows.flatMap((r) => r.participants ?? []))],
      first_at: rows.map((r) => r.first_at).filter(Boolean).sort()[0] ?? null,
      last_at: rows.map((r) => r.last_at).filter(Boolean).sort().reverse()[0] ?? null,
    })
    .eq('id', clusterId)
}
