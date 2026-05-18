'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Plus, Shield, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FEDERAL_STANDARD_LABELS,
  FEDERAL_STANDARD_BADGE,
  USACE_QM_CRITERIA,
  DOD_385_CRITERIA,
  SCORECARD_RATING_LABELS,
  SCORECARD_RATING_COLORS,
  type FederalStandard,
} from '@/lib/utils/constants'

interface FederalScorecard {
  id: string
  entity_id: string
  project_id: string | null
  standard: FederalStandard
  overall_rating: number | null
  evaluation_period_start: string | null
  evaluation_period_end: string | null
  evaluator_name: string | null
  evaluator_title: string | null
  // USACE QM
  qm_qc_plan: number | null
  qm_three_phase_inspection: number | null
  qm_testing_compliance: number | null
  qm_deficiency_tracking: number | null
  qm_documentation: number | null
  qm_rework_rate: number | null
  qm_material_compliance: number | null
  qm_submittal_timeliness: number | null
  qm_notes: string | null
  // DoD 385
  sh_accident_prevention_plan: number | null
  sh_activity_hazard_analysis: number | null
  sh_safety_training: number | null
  sh_ppe_compliance: number | null
  sh_incident_rate: number | null
  sh_site_inspections: number | null
  sh_osha_compliance: number | null
  sh_corrective_actions: number | null
  sh_notes: string | null
  // Metrics
  dart_rate: number | null
  trir: number | null
  emr: number | null
  rework_pct: number | null
  punch_list_items: number | null
  ncrs_issued: number | null
  ncrs_resolved: number | null
  // Meta
  created_at: string | null
  projects: { id: string; name: string } | null
}

interface FederalScorecardSectionProps {
  entityId: string
  entityCategory: string
  initialScorecards: FederalScorecard[]
  allProjects: Array<{ id: string; name: string }>
}

function RatingBadge({ rating }: { rating: number | null }) {
  if (rating === null || rating === undefined) return <span className="text-xs text-muted-foreground">—</span>
  const r = Math.round(rating)
  return (
    <span className={cn('text-xs font-semibold', SCORECARD_RATING_COLORS[r] ?? 'text-slate-500')}>
      {rating.toFixed(1)} — {SCORECARD_RATING_LABELS[r] ?? 'N/A'}
    </span>
  )
}

function RatingBar({ rating }: { rating: number | null }) {
  if (rating === null) return null
  const pct = (rating / 5) * 100
  const color = rating >= 4 ? 'bg-green-500' : rating >= 3 ? 'bg-amber-500' : rating >= 2 ? 'bg-orange-500' : 'bg-red-500'
  return (
    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function ScorecardCard({
  scorecard,
  onDelete,
}: {
  scorecard: FederalScorecard
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const criteria = scorecard.standard === 'usace_qm' ? USACE_QM_CRITERIA : DOD_385_CRITERIA
  const notes = scorecard.standard === 'usace_qm' ? scorecard.qm_notes : scorecard.sh_notes

  // Calculate average of scored criteria
  const scores = criteria.map(c => (scorecard as any)[c.key] as number | null).filter((v): v is number => v !== null)
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className={cn(
            'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
            FEDERAL_STANDARD_BADGE[scorecard.standard]
          )}>
            {FEDERAL_STANDARD_LABELS[scorecard.standard]}
          </span>
          {scorecard.projects && (
            <Link
              href={`/projects/${scorecard.projects.id}`}
              className="text-xs text-primary hover:underline truncate"
              onClick={e => e.stopPropagation()}
            >
              {scorecard.projects.name}
            </Link>
          )}
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <RatingBadge rating={scorecard.overall_rating ?? avgScore} />
          <button
            onClick={() => onDelete(scorecard.id)}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Delete scorecard"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Evaluator info */}
          {(scorecard.evaluator_name || scorecard.evaluation_period_start) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {scorecard.evaluator_name && (
                <span>Evaluator: <span className="text-foreground">{scorecard.evaluator_name}</span>{scorecard.evaluator_title ? `, ${scorecard.evaluator_title}` : ''}</span>
              )}
              {scorecard.evaluation_period_start && (
                <span>Period: {scorecard.evaluation_period_start}{scorecard.evaluation_period_end ? ` — ${scorecard.evaluation_period_end}` : ''}</span>
              )}
            </div>
          )}

          {/* Criteria grid */}
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-1.5 font-medium">Criterion</th>
                  <th className="text-right px-3 py-1.5 font-medium w-20">Score</th>
                  <th className="px-3 py-1.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {criteria.map(c => {
                  const val = (scorecard as any)[c.key] as number | null
                  return (
                    <tr key={c.key} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-1.5" title={c.description}>
                        {c.label}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <RatingBadge rating={val} />
                      </td>
                      <td className="px-3 py-1.5">
                        <RatingBar rating={val} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {avgScore !== null && (
                <tfoot>
                  <tr className="bg-muted/30 border-t border-border">
                    <td className="px-3 py-1.5 font-semibold">Average</td>
                    <td className="px-3 py-1.5 text-right">
                      <RatingBadge rating={avgScore} />
                    </td>
                    <td className="px-3 py-1.5">
                      <RatingBar rating={avgScore} />
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Safety metrics */}
          {scorecard.standard === 'dod_385' && (scorecard.dart_rate || scorecard.trir || scorecard.emr) && (
            <div className="flex gap-4 text-xs">
              {scorecard.dart_rate !== null && (
                <div>
                  <span className="text-muted-foreground">DART: </span>
                  <span className="font-semibold">{scorecard.dart_rate}</span>
                </div>
              )}
              {scorecard.trir !== null && (
                <div>
                  <span className="text-muted-foreground">TRIR: </span>
                  <span className="font-semibold">{scorecard.trir}</span>
                </div>
              )}
              {scorecard.emr !== null && (
                <div>
                  <span className="text-muted-foreground">EMR: </span>
                  <span className="font-semibold">{scorecard.emr}</span>
                </div>
              )}
            </div>
          )}

          {/* QM metrics */}
          {scorecard.standard === 'usace_qm' && (scorecard.rework_pct !== null || scorecard.ncrs_issued !== null) && (
            <div className="flex gap-4 text-xs">
              {scorecard.rework_pct !== null && (
                <div>
                  <span className="text-muted-foreground">Rework: </span>
                  <span className="font-semibold">{scorecard.rework_pct}%</span>
                </div>
              )}
              {scorecard.punch_list_items !== null && (
                <div>
                  <span className="text-muted-foreground">Punch List: </span>
                  <span className="font-semibold">{scorecard.punch_list_items}</span>
                </div>
              )}
              {scorecard.ncrs_issued !== null && (
                <div>
                  <span className="text-muted-foreground">NCRs: </span>
                  <span className="font-semibold">{scorecard.ncrs_resolved ?? 0}/{scorecard.ncrs_issued} resolved</span>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {notes && (
            <p className="text-xs text-muted-foreground italic">{notes}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Scorecard Form ──────────────────────────────────────────────────────────

function ScorecardForm({
  entityId,
  projects,
  onSaved,
  onCancel,
}: {
  entityId: string
  projects: Array<{ id: string; name: string }>
  onSaved: (sc: FederalScorecard) => void
  onCancel: () => void
}) {
  const [standard, setStandard] = useState<FederalStandard>('usace_qm')
  const [projectId, setProjectId] = useState('')
  const [evaluatorName, setEvaluatorName] = useState('')
  const [evaluatorTitle, setEvaluatorTitle] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [scores, setScores] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  // Safety metrics
  const [dartRate, setDartRate] = useState('')
  const [trir, setTrir] = useState('')
  const [emr, setEmr] = useState('')
  // QM metrics
  const [reworkPct, setReworkPct] = useState('')
  const [punchListItems, setPunchListItems] = useState('')
  const [ncrsIssued, setNcrsIssued] = useState('')
  const [ncrsResolved, setNcrsResolved] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const criteria = standard === 'usace_qm' ? USACE_QM_CRITERIA : DOD_385_CRITERIA

  const setScore = (key: string, val: string) => {
    setScores(prev => ({ ...prev, [key]: val }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    const payload: Record<string, unknown> = {
      standard,
      project_id: projectId || null,
      evaluator_name: evaluatorName.trim() || null,
      evaluator_title: evaluatorTitle.trim() || null,
      evaluation_period_start: periodStart || null,
      evaluation_period_end: periodEnd || null,
    }

    // Add criteria scores
    criteria.forEach(c => {
      const val = scores[c.key]
      payload[c.key] = val ? Number(val) : null
    })

    // Add notes
    if (standard === 'usace_qm') {
      payload.qm_notes = notes.trim() || null
      payload.rework_pct = reworkPct ? Number(reworkPct) : null
      payload.punch_list_items = punchListItems ? Number(punchListItems) : null
      payload.ncrs_issued = ncrsIssued ? Number(ncrsIssued) : null
      payload.ncrs_resolved = ncrsResolved ? Number(ncrsResolved) : null
    } else {
      payload.sh_notes = notes.trim() || null
      payload.dart_rate = dartRate ? Number(dartRate) : null
      payload.trir = trir ? Number(trir) : null
      payload.emr = emr ? Number(emr) : null
    }

    // Calculate overall from scored criteria
    const scoredVals = criteria
      .map(c => scores[c.key])
      .filter(Boolean)
      .map(Number)
    if (scoredVals.length > 0) {
      payload.overall_rating = Number((scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length).toFixed(1))
    }

    const res = await fetch(`/api/entities/${entityId}/scorecards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to save scorecard')
      setSaving(false)
      return
    }

    const data = await res.json()
    onSaved(data.scorecard)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 mb-4 space-y-4 bg-muted/30">
      <h3 className="text-xs font-semibold">New Federal Scorecard</h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Standard *</label>
          <select
            value={standard}
            onChange={e => setStandard(e.target.value as FederalStandard)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="usace_qm">USACE Quality Management</option>
            <option value="dod_385">DoD 385-1-1 Safety & Health</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Project (optional)</label>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Company-wide —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Evaluator Name</label>
          <input
            type="text"
            value={evaluatorName}
            onChange={e => setEvaluatorName(e.target.value)}
            placeholder="Your name"
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Evaluator Title</label>
          <input
            type="text"
            value={evaluatorTitle}
            onChange={e => setEvaluatorTitle(e.target.value)}
            placeholder="Project Manager"
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Evaluation Period Start</label>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Evaluation Period End</label>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
      </div>

      {/* Criteria scoring */}
      <div>
        <label className="text-xs text-muted-foreground block mb-2">
          Score each criterion (0 = Not Evaluated, 1 = Unsatisfactory, 5 = Exceptional)
        </label>
        <div className="space-y-2">
          {criteria.map(c => (
            <div key={c.key} className="flex items-center gap-3">
              <span className="text-xs w-44 shrink-0" title={c.description}>{c.label}</span>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3, 4, 5].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setScore(c.key, String(r))}
                    className={cn(
                      'w-7 h-7 rounded text-xs font-medium transition-colors',
                      scores[c.key] === String(r)
                        ? r === 0 ? 'bg-slate-200 text-slate-700 ring-1 ring-slate-400'
                          : r <= 2 ? 'bg-red-100 text-red-700 ring-1 ring-red-400'
                          : r === 3 ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-400'
                          : 'bg-green-100 text-green-700 ring-1 ring-green-400'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Standard-specific metrics */}
      {standard === 'dod_385' && (
        <div>
          <label className="text-xs text-muted-foreground block mb-2">Safety Metrics (raw numbers)</label>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">DART Rate</label>
              <input type="number" step="0.01" value={dartRate} onChange={e => setDartRate(e.target.value)} placeholder="0.00" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">TRIR</label>
              <input type="number" step="0.01" value={trir} onChange={e => setTrir(e.target.value)} placeholder="0.00" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">EMR</label>
              <input type="number" step="0.01" value={emr} onChange={e => setEmr(e.target.value)} placeholder="1.00" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
        </div>
      )}

      {standard === 'usace_qm' && (
        <div>
          <label className="text-xs text-muted-foreground block mb-2">Quality Metrics</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Rework %</label>
              <input type="number" step="0.01" value={reworkPct} onChange={e => setReworkPct(e.target.value)} placeholder="0" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Punch List Items</label>
              <input type="number" value={punchListItems} onChange={e => setPunchListItems(e.target.value)} placeholder="0" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">NCRs Issued</label>
              <input type="number" value={ncrsIssued} onChange={e => setNcrsIssued(e.target.value)} placeholder="0" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">NCRs Resolved</label>
              <input type="number" value={ncrsResolved} onChange={e => setNcrsResolved(e.target.value)} placeholder="0" className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          placeholder="Additional evaluation notes..."
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Scorecard'}
        </button>
      </div>
    </form>
  )
}

// ─── Main Section ────────────────────────────────────────────────────────────

export default function FederalScorecardSection({
  entityId,
  entityCategory,
  initialScorecards,
  allProjects,
}: FederalScorecardSectionProps) {
  const [scorecards, setScorecards] = useState(initialScorecards)
  const [showForm, setShowForm] = useState(false)

  // Only show scorecards for vendors and contractors
  if (entityCategory === 'partner') return null

  const handleSaved = (sc: FederalScorecard) => {
    setScorecards(prev => [sc, ...prev])
    setShowForm(false)
  }

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/entities/${entityId}/scorecards/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setScorecards(prev => prev.filter(s => s.id !== id))
    }
  }

  const usaceCards = scorecards.filter(s => s.standard === 'usace_qm')
  const dodCards = scorecards.filter(s => s.standard === 'dod_385')

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold inline-flex items-center gap-1.5">
          <Shield size={14} className="text-blue-600" />
          Federal Scorecards ({scorecards.length})
        </h2>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={12} />
          Add Scorecard
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Scored against USACE Quality Management (ER 1180-1-6) and DoD 385-1-1 Safety & Health standards. Scale: 0 (Not Evaluated) to 5 (Exceptional).
      </p>

      {showForm && (
        <ScorecardForm
          entityId={entityId}
          projects={allProjects}
          onSaved={handleSaved}
          onCancel={() => setShowForm(false)}
        />
      )}

      {scorecards.length === 0 ? (
        <p className="text-xs text-muted-foreground">No federal scorecards yet. Add one to evaluate this {entityCategory} against federal standards.</p>
      ) : (
        <div className="space-y-4">
          {usaceCards.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">USACE Quality Management</h3>
              <div className="space-y-2">
                {usaceCards.map(sc => (
                  <ScorecardCard key={sc.id} scorecard={sc} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
          {dodCards.length > 0 && (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">DoD 385-1-1 Safety & Health</h3>
              <div className="space-y-2">
                {dodCards.map(sc => (
                  <ScorecardCard key={sc.id} scorecard={sc} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
