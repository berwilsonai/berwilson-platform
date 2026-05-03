'use client'

import { useState } from 'react'
import { MessageSquare, Plus, ChevronDown, ChevronRight, Square, CheckSquare } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import SourceTag from '@/components/shared/SourceTag'
import ConfidenceBadge from '@/components/shared/ConfidenceBadge'
import PasteInput from '@/components/shared/PasteInput'
import UpdateEditModal from '@/components/projects/UpdateEditModal'
import type { Update } from '@/lib/supabase/types'
import type {
  ActionItem,
  WaitingOnItem,
  RiskItem,
  DecisionItem,
} from '@/types/domain'

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600',
  watch: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  blocker: 'bg-red-200 text-red-800',
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function safeArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[]
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

function UpdateCard({ update, onSaved }: { update: Update; onSaved: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [actionItems, setActionItems] = useState<ActionItem[]>(
    safeArray<ActionItem>(update.action_items)
  )
  const [toggling, setToggling] = useState<number | null>(null)

  async function handleToggle(idx: number) {
    if (toggling !== null) return
    setToggling(idx)
    const newCompleted = !actionItems[idx].completed
    // Optimistic update
    setActionItems(prev =>
      prev.map((item, i) => i === idx ? { ...item, completed: newCompleted } : item)
    )
    try {
      const res = await fetch(`/api/updates/${update.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: idx, completed: newCompleted }),
      })
      if (!res.ok) {
        // Rollback on failure
        setActionItems(prev =>
          prev.map((item, i) => i === idx ? { ...item, completed: !newCompleted } : item)
        )
      }
    } catch {
      // Rollback
      setActionItems(prev =>
        prev.map((item, i) => i === idx ? { ...item, completed: !newCompleted } : item)
      )
    } finally {
      setToggling(null)
    }
  }

  const waitingOn = safeArray<WaitingOnItem>(update.waiting_on)
  const risks = safeArray<RiskItem>(update.risks)
  const decisions = safeArray<DecisionItem>(update.decisions)
  const hasExtracted = actionItems.length > 0 || waitingOn.length > 0 || risks.length > 0 || decisions.length > 0

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <SourceTag source={update.source} />
          <ConfidenceBadge confidence={update.confidence} />
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(update.created_at)}
          </span>
        </div>
        <UpdateEditModal updateId={update.id} onSaved={onSaved} />
      </div>

      {/* Summary */}
      {update.summary && (
        <div className="px-4 pb-3">
          <p className="text-sm text-foreground leading-relaxed">{update.summary}</p>
        </div>
      )}

      {/* Extracted Items */}
      {hasExtracted && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Action Items */}
          {actionItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Action Items
              </p>
              {actionItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <button
                    onClick={() => handleToggle(idx)}
                    disabled={toggling === idx}
                    className="shrink-0 mt-0.5 cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-40"
                    aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {item.completed ? (
                      <CheckSquare size={14} className="text-emerald-600" />
                    ) : (
                      <Square size={14} className="text-muted-foreground" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <span className={item.completed ? 'line-through text-muted-foreground' : ''}>
                      {item.text}
                    </span>
                    {(item.assignee || item.due_date) && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {item.assignee && `[${item.assignee}]`}
                        {item.due_date && ` due ${item.due_date}`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Waiting On */}
          {waitingOn.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Waiting On
              </p>
              {waitingOn.map((item, idx) => (
                <div key={idx} className="text-sm">
                  <span>{item.text}</span>
                  {item.party && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      [{item.party}]
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Risks */}
          {risks.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Risks
              </p>
              {risks.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <span
                    className={`shrink-0 mt-0.5 inline-flex rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS.info}`}
                  >
                    {item.severity}
                  </span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          )}

          {/* Decisions */}
          {decisions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Decisions
              </p>
              {decisions.map((item, idx) => (
                <div key={idx} className="text-sm">
                  <span>{item.text}</span>
                  {item.made_by && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      — {item.made_by}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expandable raw content */}
      <div className="border-t border-border px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Raw content
        </button>
        {expanded && (
          <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {update.raw_content}
          </pre>
        )}
      </div>
    </div>
  )
}

interface UpdatesTabProps {
  projectId: string
  initialUpdates: Update[]
}

export default function UpdatesTab({ projectId, initialUpdates }: UpdatesTabProps) {
  const [updates, setUpdates] = useState(initialUpdates)
  const [showPaste, setShowPaste] = useState(false)

  function handleSaved() {
    // Re-fetch updates from the page (simple approach: reload)
    window.location.reload()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Updates ({updates.length})
        </h2>
        <button
          onClick={() => setShowPaste(!showPaste)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus size={12} />
          Paste Update
        </button>
      </div>

      {/* Paste input area */}
      {showPaste && (
        <div className="rounded-lg border border-border bg-card p-4">
          <PasteInput projectId={projectId} onSaved={handleSaved} />
        </div>
      )}

      {/* Updates feed */}
      {updates.length === 0 && !showPaste ? (
        <EmptyState
          icon={MessageSquare}
          title="No updates yet"
          description="Paste an email, meeting notes, or project correspondence to extract intelligence."
          action={
            <button
              onClick={() => setShowPaste(true)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors"
            >
              <Plus size={14} />
              Paste First Update
            </button>
          }
        />
      ) : (
        <div className="space-y-4">
          {updates.map((update) => (
            <UpdateCard key={update.id} update={update} onSaved={handleSaved} />
          ))}
        </div>
      )}
    </div>
  )
}
