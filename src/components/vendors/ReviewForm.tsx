'use client'

import { useState } from 'react'
import { Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ReviewFormProps {
  entityId: string
  projects: Array<{ id: string; name: string }>
  onSaved: (review: any) => void
  onCancel: () => void
}

export default function ReviewForm({ entityId, projects, onSaved, onCancel }: ReviewFormProps) {
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [projectId, setProjectId] = useState('')
  const [onTime, setOnTime] = useState<boolean | null>(null)
  const [onBudget, setOnBudget] = useState<boolean | null>(null)
  const [wouldRehire, setWouldRehire] = useState<boolean | null>(null)
  const [notes, setNotes] = useState('')
  const [reviewedBy, setReviewedBy] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0) {
      setError('Please select a rating')
      return
    }

    setSaving(true)
    setError('')

    const res = await fetch(`/api/entities/${entityId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId || null,
        rating,
        on_time: onTime,
        on_budget: onBudget,
        would_rehire: wouldRehire,
        notes: notes.trim() || null,
        reviewed_by: reviewedBy.trim() || null,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to save review')
      setSaving(false)
      return
    }

    const data = await res.json()
    onSaved(data.review)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 mb-4 space-y-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">New Review</h3>
        <button type="button" onClick={onCancel} className="p-1 hover:bg-muted rounded">
          <X size={14} />
        </button>
      </div>

      {/* Star rating */}
      <div>
        <label className="text-[11px] text-muted-foreground block mb-1">Rating *</label>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(i => (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHoverRating(i)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(i)}
              className="p-0.5"
            >
              <Star
                size={20}
                className={cn(
                  'transition-colors',
                  i <= (hoverRating || rating)
                    ? 'text-amber-500 fill-amber-500'
                    : 'text-muted-foreground/30'
                )}
              />
            </button>
          ))}
          {rating > 0 && <span className="text-xs ml-2">{rating}/5</span>}
        </div>
      </div>

      {/* Project */}
      <div>
        <label className="text-[11px] text-muted-foreground block mb-1">Project (optional)</label>
        <select
          value={projectId}
          onChange={e => setProjectId(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">— No project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Boolean indicators */}
      <div className="flex items-center gap-4 flex-wrap">
        <TriToggle label="On time?" value={onTime} onChange={setOnTime} />
        <TriToggle label="On budget?" value={onBudget} onChange={setOnBudget} />
        <TriToggle label="Would rehire?" value={wouldRehire} onChange={setWouldRehire} />
      </div>

      {/* Notes */}
      <div>
        <label className="text-[11px] text-muted-foreground block mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          placeholder="How was the experience working with this vendor?"
        />
      </div>

      {/* Reviewed by */}
      <div>
        <label className="text-[11px] text-muted-foreground block mb-1">Reviewed by</label>
        <input
          type="text"
          value={reviewedBy}
          onChange={e => setReviewedBy(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Your name"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || rating === 0}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Review'}
        </button>
      </div>
    </form>
  )
}

function TriToggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean | null
  onChange: (v: boolean | null) => void
}) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(value === true ? null : true)}
          className={cn(
            'px-2 py-1 rounded text-[10px] font-medium transition-colors',
            value === true ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-muted text-muted-foreground'
          )}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(value === false ? null : false)}
          className={cn(
            'px-2 py-1 rounded text-[10px] font-medium transition-colors',
            value === false ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-muted text-muted-foreground'
          )}
        >
          No
        </button>
      </div>
    </div>
  )
}
