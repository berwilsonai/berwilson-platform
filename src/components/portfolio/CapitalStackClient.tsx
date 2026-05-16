'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, Loader2, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  FUNDING_CATEGORIES,
  FUNDING_CATEGORY_LABELS,
  FUNDING_CATEGORY_BADGE,
  FUNDING_STATUSES,
  FUNDING_STATUS_LABELS,
  formatValue,
} from '@/lib/utils/constants'
import type { FundingSource, RevenueShareAgreement, Component } from '@/lib/supabase/types'

interface CapitalStackClientProps {
  siteId: string
  components: Pick<Component, 'id' | 'name' | 'type' | 'capital_low' | 'capital_mid' | 'capital_high'>[]
  initialFunding: FundingSource[]
  initialRevenueShare: RevenueShareAgreement | null
}

const EMPTY_FUNDING = {
  source_name: '',
  category: '' as FundingSource['category'] | '',
  status: '' as FundingSource['status'] | '',
  amount: '',
  notes: '',
}

const EMPTY_RS = {
  city_pct: '',
  bw_pct: '',
  revenue_base: '',
  cadence: '',
  sunset_date: '',
  notes: '',
}

export default function CapitalStackClient({
  siteId,
  components,
  initialFunding,
  initialRevenueShare,
}: CapitalStackClientProps) {
  const router = useRouter()
  const [funding, setFunding] = useState<FundingSource[]>(initialFunding)
  const [revenueShare, setRevenueShare] = useState<RevenueShareAgreement | null>(initialRevenueShare)

  // Funding source dialog
  const [fundingOpen, setFundingOpen] = useState(false)
  const [editingFunding, setEditingFunding] = useState<FundingSource | null>(null)
  const [fundingForm, setFundingForm] = useState(EMPTY_FUNDING)
  const [fundingSaving, setFundingSaving] = useState(false)
  const [fundingError, setFundingError] = useState<string | null>(null)
  const [deletingFundingId, setDeletingFundingId] = useState<string | null>(null)
  const [confirmFundingDeleteId, setConfirmFundingDeleteId] = useState<string | null>(null)

  // Revenue share dialog
  const [rsOpen, setRsOpen] = useState(false)
  const [rsForm, setRsForm] = useState(EMPTY_RS)
  const [rsSaving, setRsSaving] = useState(false)
  const [rsError, setRsError] = useState<string | null>(null)

  const inputClass =
    'w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'

  const totalCapitalMid = components.reduce((sum, c) => sum + Number(c.capital_mid ?? 0), 0)
  const totalCapitalHigh = components.reduce((sum, c) => sum + Number(c.capital_high ?? 0), 0)
  const totalFunded = funding.reduce((sum, f) => sum + Number(f.amount ?? 0), 0)
  const gap = totalCapitalMid - totalFunded

  const concentrationWarnings = funding.filter(f => {
    if (!f.amount || totalCapitalMid === 0) return false
    return (Number(f.amount) / totalCapitalMid) > 0.16
  })

  // --- Funding CRUD ---

  function openAddFunding() {
    setEditingFunding(null)
    setFundingForm(EMPTY_FUNDING)
    setFundingError(null)
    setFundingOpen(true)
  }

  function openEditFunding(f: FundingSource) {
    setEditingFunding(f)
    setFundingForm({
      source_name: f.source_name,
      category: f.category ?? '',
      status: f.status ?? '',
      amount: f.amount != null ? String(f.amount) : '',
      notes: f.notes ?? '',
    })
    setFundingError(null)
    setFundingOpen(true)
  }

  function fundingField(key: keyof typeof EMPTY_FUNDING, value: string) {
    setFundingForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSaveFunding() {
    if (!fundingForm.source_name.trim() || !fundingForm.category) return
    setFundingSaving(true)
    setFundingError(null)
    try {
      const body = {
        source_name: fundingForm.source_name.trim(),
        category: fundingForm.category,
        status: fundingForm.status || null,
        amount: fundingForm.amount ? Number(fundingForm.amount) : null,
        notes: fundingForm.notes.trim() || null,
      }

      if (editingFunding) {
        const res = await fetch(`/api/portfolio/funding/${editingFunding.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { funding_source } = await res.json()
        setFunding(prev => prev.map(f => f.id === editingFunding.id ? funding_source : f))
      } else {
        const res = await fetch(`/api/portfolio/sites/${siteId}/funding`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { funding_source } = await res.json()
        setFunding(prev => [...prev, funding_source])
      }

      setFundingOpen(false)
      router.refresh()
    } catch (err) {
      setFundingError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setFundingSaving(false)
    }
  }

  async function handleDeleteFunding(id: string) {
    setDeletingFundingId(id)
    try {
      const res = await fetch(`/api/portfolio/funding/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      setFunding(prev => prev.filter(f => f.id !== id))
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingFundingId(null)
      setConfirmFundingDeleteId(null)
    }
  }

  // --- Revenue Share CRUD ---

  function openRevenueShare() {
    setRsForm(
      revenueShare
        ? {
            city_pct: revenueShare.city_pct != null ? String(revenueShare.city_pct) : '',
            bw_pct: revenueShare.bw_pct != null ? String(revenueShare.bw_pct) : '',
            revenue_base: revenueShare.revenue_base ?? '',
            cadence: revenueShare.cadence ?? '',
            sunset_date: revenueShare.sunset_date ?? '',
            notes: revenueShare.notes ?? '',
          }
        : EMPTY_RS
    )
    setRsError(null)
    setRsOpen(true)
  }

  function rsField(key: keyof typeof EMPTY_RS, value: string) {
    setRsForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSaveRevenueShare() {
    setRsSaving(true)
    setRsError(null)
    try {
      const body = {
        city_pct: rsForm.city_pct ? Number(rsForm.city_pct) : null,
        bw_pct: rsForm.bw_pct ? Number(rsForm.bw_pct) : null,
        revenue_base: rsForm.revenue_base.trim() || null,
        cadence: rsForm.cadence.trim() || null,
        sunset_date: rsForm.sunset_date || null,
        notes: rsForm.notes.trim() || null,
      }

      if (revenueShare) {
        const res = await fetch(`/api/portfolio/revenue-share/${revenueShare.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { revenue_share } = await res.json()
        setRevenueShare(revenue_share)
      } else {
        const res = await fetch(`/api/portfolio/sites/${siteId}/revenue-share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
        const { revenue_share } = await res.json()
        setRevenueShare(revenue_share)
      }

      setRsOpen(false)
      router.refresh()
    } catch (err) {
      setRsError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setRsSaving(false)
    }
  }

  return (
    <div className="mt-4 space-y-6">
      {/* Capital overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Total Capital (Mid)</p>
          <p className="text-xl font-bold text-slate-900 font-mono mt-1">{formatValue(totalCapitalMid)}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">+30% Contingency</p>
          <p className="text-xl font-bold text-slate-900 font-mono mt-1">{formatValue(totalCapitalHigh > 0 ? totalCapitalHigh : totalCapitalMid * 1.3)}</p>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Funded / Identified</p>
          <p className="text-xl font-bold text-emerald-700 font-mono mt-1">{formatValue(totalFunded)}</p>
        </div>
        <div className={`bg-white rounded-lg border px-4 py-3 ${gap > 0 ? 'border-amber-200' : 'border-slate-200'}`}>
          <p className="text-xs text-slate-500">Gap</p>
          <p className={`text-xl font-bold font-mono mt-1 ${gap > 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
            {gap > 0 ? formatValue(gap) : 'Fully funded'}
          </p>
        </div>
      </div>

      {/* Concentration warnings */}
      {concentrationWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm font-medium text-amber-800">Concentration Warning</p>
          <p className="text-xs text-amber-700 mt-1">
            {concentrationWarnings.length} funding source{concentrationWarnings.length !== 1 ? 's' : ''} exceed{concentrationWarnings.length === 1 ? 's' : ''} the 16% single-source concentration threshold:
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {concentrationWarnings.map(f => (
              <li key={f.id} className="text-xs text-amber-700">
                {f.source_name} — {formatValue(Number(f.amount))} ({((Number(f.amount) / totalCapitalMid) * 100).toFixed(1)}%)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Capital by component */}
      {components.length > 0 && (
        <section className="bg-white rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Capital by Component</h2>
          <div className="space-y-2">
            {components.map(c => {
              const mid = Number(c.capital_mid ?? 0)
              const pct = totalCapitalMid > 0 ? (mid / totalCapitalMid) * 100 : 0
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <div className="w-40 shrink-0 text-xs text-slate-700 truncate">{c.name}</div>
                  <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-20 text-right text-xs font-mono text-slate-600 shrink-0">{formatValue(mid)}</div>
                  <div className="w-12 text-right text-xs text-slate-400 shrink-0">{pct.toFixed(1)}%</div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Funding sources */}
      <section className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Funding Sources ({funding.length})
          </h2>
          <button
            onClick={openAddFunding}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            <Plus size={12} />
            Add Source
          </button>
        </div>

        {funding.length === 0 ? (
          <p className="text-sm text-slate-400">No funding sources identified yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Source</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Category</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-500 text-xs">Status</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500 text-xs">Amount</th>
                  <th className="text-right px-3 py-2 font-medium text-slate-500 text-xs">% of Capital</th>
                  <th className="px-3 py-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {funding.map(f => {
                  const pct = totalCapitalMid > 0 && f.amount ? ((Number(f.amount) / totalCapitalMid) * 100) : 0
                  const overConcentration = pct > 16
                  return (
                    <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">{f.source_name}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${FUNDING_CATEGORY_BADGE[f.category as keyof typeof FUNDING_CATEGORY_BADGE]}`}>
                          {FUNDING_CATEGORY_LABELS[f.category as keyof typeof FUNDING_CATEGORY_LABELS]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {f.status ? (FUNDING_STATUS_LABELS[f.status as keyof typeof FUNDING_STATUS_LABELS] ?? f.status) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{f.amount ? formatValue(Number(f.amount)) : '—'}</td>
                      <td className={`px-3 py-2 text-right text-xs ${overConcentration ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>
                        {pct > 0 ? `${pct.toFixed(1)}%` : '—'}
                        {overConcentration && ' !'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openEditFunding(f)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-slate-100 transition-colors"
                            title="Edit"
                          >
                            <Pencil size={13} className="text-slate-400" />
                          </button>
                          {confirmFundingDeleteId === f.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-red-600 font-medium">Delete?</span>
                              <button
                                onClick={() => handleDeleteFunding(f.id)}
                                disabled={deletingFundingId === f.id}
                                className="h-6 px-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                              >
                                {deletingFundingId === f.id ? '…' : 'Yes'}
                              </button>
                              <button
                                onClick={() => setConfirmFundingDeleteId(null)}
                                className="h-6 w-6 rounded flex items-center justify-center hover:bg-slate-100 transition-colors"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmFundingDeleteId(f.id)}
                              className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-red-50 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={13} className="text-slate-400 hover:text-red-500" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {totalFunded > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 font-medium">
                    <td colSpan={3} className="px-3 py-2 text-xs text-slate-700 uppercase tracking-wider">Total Identified</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-slate-900 font-bold">{formatValue(totalFunded)}</td>
                    <td className="px-3 py-2 text-right text-xs text-slate-500">
                      {totalCapitalMid > 0 ? `${((totalFunded / totalCapitalMid) * 100).toFixed(1)}%` : '—'}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </section>

      {/* Revenue share */}
      <section className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Revenue Share Agreement</h2>
          <button
            onClick={openRevenueShare}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-slate-200 text-xs font-medium hover:bg-slate-50 transition-colors"
          >
            <Pencil size={12} />
            {revenueShare ? 'Edit' : 'Set Up'}
          </button>
        </div>

        {revenueShare ? (
          <div>
            <div className="flex items-center gap-4 mb-2">
              <div className="flex-1">
                <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex">
                  <div className="h-full bg-blue-600 rounded-l-full" style={{ width: `${revenueShare.city_pct ?? 60}%` }} />
                  <div className="h-full bg-emerald-500 rounded-r-full" style={{ width: `${revenueShare.bw_pct ?? 40}%` }} />
                </div>
                <div className="flex justify-between mt-1.5 text-xs">
                  <span className="text-blue-600 font-medium">City {revenueShare.city_pct}%</span>
                  <span className="text-emerald-600 font-medium">BW {revenueShare.bw_pct}%</span>
                </div>
              </div>
            </div>
            {revenueShare.revenue_base && (
              <p className="text-xs text-slate-500 mt-3 border-t border-slate-100 pt-3">{revenueShare.revenue_base}</p>
            )}
            {revenueShare.notes && (
              <p className="text-xs text-slate-500 mt-2">{revenueShare.notes}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No revenue share agreement set up yet.</p>
        )}
      </section>

      {/* Funding source dialog */}
      <Dialog open={fundingOpen} onOpenChange={setFundingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFunding ? 'Edit Funding Source' : 'Add Funding Source'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {fundingError && <p className="text-sm text-red-600">{fundingError}</p>}

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Source Name <span className="text-red-500">*</span>
              </label>
              <input
                value={fundingForm.source_name}
                onChange={e => fundingField('source_name', e.target.value)}
                placeholder="e.g. DOE Office of Clean Energy"
                disabled={fundingSaving}
                className={inputClass}
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={fundingForm.category}
                  onChange={e => fundingField('category', e.target.value)}
                  disabled={fundingSaving}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {FUNDING_CATEGORIES.map(c => (
                    <option key={c} value={c}>{FUNDING_CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</label>
                <select
                  value={fundingForm.status}
                  onChange={e => fundingField('status', e.target.value)}
                  disabled={fundingSaving}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {FUNDING_STATUSES.map(s => (
                    <option key={s} value={s}>{FUNDING_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount ($)</label>
              <input
                type="number"
                value={fundingForm.amount}
                onChange={e => fundingField('amount', e.target.value)}
                placeholder="0"
                disabled={fundingSaving}
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
              <textarea
                value={fundingForm.notes}
                onChange={e => fundingField('notes', e.target.value)}
                rows={2}
                disabled={fundingSaving}
                className={`${inputClass} resize-none`}
              />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setFundingOpen(false)} disabled={fundingSaving} className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSaveFunding}
              disabled={!fundingForm.source_name.trim() || !fundingForm.category || fundingSaving}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {fundingSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {editingFunding ? 'Save Changes' : 'Add Source'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revenue share dialog */}
      <Dialog open={rsOpen} onOpenChange={setRsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{revenueShare ? 'Edit Revenue Share' : 'Set Up Revenue Share'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {rsError && <p className="text-sm text-red-600">{rsError}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">City %</label>
                <input type="number" min="0" max="100" value={rsForm.city_pct} onChange={e => rsField('city_pct', e.target.value)} placeholder="60" disabled={rsSaving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">BW %</label>
                <input type="number" min="0" max="100" value={rsForm.bw_pct} onChange={e => rsField('bw_pct', e.target.value)} placeholder="40" disabled={rsSaving} className={inputClass} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue Base</label>
              <input value={rsForm.revenue_base} onChange={e => rsField('revenue_base', e.target.value)} placeholder="e.g. Net energy revenue" disabled={rsSaving} className={inputClass} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cadence</label>
                <input value={rsForm.cadence} onChange={e => rsField('cadence', e.target.value)} placeholder="e.g. Quarterly" disabled={rsSaving} className={inputClass} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sunset Date</label>
                <input type="date" value={rsForm.sunset_date} onChange={e => rsField('sunset_date', e.target.value)} disabled={rsSaving} className={inputClass} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</label>
              <textarea value={rsForm.notes} onChange={e => rsField('notes', e.target.value)} rows={2} disabled={rsSaving} className={`${inputClass} resize-none`} />
            </div>
          </div>
          <DialogFooter>
            <button onClick={() => setRsOpen(false)} disabled={rsSaving} className="inline-flex items-center gap-1 h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button onClick={handleSaveRevenueShare} disabled={rsSaving} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {rsSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Agreement
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
