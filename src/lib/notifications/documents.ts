/**
 * Turning document arrivals into notifications.
 *
 * Shared by the two Drive syncs and the two in-platform upload routes so a
 * document announces itself the same way however it arrived.
 *
 * The grouping rule is the load-bearing part. Linking a folder for the first
 * time imports everything in it — one project folder here holds 62 files — and a
 * bell that lands 62 rows on someone is a bell they turn off. Past a small
 * threshold the run is announced once, naming the count and linking to the
 * record, which is the same reasoning the project feed already follows in
 * posting one update per run rather than one per file.
 */

import { notifyTeam, type NotificationEvent } from './index'
import type { DocumentArrival } from '@/lib/drive/import'

/**
 * Above this many documents in one run, announce the run instead of each file.
 * Four is deliberately low: three documents is a morning's filing and each one
 * is worth its own line; a fourth usually means a batch.
 */
const GROUP_ABOVE = 4

export interface ArrivalScope {
  /** "West Wendover", or "the company knowledge base". */
  label: string
  /** Where clicking goes in the platform. */
  href: string
  /** Null for company-wide documents. */
  projectId?: string | null
}

/** "Eric Tua'one added" / "New document" when Drive tells us nothing. */
function actorPhrase(name: string | null): string {
  return name?.trim() || 'Someone'
}

/**
 * The single actor behind a batch, or null when several people are involved.
 *
 * Null matters twice over: the notification cannot claim one person did it, and
 * nobody can be excluded from it — if Eric and Richard both filed documents in
 * the same hour, both of them want to know about the other's.
 */
function soleActor(arrivals: DocumentArrival[]): { name: string | null; email: string | null } {
  const emails = new Set(arrivals.map((a) => a.actorEmail?.trim().toLowerCase() ?? ''))
  if (emails.size !== 1) return { name: null, email: null }
  return { name: arrivals[0].actorName ?? null, email: arrivals[0].actorEmail ?? null }
}

export function composeArrivalNotifications(
  scope: ArrivalScope,
  arrivals: DocumentArrival[]
): NotificationEvent[] {
  if (arrivals.length === 0) return []

  if (arrivals.length > GROUP_ABOVE) {
    const { name, email } = soleActor(arrivals)
    const added = arrivals.filter((a) => a.kind === 'added').length
    const revised = arrivals.length - added
    const clauses: string[] = []
    if (added) clauses.push(`added ${added} document${added === 1 ? '' : 's'}`)
    // "added 8 documents and revised 1" — the noun is left off the second
    // clause so it does not repeat, but a revised-only batch needs it back.
    if (revised) clauses.push(added ? `revised ${revised}` : `revised ${revised} document${revised === 1 ? '' : 's'}`)

    return [
      {
        kind: 'documents_batch',
        title: `${actorPhrase(name)} ${clauses.join(' and ')} in ${scope.label}`,
        // Names a few so the notification says something, without becoming the
        // list it is deliberately replacing.
        body: arrivals
          .slice(0, 3)
          .map((a) => a.fileName)
          .join(', ') + (arrivals.length > 3 ? `, and ${arrivals.length - 3} more` : ''),
        href: scope.href,
        actorName: name,
        actorEmail: email,
        projectId: scope.projectId ?? null,
      },
    ]
  }

  return arrivals.map((a) => ({
    kind: a.kind === 'revised' ? ('document_revised' as const) : ('document_added' as const),
    title: `${actorPhrase(a.actorName)} ${a.kind === 'revised' ? 'updated' : 'added'} ${a.fileName}`,
    // The document's own AI summary is what answers "what is it about" — the
    // whole reason a notification beats a bare filename.
    body: [scope.label, a.path || null, a.summary?.trim() || null].filter(Boolean).join(' · '),
    href: scope.href,
    externalUrl: a.webViewLink,
    actorName: a.actorName,
    actorEmail: a.actorEmail,
    documentId: a.documentId,
    projectId: scope.projectId ?? null,
  }))
}

/**
 * Announce document arrivals.
 *
 * The single funnel for every document door — the two Drive syncs, the two
 * upload routes, and the on-demand import — so a document announces itself
 * identically however it arrived.
 *
 * The post is awaited but its failure is swallowed inside notifyTeam: losing
 * the Chat space must never cost the import that produced the document.
 */
export async function notifyArrivals(
  scope: ArrivalScope,
  arrivals: DocumentArrival[]
): Promise<number> {
  const events = composeArrivalNotifications(scope, arrivals)
  const written = await notifyTeam(events)
  return written
}

/**
 * Announce a document uploaded through the platform itself.
 *
 * The in-app door was silent while the Drive door was not, which would have
 * taught people that filing in Drive is "seen" and uploading here is not. Same
 * notification, same dismiss, same link.
 *
 * Meeting attachments are deliberately NOT announced by callers: a recording is
 * part of the meeting flow, which produces its own record.
 */
export async function notifyDocumentUpload(opts: {
  documentId: string
  fileName: string
  summary?: string | null
  projectId?: string | null
  entityId?: string | null
  isCompany?: boolean
  actorName?: string | null
  actorEmail?: string | null
}): Promise<number> {
  try {
    let label = 'the platform'
    let href = '/projects'

    if (opts.projectId) {
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const { data } = await createAdminClient()
        .from('projects')
        .select('name')
        .eq('id', opts.projectId)
        .maybeSingle()
      label = data?.name ?? 'a project'
      href = `/projects/${opts.projectId}/documents`
    } else if (opts.isCompany) {
      label = 'the company knowledge base'
      href = '/company'
    } else if (opts.entityId) {
      label = 'a vendor record'
      href = `/vendors/${opts.entityId}`
    }

    return await notifyArrivals({ label, href, projectId: opts.projectId ?? null }, [
      {
        fileName: opts.fileName,
        path: '',
        kind: 'added',
        summary: opts.summary ?? null,
        documentId: opts.documentId,
        // Uploaded here, not in Drive — the platform copy is the only copy.
        webViewLink: null,
        actorName: opts.actorName ?? null,
        actorEmail: opts.actorEmail ?? null,
      },
    ])
  } catch (err) {
    console.error(
      '[notifications] upload announce failed:',
      err instanceof Error ? err.message : String(err)
    )
    return 0
  }
}
