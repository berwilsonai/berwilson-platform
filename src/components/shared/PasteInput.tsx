'use client'

import { useState } from 'react'
import { Loader2, Sparkles, Check, X, ChevronDown, ChevronRight } from 'lucide-react'
import ConfidenceBadge from './ConfidenceBadge'
import type { ExtractionResult, ActionItem, WaitingOnItem, RiskItem, DecisionItem } from '@/types/domain'

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-slate-100 text-slate-600',
  watch: 'bg-amber-100 text-amber-700',
  critical: 'bg-red-100 text-red-700',
  blocker: 'bg-red-200 text-red-800',
}

interface PasteInputProps {
  projectId: string
  onSaved?: () => void
}

type Phase = 'input' | 'loading' | 'review' | 'saving' | 'done'

export default function PasteInput({ projectId, onSaved }: PasteInputProps) {
  const [rawText, setRawText] = useState('')
  const [phase, setPhase] = useState<Phase>('input')
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  // Editable extracted fields
  const [summary, setSummary] = useState('')
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [waitingOn, setWaitingOn] = useState<WaitingOnItem[]>([])
  const [risks, setRisks] = useState<RiskItem[]>([])
  const [decisions, setDecisions] = useState<DecisionItem[]>([])

  async function handleExtract() {
    if (!rawText.trim()) return
    setError(null)
    setPhase('loading')

    try {
      const res = await fetch('/api/ai/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Extraction failed')
      }

      const data = await res.json()
      const ext: ExtractionResult = data.extraction

      setExtraction(ext)
      setSummary(ext.summary)
      setActionItems(ext.action_items ?? [])
      setWaitingOn(ext.waiting_on ?? [])
      setRisks(ext.risks ?? [])
      setDecisions(ext.decisions ?? [])
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed')
      setPhase('input')
    }
  }

  async function handleSave() {
    if (!extraction) return
    setPhase('saving')

    try {
      const res = await fetch('/api/updates/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          raw_content: rawText,
          summary,
          action_items: actionItems,
          waiting_on: waitingOn,
          risks,
          decisions,
          confidence: extraction.confidence,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Save failed')
      }

      setPhase('done')
      setRawText('')
      setExtraction(null)
      onSaved?.()

      // Reset after brief success message
      setTimeout(() => setPhase('input'), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setPhase('review')
    }
  }

  function handleCancel() {
    setPhase('input')
    setExtraction(null)
    setError(null)
  }

  function removeActionItem(idx: number) {
    setActionItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeWaitingOn(idx: number) {
    setWaitingOn((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeRisk(idx: number) {
    setRisks((prev) => prev.filter((_, i) => i !== idx))
  }

  function removeDecision(idx: number) {
    setDecisions((prev) => prev.filter((_, i) => i !== idx))
  }

  // -------------------------------------------------------------------------
  // INPUT PHASE
  // -------------------------------------------------------------------------
  if (phase === 'input' || phase === 'loading') {
    return (
      <div className="space-y-3">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Paste an email, meeting notes, or project update here..."
          rows={6}
          disabled={phase === 'loading'}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-y"
        />
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExtract}
            disabled={!rawText.trim() || phase === 'loading'}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {phase === 'loading' ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Sparkles size={14} />
                Extract with AI
              </>
            )}
          </button>
          <span className="text-xs text-muted-foreground">
            {rawText.length.toLocaleString()} chars
          </span>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // DONE PHASE
  // -------------------------------------------------------------------------
  if (phase === 'done') {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-emerald-700">
        <Check size={16} />
        Update saved successfully.
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // REVIEW PHASE (also handles saving state)
  // -------------------------------------------------------------------------
  const isSaving = phase === 'saving'

  return (
    <div className="space-y-5">
      {/* Header with confidence + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Review Extraction</h3>
          <ConfidenceBadge confidence={extraction?.confidence ?? null} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <X size={12} />
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Check size={12} />
            )}
            Save Update
          </button>
        </div>
      </div>

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
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      </div>

      {/* Action Items */}
      {actionItems.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Action Items ({actionItems.length})
          </label>
          <div className="space-y-1.5">
            {actionItems.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md border border-input px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p>{item.text}</p>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    {item.assignee && <span>Assignee: {item.assignee}</span>}
                    {item.due_date && <span>Due: {item.due_date}</span>}
                  </div>
                </div>
                <button
                  onClick={() => removeActionItem(idx)}
                  className="shrink-0 p-0.5 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting On */}
      {waitingOn.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Waiting On ({waitingOn.length})
          </label>
          <div className="space-y-1.5">
            {waitingOn.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md border border-input px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p>{item.text}</p>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    {item.party && <span>Party: {item.party}</span>}
                    {item.since && <span>Since: {item.since}</span>}
                  </div>
                </div>
                <button
                  onClick={() => removeWaitingOn(idx)}
                  className="shrink-0 p-0.5 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {risks.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Risks ({risks.length})
          </label>
          <div className="space-y-1.5">
            {risks.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md border border-input px-3 py-2 text-sm">
                <span
                  className={`shrink-0 mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_COLORS[item.severity] ?? SEVERITY_COLORS.info}`}
                >
                  {item.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <p>{item.text}</p>
                  {item.mitigation && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Mitigation: {item.mitigation}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => removeRisk(idx)}
                  className="shrink-0 p-0.5 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decisions */}
      {decisions.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Decisions ({decisions.length})
          </label>
          <div className="space-y-1.5">
            {decisions.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded-md border border-input px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <p>{item.text}</p>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    {item.made_by && <span>By: {item.made_by}</span>}
                    {item.date && <span>Date: {item.date}</span>}
                  </div>
                </div>
                <button
                  onClick={() => removeDecision(idx)}
                  className="shrink-0 p-0.5 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible raw text */}
      <div>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Raw text
        </button>
        {showRaw && (
          <pre className="mt-2 rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {rawText}
          </pre>
        )}
      </div>
    </div>
  )
}
