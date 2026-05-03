'use client'

import { useState, useEffect } from 'react'
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
const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600',
  watch: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  blocker: 'bg-red-200 text-red-800',
}

type Phase = 'loading' | 'editing' | 'saving' | 'error'

interface UpdateEditModalProps {
  updateId: string
  onSaved: () => void
}

export default function UpdateEditModal({ updateId, onSaved }: UpdateEditModalProps) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState('')
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [waitingOn, setWaitingOn] = useState<WaitingOnItem[]>([])
  const [risks, setRisks] = useState<RiskItem[]>([])
  const [decisions, setDecisions] = useState<DecisionItem[]>([])

  useEffect(() => {
    if (!open) return
    setPhase('loading')
    setError(null)

    fetch(`/api/updates/${updateId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load update')
        const data = await res.json()
        const u = data.update
        setSummary(u.summary ?? '')
        setActionItems(Array.isArray(u.action_items) ? u.action_items : [])
        setWaitingOn(Array.isArray(u.waiting_on) ? u.waiting_on : [])
        setRisks(Array.isArray(u.risks) ? u.risks : [])
        setDecisions(Array.isArray(u.decisions) ? u.decisions : [])
        setPhase('editing')
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Load failed')
        setPhase('error')
      })
  }, [open, updateId])

  async function handleSave() {
    setPhase('saving')
    setError(null)

    try {
      const res = await fetch(`/api/updates/${updateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary,
          action_items: actionItems,
          waiting_on: waitingOn,
          risks,
          decisions,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }

      setOpen(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setPhase('editing')
    }
  }

  // --- Inline editing helpers ---

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
        className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Pencil size={11} />
        Edit
      </button>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Update</DialogTitle>
          <DialogDescription>
            Modify the AI-extracted data. All fields are editable.
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
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors"
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
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors"
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
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors"
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
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
                    className="shrink-0 mt-1.5 p-1 text-muted-foreground hover:text-red-600 transition-colors"
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
                  Save Changes
                </>
              )}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
