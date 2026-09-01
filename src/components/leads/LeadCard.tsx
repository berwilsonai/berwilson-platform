'use client'

import { useState } from 'react'
import { Paperclip, Building2, MapPin, X, Loader2 } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { formatValue, bidDueLabel, bidDueColor } from '@/lib/utils/constants'
import { ROUTE_LABELS, ROUTE_BADGE, FIT_BADGE, FIT_LABELS, STATUS_BADGE, STATUS_LABELS } from '@/lib/utils/leads'
import type { LeadRow } from '@/lib/leads/db'

/**
 * One lead in the queue. Reads top-to-bottom as the decision itself: what fit
 * we scored it, what it is, who sent it, and when it closes.
 */
export default function LeadCard({
  lead,
  onOpen,
  onDelete,
}: {
  lead: LeadRow
  onOpen: (lead: LeadRow) => void
  onDelete: (lead: LeadRow) => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const due = bidDueLabel(lead.bid_due_date)
  const overdue = lead.bid_due_date ? new Date(lead.bid_due_date) < new Date() : false
  const isOpen = lead.status === 'new' || lead.status === 'reviewing'

  async function remove(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDeleting(true)
    try {
      await onDelete(lead)
    } finally {
      // The row is removed on success, so this only matters when the delete
      // failed and the card is still on screen.
      setDeleting(false)
    }
  }

  return (
    <div
      className={`relative w-full rounded-xl border border-border bg-card elev-1 lift p-4 ${
        lead.status === 'spam' ? 'opacity-60' : ''
      } ${deleting ? 'opacity-50' : ''}`}
    >
      {/* Whole-card open target, stretched underneath the content. The delete
          control has to be a real button and a button cannot nest inside one,
          so the card itself stops being the button. */}
      <button
        type="button"
        onClick={() => onOpen(lead)}
        aria-label={`Open ${lead.title}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {/* Clicks fall through to the overlay above; only the controls opt back in. */}
      <div className="pointer-events-none relative space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm leading-snug break-words">{lead.title}</p>
            {lead.summary && (
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {lead.summary}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-start gap-1.5">
            {lead.fit_recommendation && (
              <div className="text-right">
                <Chip tone={FIT_BADGE[lead.fit_recommendation]}>
                  {FIT_LABELS[lead.fit_recommendation]}
                </Chip>
                {lead.fit_score != null && (
                  <p className="mt-1 tnum text-xs text-muted-foreground">{lead.fit_score}/100</p>
                )}
              </div>
            )}
            {/* Most leads are decidable from the headline alone, so the discard
                lives here rather than behind opening the detail sheet. */}
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              title="Delete this lead"
              aria-label={`Delete ${lead.title}`}
              className="pointer-events-auto -mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Chip tone={ROUTE_BADGE[lead.route]}>{ROUTE_LABELS[lead.route]}</Chip>
          {!isOpen && <Chip tone={STATUS_BADGE[lead.status]}>{STATUS_LABELS[lead.status]}</Chip>}
          {lead.sender_company && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <Building2 className="size-3 shrink-0" />
              <span className="truncate max-w-[16rem]">{lead.sender_company}</span>
            </span>
          )}
          {lead.location && (
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate max-w-[12rem]">{lead.location}</span>
            </span>
          )}
          {lead.estimated_value != null && (
            <span className="tnum">{formatValue(lead.estimated_value)}</span>
          )}
          {lead.attachments.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="size-3" />
              {lead.attachments.length}
            </span>
          )}
          {due && (
            <span className={`font-medium ${overdue ? 'text-red-600' : bidDueColor(lead.bid_due_date)}`}>
              {due}
            </span>
          )}
        </div>

        {lead.status === 'spam' && lead.spam_reason && (
          <p className="text-xs text-muted-foreground italic">Filtered: {lead.spam_reason}</p>
        )}
      </div>
    </div>
  )
}
