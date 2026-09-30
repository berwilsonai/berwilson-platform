/**
 * Narrow a category row to what a browser may see.
 *
 * The registry row carries operational detail — the handoff address, the Drive
 * folder id, the outside addresses it is shared with. None of that belongs in a
 * page: a lead's queue card has no use for it, and an outside collaborator's
 * email address is not something to ship into a client bundle where it ends up
 * in the HTML payload of every lead render.
 *
 * `handoff_ready` is the one thing the UI genuinely needs to know about the
 * address: whether there IS one. That is what decides whether the handoff button
 * is offered or explains itself as unconfigured — which is the failure the old
 * `DINO_LEAD_EMAIL` env var produced for a year, a button that 400'd on press.
 */

import type { LeadCategoryView } from '@/lib/utils/leads'
import type { LeadCategory } from './categories'

export function toCategoryView(c: LeadCategory): LeadCategoryView {
  return {
    key: c.key,
    label: c.label,
    destination: c.destination,
    destination_note: c.destination_note,
    handoff_ready: !!c.handoff_email?.includes('@'),
    tone: c.tone,
    active: c.active,
  }
}

export function toCategoryViews(rows: LeadCategory[]): LeadCategoryView[] {
  return rows.map(toCategoryView)
}
