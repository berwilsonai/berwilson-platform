/**
 * WHICH write a /decide row performs — as data, so it can be tested.
 *
 * ⚠ THIS WAS AN `if/else if` CHAIN INSIDE A CLIENT COMPONENT AND IT HAD A HOLE
 * IN IT. The chain read `item.kind === 'document' || item.kind === 'misfiled'`
 * and `unparented` — a third document-shaped kind added later — fell past it
 * into the final `else`, which PATCHes `/api/review/<id>` with a DOCUMENT's
 * uuid. Measured 2026-10-28: **120 rows** in the "No deal yet" class, every one
 * of whose Accept button answered `404 Review item not found`. A green
 * typecheck the whole time, because every arm takes a string.
 *
 * §12 names the shape exactly — when a function branches on where something
 * came from, every source that can reach it needs an arm, not just the one
 * being added today — and the remedy §12 gives for a branch like this is to
 * make the members assert against each other rather than fix them one failure
 * at a time. A pure function returning the request is what makes that possible:
 * `accept-request.test.ts` walks every kind × every action it can carry and
 * asserts the URL is one the kind's rows actually live at.
 *
 * Nothing here performs a write. It decides what the write WOULD be.
 */

import type { DecideKind, AcceptAction } from '@/lib/decide/types'

/** The record a human chose, overriding whatever the row would resolve. */
export interface AcceptTarget {
  kind: 'project' | 'opportunity' | 'steel_deal'
  id: string
}

/** Just enough of a row to decide what pressing it does. */
export interface AcceptSubject {
  id: string
  kind: DecideKind
  fileTarget?: { kind: 'project' | 'opportunity' | 'steel_deal'; id: string } | null
  fileSource?: 'documents' | 'opportunity_documents' | null
  /** Carried into an exclusion as its recorded reason. */
  note?: string | null
}

export type AcceptPlan =
  | { kind: 'request'; method: 'POST' | 'PATCH'; url: string; body: unknown }
  /**
   * Read the draft the review form builds, then post it to confirm.
   *
   * ⚠ FETCHED RATHER THAN RECONSTRUCTED. The draft comes from the full
   * extraction through the same function the review screen uses, so the two
   * paths cannot produce different records.
   */
  | { kind: 'draft-then-confirm'; draftUrl: string; confirmUrl: string }
  /** Nothing can be written. The reason is shown to the person who pressed. */
  | { kind: 'refused'; reason: string }

/** The three kinds that are a row about a FILE, and share one write. */
const DOCUMENT_KINDS: readonly DecideKind[] = ['document', 'unparented', 'misfiled']

export function planAccept(
  item: AcceptSubject,
  action: AcceptAction,
  target?: AcceptTarget
): AcceptPlan {
  const picked = target ? { target: { kind: target.kind, id: target.id } } : {}

  if (item.kind === 'intake') {
    /*
      ⚠ `task` IS INTAKE-WIDE BUT NOT KIND-FREE, AND THE DIFFERENCE IS THE BUG
      THIS FILE WAS WRITTEN FOR, FOUND TWICE.

      It belongs to both an email package and a recorded meeting — both are
      `intake`, and the route resolves the deal from the session the same way
      the row's primary action did (task-target.ts), so branching on email vs
      meeting would be two arms for one write. It does NOT belong to a flagged
      extraction or a field question: the chain this replaced tested `action`
      alone, BEFORE any kind, so a `review` row pressed with `task` would have
      posted a `review_queue` uuid as a `session_id`. Nothing offers that
      combination today, which is exactly what made the first instance of this
      (`unparented`) survive to 120 live rows.
    */
    if (action === 'task') {
      return {
        kind: 'request',
        method: 'POST',
        url: '/api/email-ingestion/tasks',
        body: { session_id: item.id, ...picked },
      }
    }
    if (action === 'merge') {
      return {
        kind: 'request',
        method: 'POST',
        url: '/api/email-ingestion/merge',
        body: { session_id: item.id, ...picked },
      }
    }
    if (action === 'project' || action === 'opportunity') {
      return {
        kind: 'draft-then-confirm',
        draftUrl: `/api/email-ingestion/sessions/${item.id}`,
        confirmUrl: '/api/email-ingestion/confirm',
      }
    }
    return { kind: 'refused', reason: `A staged conversation cannot be ${action}d.` }
  }

  if (DOCUMENT_KINDS.includes(item.kind)) {
    const source = item.fileSource ?? 'documents'
    if (action === 'setaside') {
      return {
        kind: 'request',
        method: 'POST',
        url: `/api/documents/${item.id}/refile`,
        body: { exclude: true, reason: item.note ?? null, source },
      }
    }
    if (action === 'file') {
      const destination = target ? { kind: target.kind, id: target.id } : item.fileTarget
      if (!destination) {
        return { kind: 'refused', reason: 'This document has no record to file it on.' }
      }
      return {
        kind: 'request',
        method: 'POST',
        url: `/api/documents/${item.id}/refile`,
        body: { target: destination, source },
      }
    }
    return { kind: 'refused', reason: `A document cannot be ${action}d.` }
  }

  if (item.kind === 'proposal') {
    if (action !== 'confirmfield') {
      return { kind: 'refused', reason: `A field question cannot be ${action}d.` }
    }
    return {
      kind: 'request',
      method: 'PATCH',
      url: `/api/provenance/proposals/${item.id}`,
      body: { verdict: 'accept' },
    }
  }

  if (item.kind === 'review') {
    if (action !== 'approve') {
      return { kind: 'refused', reason: `A flagged item cannot be ${action}d.` }
    }
    return {
      kind: 'request',
      method: 'PATCH',
      url: `/api/review/${item.id}`,
      body: { resolution: 'approved' },
    }
  }

  /*
    ⚠ NO TRAILING `else` THAT GUESSES, which is the whole point of the rewrite.
    The old chain's final arm was the review route, so a kind nobody had thought
    about was silently sent a review item's id. An unknown kind now refuses and
    names itself, which is a toast somebody reads rather than a 404 nobody
    attributes.
  */
  return {
    kind: 'refused',
    reason: `Nothing here knows how to accept a “${item.kind}” row.`,
  }
}
