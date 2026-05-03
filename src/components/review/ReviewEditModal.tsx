'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, X, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type {
  ActionItem,
  WaitingOnItem,
  RiskItem,
  DecisionItem,
} from '@/types/domain'

const SEVERITY_OPTIONS = ['info', 'watch', 'critical', 'blocker'] as const

interface ReviewEditModalProps {
  reviewId: string
  recordId: string
  sourceTable: string
  onResolved: () => void
}

type Phase = 'loading' | 'editing' | 'saving' | 'error'

export default function ReviewEditModal({
  reviewId,
  recordId,
  sourceTable,
  onResolved,
}: ReviewEditModalProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState('')
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [waitingOn, setWaitingOn] = useState<WaitingOnItem[]>([])
  const [risks, setRisks] = useState<RiskItem[]>([])
  const [decisions, setDecisions] = useState<DecisionItem[]>([])

  // Store the original AI output for diff comparison
  const originalRef = useRef<{
    summary: string
    action_items: ActionItem[]
    waiting_on: WaitingOnItem[]
    risks: RiskItem[]
    decisions: DecisionItem[]
  } | null>(null)

  useEffect(() => {
    if (!open) return
    if (sourceTable !== 'updates') {
      setPhase('error')
      setError('Inline editing is only supported for updates. Use the source link to edit this record.')
      return
    }

    setPhase('loading')
    setError(null)

    fetch(`/api/updates/${recordId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load record')
        const data = await res.json()
        const u = data.update
        const ai_summary = u.summary ?? ''
        const ai_action_items = Array.isArray(u.action_items) ? u.action_items : []
        const ai_waiting_on = Array.isArray(u.waiting_on) ? u.waiting_on : []
        const ai_risks = Array.isArray(u.risks) ? u.risks : []
        const ai_decisions = Array.isArray(u.decisions) ? u.decisions : []
        setSummary(ai_summary)
        setActionItems(ai_action_items)
        setWaitingOn(ai_waiting_on)
        setRisks(ai_risks)
        setDecisions(ai_decisions)
        originalRef.current = {
          summary: ai_summary,
          action_items: ai_action_items,
          waiting_on: ai_waiting_on,
          risks: ai_risks,
          decisions: ai_decisions,
        }
        setPhase('editing')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Load failed')
        setPhase('error')
      })
  }, [open, recordId, sourceTable])

  async function handleSave() {
    setPhase('saving')
    setError(null)

    try {
      const updateRes = await fetch(`/api/updates/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, action_items: actionItems, waiting_on: waitingOn, risks, decisions }),
      })

      if (!updateRes.ok) {
        const data = await updateRes.json()
        throw new Error(data.error ?? 'Save failed')
      }

      // Build edit diff to track what the AI got wrong
      const orig = originalRef.current
      const editDiff: Record<string, unknown> = {}
      if (orig) {
        if (summary !== orig.summary) {
          editDiff.summary = { ai: orig.summary, human: summary }
        }
        const aiCount = (arr: unknown[]) => arr.length
        if (JSON.stringify(actionItems) !== JSON.stringify(orig.action_items)) {
          editDiff.action_items = { ai_count: aiCount(orig.action_items), human_count: aiCount(actionItems), changed: true }
        }
        if (JSON.stringify(waitingOn) !== JSON.stringify(orig.waiting_on)) {
          editDiff.waiting_on = { ai_count: aiCount(orig.waiting_on), human_count: aiCount(waitingOn), changed: true }
        }
        if (JSON.stringify(risks) !== JSON.stringify(orig.risks)) {
          editDiff.risks = { ai_count: aiCount(orig.risks), human_count: aiCount(risks), changed: true }
        }
        if (JSON.stringify(decisions) !== JSON.stringify(orig.decisions)) {
          editDiff.decisions = { ai_count: aiCount(orig.decisions), human_count: aiCount(decisions), changed: true }
        }
      }

      const reviewRes = await fetch(`/api/review/${reviewId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution: 'edited',
          ...(Object.keys(editDiff).length > 0 ? { edit_diff: editDiff } : {}),
        }),
      })

      if (!reviewRes.ok) {
        const data = await reviewRes.json()
        throw new Error(data.error ?? 'Failed to resolve review item')
      }

      setOpen(false)
      onResolved()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setPhase('editing')
    }
  }

  function updateActionItem(idx: number, field: keyof ActionItem, value: string | boolean) {
    setActionItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }
  function updateWaitingItem(idx: number, field: keyof WaitingOnItem, value: string) {
    setWaitingOn((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }
  function updateRiskItem(idx: number, field: keyof RiskItem, value: string) {
    setRisks((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }
  function updateDecisionItem(idx: number, field: keyof DecisionItem, value: string) {
    setDecisions((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  const inputClass = 'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Pencil size={13} />
        Edit
      </button>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Extracted Data</DialogTitle>
          <DialogDescription>
            Review and correct the AI-extracted information before approving.
          </DialogDescription>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {phase === 'error' && !summary && (
          <div className="py-8 text-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {(phase === 'editing' || phase === 'saving') && (
          <div className="space-y-5">
            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Summary */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Summary
              </label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                disabled={phase === 'saving'}
                className={`${inputClass} resize-y`}
              />
            </div>

            {/* Action Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Action Items ({actionItems.length})
                </label>
                <button
                  onClick={() => setActionItems((prev) => [...prev, { text: '' }])}
                  disabled={phase === 'saving'}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              {actionItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      value={item.text}
                      onChange={(e) => updateActionItem(idx, 'text', e.target.value)}
                      placeholder="Action item..."
                      disabled={phase === 'saving'}
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <input
                        value={item.assignee ?? ''}
                        onChange={(e) => updateActionItem(idx, 'assignee', e.target.value)}
                        placeholder="Assignee"
                        disabled={phase === 'saving'}
                        className={`${inputClass} w-1/2`}
                      />
                      <input
                        value={item.due_date ?? ''}
                        onChange={(e) => updateActionItem(idx, 'due_date', e.target.value)}
                        placeholder="Due date (YYYY-MM-DD)"
                        disabled={phase === 'saving'}
                        className={`${inputClass} w-1/2`}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => setActionItems((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={phase === 'saving'}
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Waiting On */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Waiting On ({waitingOn.length})
                </label>
                <button
                  onClick={() => setWaitingOn((prev) => [...prev, { text: '' }])}
                  disabled={phase === 'saving'}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              {waitingOn.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      value={item.text}
                      onChange={(e) => updateWaitingItem(idx, 'text', e.target.value)}
                      placeholder="What are we waiting for..."
                      disabled={phase === 'saving'}
                      className={inputClass}
                    />
                    <input
                      value={item.party ?? ''}
                      onChange={(e) => updateWaitingItem(idx, 'party', e.target.value)}
                      placeholder="Party responsible"
                      disabled={phase === 'saving'}
                      className={inputClass}
                    />
                  </div>
                  <button
                    onClick={() => setWaitingOn((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={phase === 'saving'}
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Risks */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Risks ({risks.length})
                </label>
                <button
                  onClick={() => setRisks((prev) => [...prev, { text: '', severity: 'info' as const }])}
                  disabled={phase === 'saving'}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              {risks.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      value={item.text}
                      onChange={(e) => updateRiskItem(idx, 'text', e.target.value)}
                      placeholder="Risk description..."
                      disabled={phase === 'saving'}
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <select
                        value={item.severity}
                        onChange={(e) => updateRiskItem(idx, 'severity', e.target.value)}
                        disabled={phase === 'saving'}
                        className={`${inputClass} w-1/3`}
                      >
                        {SEVERITY_OPTIONS.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                      <input
                        value={item.mitigation ?? ''}
                        onChange={(e) => updateRiskItem(idx, 'mitigation', e.target.value)}
                        placeholder="Mitigation (optional)"
                        disabled={phase === 'saving'}
                        className={`${inputClass} w-2/3`}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => setRisks((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={phase === 'saving'}
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {/* Decisions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Decisions ({decisions.length})
                </label>
                <button
                  onClick={() => setDecisions((prev) => [...prev, { text: '' }])}
                  disabled={phase === 'saving'}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Plus size={12} /> Add
                </button>
              </div>
              {decisions.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <input
                      value={item.text}
                      onChange={(e) => updateDecisionItem(idx, 'text', e.target.value)}
                      placeholder="Decision made..."
                      disabled={phase === 'saving'}
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <input
                        value={item.made_by ?? ''}
                        onChange={(e) => updateDecisionItem(idx, 'made_by', e.target.value)}
                        placeholder="Decided by"
                        disabled={phase === 'saving'}
                        className={`${inputClass} w-1/2`}
                      />
                      <input
                        value={item.date ?? ''}
                        onChange={(e) => updateDecisionItem(idx, 'date', e.target.value)}
                        placeholder="Date (YYYY-MM-DD)"
                        disabled={phase === 'saving'}
                        className={`${inputClass} w-1/2`}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => setDecisions((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={phase === 'saving'}
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {(phase === 'editing' || phase === 'saving') && (
          <DialogFooter>
            <button
              onClick={() => setOpen(false)}
              disabled={phase === 'saving'}
              className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={phase === 'saving'}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
            >
              {phase === 'saving' ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Save & Approve
                </>
              )}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
