'use client'

import { Fragment, useState } from 'react'
import { Check, Plus, Calendar, ArrowRight, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STAGES, STAGE_LABELS, STAGE_INDEX } from '@/lib/utils/stages'
import type { Milestone, ProjectStage } from '@/lib/supabase/types'

function formatDate(d: string | null): string {
  if (!d) return ''
  // Parse as local date to avoid timezone shift
  const [year, month, day] = d.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface MilestonesTabProps {
  projectId: string
  initialMilestones: Milestone[]
  initialStage: ProjectStage
}

export default function MilestonesTab({
  projectId,
  initialMilestones,
  initialStage,
}: MilestonesTabProps) {
  const [milestones, setMilestones] = useState(initialMilestones)
  const [currentStage, setCurrentStage] = useState(initialStage)
  const [addingToStage, setAddingToStage] = useState<ProjectStage | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newTargetDate, setNewTargetDate] = useState('')
  const [savingAdd, setSavingAdd] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [advanceConfirm, setAdvanceConfirm] = useState(false)
  const [advancingSaving, setAdvancingSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentIndex = STAGE_INDEX[currentStage]
  const nextStage = STAGES[currentIndex + 1] as ProjectStage | undefined

  const byStage = Object.fromEntries(
    STAGES.map((s) => [s, milestones.filter((m) => m.stage === s)])
  ) as Record<ProjectStage, Milestone[]>

  const currentStageMilestones = byStage[currentStage]
  const allCurrentComplete =
    currentStageMilestones.length > 0 &&
    currentStageMilestones.every((m) => m.completed_at !== null)

  function openAddForm(stage: ProjectStage) {
    setAddingToStage(stage)
    setNewLabel('')
    setNewTargetDate('')
    setError(null)
  }

  function cancelAdd() {
    setAddingToStage(null)
    setNewLabel('')
    setNewTargetDate('')
  }

  async function toggleMilestone(milestone: Milestone) {
    if (togglingId) return
    setTogglingId(milestone.id)
    setError(null)
    const nowComplete = !milestone.completed_at

    // Optimistic update
    setMilestones((prev) =>
      prev.map((m) =>
        m.id === milestone.id
          ? { ...m, completed_at: nowComplete ? new Date().toISOString() : null }
          : m
      )
    )

    try {
      const res = await fetch(`/api/milestones/${milestone.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: nowComplete }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to update milestone')
      }
      const { milestone: updated } = await res.json()
      setMilestones((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
    } catch (err) {
      // Revert
      setMilestones((prev) =>
        prev.map((m) =>
          m.id === milestone.id ? { ...m, completed_at: milestone.completed_at } : m
        )
      )
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setTogglingId(null)
    }
  }

  async function addMilestone(stage: ProjectStage) {
    if (!newLabel.trim() || savingAdd) return
    setSavingAdd(true)
    setError(null)

    try {
      const res = await fetch('/api/milestones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          stage,
          label: newLabel.trim(),
          target_date: newTargetDate || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to add milestone')
      }
      const { milestone } = await res.json()
      setMilestones((prev) => [...prev, milestone])
      setNewLabel('')
      setNewTargetDate('')
      setAddingToStage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add')
    } finally {
      setSavingAdd(false)
    }
  }

  async function advanceStage() {
    if (!nextStage || advancingSaving) return
    setAdvancingSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/projects/${projectId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: nextStage }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to advance stage')
      }
      setCurrentStage(nextStage)
      setAdvanceConfirm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance stage')
    } finally {
      setAdvancingSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Pipeline progress bar ── */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-center min-w-max">
          {STAGES.map((stage, idx) => {
            const isPast = STAGE_INDEX[stage] < currentIndex
            const isCurrent = stage === currentStage

            return (
              <Fragment key={stage}>
                <div
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap',
                    isPast && 'bg-emerald-100 text-emerald-700',
                    isCurrent && 'bg-emerald-600 text-white',
                    !isPast && !isCurrent && 'bg-muted text-muted-foreground'
                  )}
                >
                  {isPast && <Check size={11} className="shrink-0" />}
                  {isCurrent && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-white/70" />
                  )}
                  {STAGE_LABELS[stage]}
                </div>
                {idx < STAGES.length - 1 && (
                  <div
                    className={cn(
                      'w-6 h-px shrink-0',
                      STAGE_INDEX[stage] < currentIndex ? 'bg-emerald-300' : 'bg-border'
                    )}
                  />
                )}
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* ── Advance stage suggestion ── */}
      {allCurrentComplete && nextStage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-emerald-800 min-w-0">
            <Check size={15} className="text-emerald-600 shrink-0" />
            <span>
              All milestones in <strong>{STAGE_LABELS[currentStage]}</strong> are
              complete. Ready to advance to{' '}
              <strong>{STAGE_LABELS[nextStage]}</strong>?
            </span>
          </div>
          {!advanceConfirm ? (
            <button
              onClick={() => setAdvanceConfirm(true)}
              className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition-colors"
            >
              Advance Stage
              <ArrowRight size={12} />
            </button>
          ) : (
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <span className="text-xs text-emerald-700 font-medium">
                Confirm advance to {STAGE_LABELS[nextStage]}?
              </span>
              <button
                onClick={advanceStage}
                disabled={advancingSaving}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {advancingSaving ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
                Yes, Advance
              </button>
              <button
                onClick={() => setAdvanceConfirm(false)}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ── Stage columns ── */}
      <div className="overflow-x-auto -mx-1 px-1 pb-3">
        <div className="flex gap-3 min-w-max">
          {STAGES.map((stage) => {
            const stageMilestones = byStage[stage]
            const completed = stageMilestones.filter((m) => m.completed_at).length
            const total = stageMilestones.length
            const isPast = STAGE_INDEX[stage] < currentIndex
            const isCurrent = stage === currentStage
            const isFuture = STAGE_INDEX[stage] > currentIndex
            const isAdding = addingToStage === stage

            return (
              <div
                key={stage}
                className={cn(
                  'w-56 rounded-lg border flex flex-col',
                  isCurrent && 'border-emerald-300 ring-1 ring-emerald-200 shadow-sm',
                  (isPast || isFuture) && 'border-border'
                )}
              >
                {/* Stage header */}
                <div
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-t-lg border-b',
                    isCurrent && 'bg-emerald-50 border-emerald-200',
                    isPast && 'bg-slate-50 border-border',
                    isFuture && 'bg-muted border-border'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0',
                        isCurrent && 'bg-emerald-600 text-white',
                        isPast && 'bg-emerald-100 text-emerald-700',
                        isFuture && 'bg-muted-foreground/20 text-muted-foreground'
                      )}
                    >
                      {STAGE_INDEX[stage] + 1}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-semibold truncate',
                        isCurrent && 'text-emerald-800',
                        isPast && 'text-slate-600',
                        isFuture && 'text-muted-foreground'
                      )}
                    >
                      {STAGE_LABELS[stage]}
                    </span>
                  </div>
                  {total > 0 && (
                    <span
                      className={cn(
                        'text-[11px] shrink-0 tabular-nums',
                        completed === total
                          ? 'text-emerald-600 font-semibold'
                          : 'text-muted-foreground'
                      )}
                    >
                      {completed}/{total}
                    </span>
                  )}
                </div>

                {/* Milestones list */}
                <div className="flex-1 p-2 space-y-0.5 min-h-[72px]">
                  {stageMilestones.length === 0 && !isAdding && (
                    <p className="text-[11px] text-muted-foreground/60 italic px-1 pt-1">
                      No milestones
                    </p>
                  )}

                  {stageMilestones.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleMilestone(m)}
                      disabled={togglingId !== null}
                      className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors group disabled:cursor-default"
                    >
                      {/* Checkbox */}
                      <div
                        className={cn(
                          'shrink-0 mt-0.5 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors',
                          m.completed_at
                            ? 'bg-emerald-600 border-emerald-600'
                            : 'border-input group-hover:border-emerald-400'
                        )}
                      >
                        {togglingId === m.id ? (
                          <Loader2 size={8} className="animate-spin text-white" />
                        ) : m.completed_at ? (
                          <Check size={9} className="text-white" />
                        ) : null}
                      </div>

                      {/* Label + date */}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            'text-xs leading-snug break-words',
                            m.completed_at
                              ? 'line-through text-muted-foreground'
                              : 'text-foreground'
                          )}
                        >
                          {m.label}
                        </p>
                        {m.target_date && (
                          <p className="flex items-center gap-0.5 mt-0.5 text-[10px] text-muted-foreground">
                            <Calendar size={9} />
                            {formatDate(m.target_date)}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}

                  {/* Inline add form */}
                  {isAdding && (
                    <div className="rounded-md border border-input bg-background p-2 space-y-1.5 mt-1">
                      <input
                        autoFocus
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addMilestone(stage)
                          if (e.key === 'Escape') cancelAdd()
                        }}
                        placeholder="Milestone label"
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <input
                        type="date"
                        value={newTargetDate}
                        onChange={(e) => setNewTargetDate(e.target.value)}
                        className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => addMilestone(stage)}
                          disabled={!newLabel.trim() || savingAdd}
                          className="flex-1 inline-flex items-center justify-center gap-1 h-6 rounded bg-foreground text-background text-[11px] font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                        >
                          {savingAdd ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Check size={10} />
                          )}
                          Save
                        </button>
                        <button
                          onClick={cancelAdd}
                          className="h-6 w-6 inline-flex items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer: add button */}
                {!isAdding && (
                  <div className="px-2 pb-2">
                    <button
                      onClick={() => openAddForm(stage)}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      <Plus size={11} />
                      Add milestone
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
