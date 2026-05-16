'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, X, Search, MessageSquarePlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  TEMPERATURES,
  TEMPERATURE_LABELS,
  TEMPERATURE_BADGE,
  formatDate,
} from '@/lib/utils/constants'
import type { StakeholderRelationship, StakeholderInteraction } from '@/lib/supabase/types'

type Party = { id: string; full_name: string; company: string | null; title: string | null; email: string | null; phone: string | null }

type SR = StakeholderRelationship & { party: Party }

interface StakeholdersClientProps {
  siteId: string
  initialStakeholders: SR[]
  interactionsByRelationship: Record<string, StakeholderInteraction[]>
}

const INTERACTION_MEDIUMS = ['meeting', 'email', 'phone', 'site_visit', 'video_call', 'letter', 'other']

export default function StakeholdersClient({
  siteId,
  initialStakeholders,
  interactionsByRelationship: initialInteractions,
}: StakeholdersClientProps) {
  const router = useRouter()
  const [stakeholders, setStakeholders] = useState<SR[]>(initialStakeholders)
  const [interactions, setInteractions] = useState<Record<string, StakeholderInteraction[]>>(initialInteractions)

  // Add stakeholder dialog
  const [addOpen, setAddOpen] = useState(false)
  const [parties, setParties] = useState<Party[]>([])
  const [loadingParties, setLoadingParties] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Party | null>(null)
  const [addRole, setAddRole] = useState('')
  const [addTemp, setAddTemp] = useState<string>('neutral')
  const [addNotes, setAddNotes] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Edit stakeholder dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editingSR, setEditingSR] = useState<SR | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editTemp, setEditTemp] = useState('')
  const [editNextScheduled, setEditNextScheduled] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Log interaction dialog
  const [logOpen, setLogOpen] = useState(false)
  const [loggingForSR, setLoggingForSR] = useState<SR | null>(null)
  const [logDate, setLogDate] = useState('')
  const [logMedium, setLogMedium] = useState('meeting')
  const [logSummary, setLogSummary] = useState('')
  const [logFollowUp, setLogFollowUp] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  // Load parties when add dialog opens
  useEffect(() => {
    if (!addOpen) return
    setLoadingParties(true)
    setSearch('')
    setSelected(null)
    setAddRole('')
    setAddTemp('neutral')
    setAddNotes('')
    setAddError(null)

    fetch('/api/parties')
      .then(r => r.json())
      .then(data => {
        setParties(Array.isArray(data) ? data : [])
        setLoadingParties(false)
      })
      .catch(() => setLoadingParties(false))
  }, [addOpen])

  const filteredParties = useMemo(() => {
    if (!search.trim()) return parties
    const q = search.toLowerCase()
    return parties.filter(p =>
      p.full_name.toLowerCase().includes(q) ||
      p.company?.toLowerCase().includes(q) ||
      p.title?.toLowerCase().includes(q)
    )
  }, [parties, search])

  async function handleAddStakeholder() {
    if (!selected) return
    setAddSaving(true)
    setAddError(null)
    try {
      const res = await fetch(`/api/portfolio/sites/${siteId}/stakeholders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party_id: selected.id,
          role: addRole.trim() || null,
          temperature: addTemp || null,
          notes: addNotes.trim() || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setAddOpen(false)
      router.refresh()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setAddSaving(false)
    }
  }

  function openEdit(sr: SR) {
    setEditingSR(sr)
    setEditRole(sr.role ?? '')
    setEditTemp(sr.temperature ?? 'neutral')
    setEditNextScheduled(sr.next_scheduled ?? '')
    setEditNotes(sr.notes ?? '')
    setEditError(null)
    setEditOpen(true)
  }

  async function handleEditSave() {
    if (!editingSR) return
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/portfolio/stakeholders/${editingSR.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editRole.trim() || null,
          temperature: editTemp || null,
          next_scheduled: editNextScheduled || null,
          notes: editNotes.trim() || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      const { stakeholder } = await res.json()
      setStakeholders(prev => prev.map(sr => sr.id === editingSR.id ? { ...sr, ...stakeholder } : sr))
      setEditOpen(false)
      router.refresh()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setEditSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/portfolio/stakeholders/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      setStakeholders(prev => prev.filter(sr => sr.id !== id))
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  function openLogInteraction(sr: SR) {
    setLoggingForSR(sr)
    setLogDate(new Date().toISOString().split('T')[0])
    setLogMedium('meeting')
    setLogSummary('')
    setLogFollowUp('')
    setLogError(null)
    setLogOpen(true)
  }

  async function handleLogInteraction() {
    if (!loggingForSR || !logSummary.trim()) return
    setLogSaving(true)
    setLogError(null)
    try {
      const res = await fetch(`/api/portfolio/stakeholders/${loggingForSR.id}/interactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interaction_date: logDate,
          medium: logMedium,
          summary: logSummary.trim(),
          follow_up: logFollowUp.trim() || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      const { interaction } = await res.json()
      setInteractions(prev => ({
        ...prev,
        [loggingForSR.id]: [interaction, ...(prev[loggingForSR.id] ?? [])],
      }))
      setLogOpen(false)
      router.refresh()
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setLogSaving(false)
    }
  }

  // Temperature summary
  const tempCounts = stakeholders.reduce((acc, sr) => {
    const t = sr.temperature ?? 'unknown'
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="mt-4 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        {stakeholders.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(tempCounts).map(([temp, count]) => (
              <span
                key={temp}
                className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${TEMPERATURE_BADGE[temp as keyof typeof TEMPERATURE_BADGE] ?? 'bg-slate-50 text-slate-500 ring-slate-200'}`}
              >
                {TEMPERATURE_LABELS[temp as keyof typeof TEMPERATURE_LABELS] ?? temp}: {count}
              </span>
            ))}
          </div>
        )}
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors shrink-0 ml-auto"
        >
          <Plus size={13} />
          Add Stakeholder
        </button>
      </div>

      {/* Stakeholder cards */}
      {stakeholders.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center">
          <p className="text-sm text-slate-400 mb-3">No stakeholders linked to this site yet.</p>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            <Plus size={13} />
            Add Stakeholder
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {stakeholders.map(sr => {
            const party = sr.party
            const srInteractions = interactions[sr.id] ?? []
            return (
              <div key={sr.id} className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{party?.full_name ?? 'Unknown'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {[party?.title, party?.company].filter(Boolean).join(' at ')}
                    </p>
                    {sr.role && <p className="text-xs text-slate-500 mt-1">{sr.role}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${TEMPERATURE_BADGE[sr.temperature as keyof typeof TEMPERATURE_BADGE] ?? 'bg-slate-50 text-slate-500 ring-slate-200'}`}>
                      {TEMPERATURE_LABELS[sr.temperature as keyof typeof TEMPERATURE_LABELS] ?? sr.temperature}
                    </span>
                    <button
                      onClick={() => openLogInteraction(sr)}
                      className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-slate-100 transition-colors"
                      title="Log interaction"
                    >
                      <MessageSquarePlus size={14} className="text-slate-400" />
                    </button>
                    <button
                      onClick={() => openEdit(sr)}
                      className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-slate-100 transition-colors"
                      title="Edit"
                    >
                      <Pencil size={14} className="text-slate-400" />
                    </button>
                    {confirmDeleteId === sr.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-red-600 font-medium">Delete?</span>
                        <button
                          onClick={() => handleDelete(sr.id)}
                          disabled={deletingId === sr.id}
                          className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                          {deletingId === sr.id ? '…' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(sr.id)}
                        className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={14} className="text-slate-400 hover:text-red-500" />
                      </button>
                    )}
                  </div>
                </div>

                {(party?.email || party?.phone) && (
                  <div className="flex gap-4 mt-2 text-xs text-slate-500">
                    {party?.email && <span>{party.email}</span>}
                    {party?.phone && <span>{party.phone}</span>}
                  </div>
                )}

                {srInteractions.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-2.5">
                    <p className="text-xs uppercase tracking-wider text-slate-400 font-medium mb-1.5">Recent Interactions</p>
                    <div className="space-y-1.5">
                      {srInteractions.slice(0, 3).map(i => (
                        <div key={i.id} className="flex items-start gap-2 text-xs">
                          <span className="text-slate-400 shrink-0 w-16">{formatDate(i.interaction_date)}</span>
                          <span className="text-slate-400 shrink-0 capitalize">{i.medium}</span>
                          <span className="text-slate-600 truncate">{i.summary}</span>
                        </div>
                      ))}
                      {srInteractions.length > 3 && (
                        <p className="text-xs text-slate-400">+ {srInteractions.length - 3} more</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add stakeholder dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Stakeholder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {addError && <p className="text-sm text-red-600">{addError}</p>}

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contact <span className="text-red-500">*</span>
              </label>
              {selected ? (
                <div className="flex items-center justify-between rounded-md border border-input bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{selected.full_name}</p>
                    {selected.company && <p className="text-xs text-muted-foreground">{selected.company}</p>}
                  </div>
                  <button onClick={() => { setSelected(null); setSearch('') }} className="text-xs text-muted-foreground hover:text-foreground">
                    Change
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search by name or company…"
                      className={`${inputClass} pl-7`}
                      disabled={loadingParties}
                      autoFocus
                    />
                  </div>
                  {loadingParties ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={16} className="animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredParties.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                      {filteredParties.slice(0, 20).map(party => (
                        <button
                          key={party.id}
                          onClick={() => setSelected(party)}
                          className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors"
                        >
                          <p className="text-sm font-medium">{party.full_name}</p>
                          {(party.company || party.title) && (
                            <p className="text-xs text-muted-foreground">{[party.title, party.company].filter(Boolean).join(' · ')}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : search ? (
                    <p className="text-xs text-muted-foreground px-1">No contacts found.</p>
                  ) : null}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</label>
                <input value={addRole} onChange={e => setAddRole(e.target.value)} placeholder="e.g. City Council Member" disabled={addSaving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Temperature</label>
                <select value={addTemp} onChange={e => setAddTemp(e.target.value)} disabled={addSaving} className={inputClass}>
                  {TEMPERATURES.map(t => (
                    <option key={t} value={t}>{TEMPERATURE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
              <textarea value={addNotes} onChange={e => setAddNotes(e.target.value)} rows={2} disabled={addSaving} className={`${inputClass} resize-none`} />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setAddOpen(false)} disabled={addSaving} className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleAddStakeholder}
              disabled={!selected || addSaving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {addSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Add Stakeholder
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit stakeholder dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Stakeholder Relationship</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {editError && <p className="text-sm text-red-600">{editError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Role</label>
                <input value={editRole} onChange={e => setEditRole(e.target.value)} placeholder="e.g. City Council Member" disabled={editSaving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Temperature</label>
                <select value={editTemp} onChange={e => setEditTemp(e.target.value)} disabled={editSaving} className={inputClass}>
                  {TEMPERATURES.map(t => (
                    <option key={t} value={t}>{TEMPERATURE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next Scheduled</label>
              <input type="date" value={editNextScheduled} onChange={e => setEditNextScheduled(e.target.value)} disabled={editSaving} className={inputClass} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
              <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} disabled={editSaving} className={`${inputClass} resize-none`} />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setEditOpen(false)} disabled={editSaving} className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button onClick={handleEditSave} disabled={editSaving} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {editSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Changes
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log interaction dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log Interaction — {loggingForSR?.party?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {logError && <p className="text-sm text-red-600">{logError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</label>
                <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} disabled={logSaving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Medium</label>
                <select value={logMedium} onChange={e => setLogMedium(e.target.value)} disabled={logSaving} className={inputClass}>
                  {INTERACTION_MEDIUMS.map(m => (
                    <option key={m} value={m}>{m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Summary <span className="text-red-500">*</span>
              </label>
              <textarea
                value={logSummary}
                onChange={e => setLogSummary(e.target.value)}
                rows={3}
                placeholder="What was discussed or decided?"
                disabled={logSaving}
                className={`${inputClass} resize-none`}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up</label>
              <textarea value={logFollowUp} onChange={e => setLogFollowUp(e.target.value)} rows={2} placeholder="Any follow-up actions needed?" disabled={logSaving} className={`${inputClass} resize-none`} />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setLogOpen(false)} disabled={logSaving} className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleLogInteraction}
              disabled={!logSummary.trim() || logSaving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {logSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Log Interaction
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
