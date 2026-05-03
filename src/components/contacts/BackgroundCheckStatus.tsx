'use client'

import { useState } from 'react'
import { ShieldCheck, ShieldOff, Pencil, Check, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring'

interface BackgroundCheckStatusProps {
  partyId: string
  completed: boolean | null
  checkDate: string | null
  reference: string | null
  provider: string | null
  notes: string | null
}

type FormState = {
  background_check_completed: boolean
  background_check_date: string
  background_check_reference: string
  background_check_provider: string
  background_check_notes: string
}

function formatDate(d: string | null): string {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function BackgroundCheckStatus({
  partyId,
  completed,
  checkDate,
  reference,
  provider,
  notes,
}: BackgroundCheckStatusProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Local state mirrors the DB values so UI updates immediately on save
  const [data, setData] = useState({
    completed: completed ?? false,
    checkDate: checkDate ?? null,
    reference: reference ?? null,
    provider: provider ?? null,
    notes: notes ?? null,
  })

  const [form, setForm] = useState<FormState>({
    background_check_completed: data.completed,
    background_check_date: data.checkDate ?? '',
    background_check_reference: data.reference ?? '',
    background_check_provider: data.provider ?? '',
    background_check_notes: data.notes ?? '',
  })

  function openEdit() {
    setForm({
      background_check_completed: data.completed,
      background_check_date: data.checkDate ?? '',
      background_check_reference: data.reference ?? '',
      background_check_provider: data.provider ?? '',
      background_check_notes: data.notes ?? '',
    })
    setError(null)
    setEditing(true)
  }

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/parties/${partyId}/background-check`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          background_check_completed: form.background_check_completed,
          background_check_date: form.background_check_date || null,
          background_check_reference: form.background_check_reference || null,
          background_check_provider: form.background_check_provider || null,
          background_check_notes: form.background_check_notes || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Save failed')
      }
      setData({
        completed: form.background_check_completed,
        checkDate: form.background_check_date || null,
        reference: form.background_check_reference || null,
        provider: form.background_check_provider || null,
        notes: form.background_check_notes || null,
      })
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!confirm('Clear background check record?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/parties/${partyId}/background-check`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          background_check_completed: false,
          background_check_date: null,
          background_check_reference: null,
          background_check_provider: null,
          background_check_notes: null,
        }),
      })
      if (!res.ok) throw new Error('Clear failed')
      setData({ completed: false, checkDate: null, reference: null, provider: null, notes: null })
      setEditing(false)
    } catch {
      setError('Clear failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Edit form ──────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-foreground">Background Check</p>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="bg-check-completed"
            checked={form.background_check_completed}
            onChange={(e) => setField('background_check_completed', e.target.checked)}
            className="rounded border-input"
          />
          <label htmlFor="bg-check-completed" className="text-sm">
            Completed
          </label>
        </div>

        {form.background_check_completed && (
          <div className="space-y-3 pl-1">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Completion Date
              </label>
              <input
                type="date"
                value={form.background_check_date}
                onChange={(e) => setField('background_check_date', e.target.value)}
                className={cn(inputCls, 'text-muted-foreground')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                File / Reference #
              </label>
              <input
                type="text"
                value={form.background_check_reference}
                onChange={(e) => setField('background_check_reference', e.target.value)}
                placeholder="e.g. TLO-2026-001234"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Provider
              </label>
              <input
                type="text"
                value={form.background_check_provider}
                onChange={(e) => setField('background_check_provider', e.target.value)}
                placeholder="e.g. TransUnion TLO, Sterling"
                className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Notes
              </label>
              <textarea
                value={form.background_check_notes}
                onChange={(e) => setField('background_check_notes', e.target.value)}
                rows={2}
                placeholder="Optional notes about findings or status..."
                className={cn(inputCls, 'resize-y')}
              />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
          >
            <X size={13} />
            Cancel
          </button>
          {data.completed && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="ml-auto text-xs text-muted-foreground hover:text-red-600 transition-colors"
            >
              Clear record
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Display ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Background Check</p>
        <button
          onClick={openEdit}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Edit background check"
        >
          <Pencil size={12} />
        </button>
      </div>

      {data.completed ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-emerald-700">
            <ShieldCheck size={14} className="shrink-0" />
            <span className="text-xs font-medium">Completed</span>
            {data.checkDate && (
              <span className="text-xs text-muted-foreground">· {formatDate(data.checkDate)}</span>
            )}
          </div>
          {data.provider && (
            <p className="text-[11px] text-muted-foreground">Provider: {data.provider}</p>
          )}
          {data.reference && (
            <p className="text-[11px] text-muted-foreground">Ref #: {data.reference}</p>
          )}
          {data.notes && (
            <p className="text-[11px] text-muted-foreground italic">{data.notes}</p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <ShieldOff size={14} className="shrink-0" />
          <span className="text-xs">Not completed</span>
        </div>
      )}

      {!data.completed && (
        <button
          onClick={openEdit}
          className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors mt-1"
        >
          <ShieldCheck size={13} />
          Mark as Completed
        </button>
      )}
    </div>
  )
}
