'use client'

import { useActionState, useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Pencil, X, Plus, Trash2, Upload, CheckCircle2, AlertTriangle,
  FileText, Loader2, ShieldCheck,
} from 'lucide-react'
import type { CompanyProfile, Certification, ProjectSector } from '@/lib/supabase/types'
import { SECTORS, SECTOR_LABELS } from '@/lib/utils/constants'
import {
  updateCompanyProfile,
  createCertification,
  updateCertification,
  type CompanyFormState,
  type CertFormState,
} from '@/app/company/actions'

const DELIVERY_METHODS = ['Design-Build', 'Design-Bid-Build', 'CMAR']
const CONTRACT_TYPES = ['FFP', 'CPFF', 'T&M', 'GMP', 'Lump Sum', 'Cost Plus']

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCurrency(val: number | null): string {
  if (!val) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val)
}

function BooleanBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold ${
      active
        ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 ring-1 ring-green-200 dark:ring-green-800/60'
        : 'bg-muted text-muted-foreground ring-1 ring-border'
    }`}>
      {label}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || '—'}</dd>
    </div>
  )
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="label-caps text-muted-foreground">{title}</h2>
      {children}
    </div>
  )
}

function InputRow({ label, name, defaultValue, type = 'text', placeholder }: {
  label: string; name: string; defaultValue?: string | null; type?: string; placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {type === 'date' ? (
        <DatePicker name={name} defaultValue={defaultValue ?? ''} />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ''}
          placeholder={placeholder}
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      )}
    </div>
  )
}

function TextAreaRow({ label, name, defaultValue, rows = 4, placeholder }: {
  label: string; name: string; defaultValue?: string | null; rows?: number; placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
      />
    </div>
  )
}

function CheckboxGroup({ label, name, options, selected }: {
  label: string
  name: string
  options: Array<{ value: string; label: string }>
  selected: string[]
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer rounded-md border border-input px-2.5 py-1 text-sm hover:bg-accent transition-colors">
            <input
              type="checkbox"
              name={name}
              value={opt.value}
              defaultChecked={selected.includes(opt.value)}
              className="rounded border-input"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

function ChipList({ items, className = '' }: { items: string[]; className?: string }) {
  if (!items.length) return <span className="text-sm text-muted-foreground">—</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it, i) => (
        <span key={i} className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset ${className || 'bg-muted text-foreground ring-border'}`}>
          {it}
        </span>
      ))}
    </div>
  )
}

// ─── Cert Card ───────────────────────────────────────────────────────────────

function CertCard({
  cert,
  onDelete,
}: {
  cert: Certification
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [docUploaded, setDocUploaded] = useState(!!cert.document_id)
  const fileRef = useRef<HTMLInputElement>(null)

  const days = daysUntil(cert.expiration_date)
  const expiringSoon = days !== null && days <= 90 && days >= 0
  const expired = days !== null && days < 0

  const boundUpdate = updateCertification.bind(null, cert.id)
  const [editState, editAction, editPending] = useActionState<CertFormState, FormData>(
    boundUpdate,
    null
  )

  async function uploadScan(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', files[0])
    fd.append('cert_id', cert.id)
    const res = await fetch('/api/certifications/upload', { method: 'POST', body: fd })
    if (res.ok) setDocUploaded(true)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/20">
        <form action={editAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <InputRow label="Name *" name="name" defaultValue={cert.name} />
            <InputRow label="Issuing Body" name="issuing_body" defaultValue={cert.issuing_body} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <InputRow label="Cert Number" name="cert_number" defaultValue={cert.cert_number} />
            <InputRow label="Issued Date" name="issued_date" type="date" defaultValue={cert.issued_date} />
            <InputRow label="Expiration Date" name="expiration_date" type="date" defaultValue={cert.expiration_date} />
          </div>
          <TextAreaRow label="Notes" name="notes" defaultValue={cert.notes} rows={2} />
          <div className="flex items-center gap-2">
            <input type="hidden" name="is_active" value={cert.is_active ? 'true' : 'false'} />
            {editState && 'error' in editState && (
              <span className="text-xs text-destructive">{editState.error}</span>
            )}
            {editState && 'ok' in editState && (
              <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-input"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editPending}
                className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {editPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="flex items-start gap-3">
        <ShieldCheck size={16} className={`mt-0.5 shrink-0 ${cert.is_active ? 'text-green-500 dark:text-green-400' : 'text-muted-foreground'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{cert.name}</span>
            {!cert.is_active && (
              <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-medium">Inactive</span>
            )}
            {expired && (
              <span className="text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                <AlertTriangle size={9} /> Expired
              </span>
            )}
            {expiringSoon && (
              <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
                <AlertTriangle size={9} /> Expires in {days}d
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
            {cert.issuing_body && <span className="text-xs text-muted-foreground">{cert.issuing_body}</span>}
            {cert.cert_number && <span className="text-xs text-muted-foreground">#{cert.cert_number}</span>}
            {cert.issued_date && <span className="text-xs text-muted-foreground">Issued {formatDate(cert.issued_date)}</span>}
            {cert.expiration_date && <span className="text-xs text-muted-foreground">Expires {formatDate(cert.expiration_date)}</span>}
          </div>
          {cert.notes && <p className="text-xs text-muted-foreground mt-1">{cert.notes}</p>}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Scan upload */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            title={docUploaded ? 'Replace scan' : 'Upload certificate scan'}
            className={`p-1.5 rounded hover:bg-muted transition-colors ${docUploaded ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : docUploaded ? <FileText size={14} /> : <Upload size={14} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={e => uploadScan(e.target.files)}
          />
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            onClick={() => onDelete(cert.id)}
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Cert Form ────────────────────────────────────────────────────────────

function AddCertForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [state, action, pending] = useActionState<CertFormState, FormData>(createCertification, null)

  useEffect(() => {
    if (state && 'ok' in state) onSuccess()
  }, [state, onSuccess])

  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/20">
      <form action={action} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <InputRow label="Name *" name="name" placeholder="e.g. CMMC Level 2" />
          <InputRow label="Issuing Body" name="issuing_body" placeholder="e.g. DoD" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <InputRow label="Cert Number" name="cert_number" />
          <InputRow label="Issued Date" name="issued_date" type="date" />
          <InputRow label="Expiration Date" name="expiration_date" type="date" />
        </div>
        <TextAreaRow label="Notes" name="notes" rows={2} />
        <input type="hidden" name="is_active" value="true" />
        {state && 'error' in state && (
          <p className="text-xs text-destructive">{state.error}</p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md border border-input"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {pending ? 'Adding…' : 'Add Certification'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  profile: CompanyProfile
  certifications: Certification[]
}

export default function CompanyProfileClient({ profile, certifications: initialCerts }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [addingCert, setAddingCert] = useState(false)
  const [addCertKey, setAddCertKey] = useState(0)
  const [certs, setCerts] = useState<Certification[]>(initialCerts)
  const [deletingCertId, setDeletingCertId] = useState<string | null>(null)
  const [pendingDeleteCertId, setPendingDeleteCertId] = useState<string | null>(null)

  useEffect(() => { setCerts(initialCerts) }, [initialCerts])

  function handleCertAdded() {
    setAddCertKey(k => k + 1)
    router.refresh()
  }

  const [saveState, saveAction, savePending] = useActionState<CompanyFormState, FormData>(
    updateCompanyProfile,
    null
  )

  async function handleDeleteCert(certId: string) {
    setDeletingCertId(certId)
    const res = await fetch(`/api/certifications/${certId}`, { method: 'DELETE' })
    if (res.ok) {
      setCerts(prev => prev.filter(c => c.id !== certId))
      toast.success('Certification deleted')
    } else {
      toast.error('Delete failed')
    }
    setDeletingCertId(null)
  }

  // After successful save, exit edit mode
  const savedOk = saveState && 'ok' in saveState

  return (
    <div className="space-y-8">

      {/* ── Identity ── */}
      <section className="space-y-4">
        <SectionHeader title="Company Identity">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
            >
              <Pencil size={11} /> Edit Profile
            </button>
          )}
        </SectionHeader>

        {editing ? (
          <form action={saveAction} className="space-y-6">
            {/* Identity fields */}
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="label-caps text-muted-foreground">Identity</p>
              <div className="grid grid-cols-2 gap-4">
                <InputRow label="Legal Name *" name="legal_name" defaultValue={profile.legal_name} />
                <InputRow label="DBA / Trade Name" name="dba_name" defaultValue={profile.dba_name} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <InputRow label="Founded Year" name="founded_year" type="number" defaultValue={profile.founded_year?.toString()} placeholder="e.g. 1985" />
                <InputRow label="Phone" name="phone" defaultValue={profile.phone} />
                <InputRow label="Email" name="email" type="email" defaultValue={profile.email} />
              </div>
              <InputRow label="HQ Address" name="hq_address" defaultValue={profile.hq_address} />
              <InputRow label="Website" name="website" defaultValue={profile.website} placeholder="https://" />
            </div>

            {/* Narrative */}
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="label-caps text-muted-foreground">Narrative (used by AI for RFP matching & due diligence)</p>
              <TextAreaRow
                label="About Ber Wilson"
                name="about"
                defaultValue={profile.about}
                rows={5}
                placeholder="Company history, mission, leadership, what makes Ber Wilson unique…"
              />
              <TextAreaRow
                label="Capabilities & Services"
                name="capabilities"
                defaultValue={profile.capabilities}
                rows={4}
                placeholder="List the trades, services, and project types Ber Wilson performs. The AI reads this to match your qualifications against RFP requirements."
              />
            </div>

            {/* Classifications */}
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="label-caps text-muted-foreground">Classifications</p>
              <div className="grid grid-cols-2 gap-4">
                <InputRow
                  label="NAICS Codes (comma-separated)"
                  name="naics_codes"
                  defaultValue={profile.naics_codes.join(', ')}
                  placeholder="e.g. 236220, 237310"
                />
                <InputRow
                  label="SIC Codes (comma-separated)"
                  name="sic_codes"
                  defaultValue={profile.sic_codes.join(', ')}
                  placeholder="e.g. 1542, 1731"
                />
              </div>
            </div>

            {/* Diversity status */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <p className="label-caps text-muted-foreground">Diversity / Small Business Status</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['dbe', 'mbe', 'wbe', 'sbe'] as const).map(key => (
                  <label key={key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name={`${key}_certified`}
                      value="true"
                      defaultChecked={profile[`${key}_certified`]}
                      className="rounded border-input"
                      onChange={e => {
                        // Mirror checked state to hidden input
                        const hidden = e.currentTarget.parentElement?.querySelector('input[type="hidden"]') as HTMLInputElement | null
                        if (hidden) hidden.value = e.currentTarget.checked ? 'true' : 'false'
                      }}
                    />
                    <input type="hidden" name={`${key}_certified`} value={profile[`${key}_certified`] ? 'true' : 'false'} />
                    <span className="text-sm font-medium">{key.toUpperCase()} Certified</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Bonding */}
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="label-caps text-muted-foreground">Bonding & Insurance</p>
              <div className="grid grid-cols-3 gap-4">
                <InputRow label="Single Project Bonding Capacity ($)" name="bonding_capacity" type="number" defaultValue={profile.bonding_capacity?.toString()} />
                <InputRow label="Aggregate Bonding Capacity ($)" name="aggregate_bonding" type="number" defaultValue={profile.aggregate_bonding?.toString()} />
                <InputRow label="Bonding Company" name="bonding_company" defaultValue={profile.bonding_company} />
              </div>
            </div>

            {/* Pursuit Profile */}
            <div className="rounded-lg border border-border p-4 space-y-4">
              <p className="label-caps text-muted-foreground">
                Pursuit Profile — what Ber Wilson goes after (drives the AI fit assessment on proposal intake)
              </p>
              <CheckboxGroup
                label="Target Sectors"
                name="target_sectors"
                options={SECTORS.map(s => ({ value: s, label: SECTOR_LABELS[s] }))}
                selected={profile.target_sectors ?? []}
              />
              <div className="grid grid-cols-3 gap-4">
                <InputRow label="Min Project Value ($)" name="min_project_value" type="number" defaultValue={profile.min_project_value?.toString()} placeholder="e.g. 5000000" />
                <InputRow label="Sweet Spot Value ($)" name="sweet_spot_value" type="number" defaultValue={profile.sweet_spot_value?.toString()} placeholder="e.g. 50000000" />
                <InputRow label="Max Project Value ($)" name="max_project_value" type="number" defaultValue={profile.max_project_value?.toString()} placeholder="e.g. 500000000" />
              </div>
              <InputRow
                label="Target Geographies (comma-separated)"
                name="target_geographies"
                defaultValue={(profile.target_geographies ?? []).join(', ')}
                placeholder="e.g. Utah, Nevada, Mountain West"
              />
              <CheckboxGroup
                label="Delivery Methods"
                name="delivery_methods"
                options={DELIVERY_METHODS.map(d => ({ value: d, label: d }))}
                selected={profile.delivery_methods ?? []}
              />
              <CheckboxGroup
                label="Contract Vehicles"
                name="contract_types"
                options={CONTRACT_TYPES.map(c => ({ value: c, label: c }))}
                selected={profile.contract_types ?? []}
              />
              <InputRow label="Annual Revenue ($)" name="annual_revenue" type="number" defaultValue={profile.annual_revenue?.toString()} />
              <TextAreaRow
                label="Differentiators / Win Themes"
                name="differentiators"
                defaultValue={profile.differentiators}
                rows={3}
                placeholder="What sets Ber Wilson apart on a pursuit — vertical integration, prefab steel speed, self-perform trades, financing capacity…"
              />
              <TextAreaRow
                label="Disqualifiers (hard no-go criteria)"
                name="disqualifiers"
                defaultValue={profile.disqualifiers}
                rows={3}
                placeholder="Deal-breakers the AI should flag — e.g. projects under $5M, outside the Mountain West, residential-only, no GC role…"
              />
              <TextAreaRow
                label="Relevant Past Performance"
                name="past_performance"
                defaultValue={profile.past_performance}
                rows={3}
                placeholder="Notable comparable projects the AI can weigh when judging fit."
              />
              <TextAreaRow
                label="Current Appetite Notes"
                name="pursuit_notes"
                defaultValue={profile.pursuit_notes}
                rows={2}
                placeholder="Strategic priorities right now — sectors to lean into, capacity constraints, etc."
              />
            </div>

            {saveState && 'error' in saveState && (
              <p className="text-sm text-destructive">{saveState.error}</p>
            )}
            {savedOk && (
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                <CheckCircle2 size={14} /> Saved successfully
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
              >
                <X size={12} /> Cancel
              </button>
              <button
                type="submit"
                disabled={savePending}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {savePending ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                {savePending ? 'Saving…' : 'Save Profile'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            {/* Identity read view */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Field label="Legal Name" value={profile.legal_name} />
              <Field label="DBA" value={profile.dba_name} />
              <Field label="Founded" value={profile.founded_year?.toString()} />
              <Field label="HQ Address" value={profile.hq_address} />
              <Field label="Phone" value={profile.phone} />
              <Field label="Email" value={profile.email} />
              {profile.website && (
                <div className="space-y-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Website</dt>
                  <dd>
                    <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
                      {profile.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            {/* About */}
            {profile.about && (
              <div className="space-y-1.5">
                <h3 className="label-caps text-muted-foreground">About</h3>
                <p className="text-sm leading-relaxed whitespace-pre-line">{profile.about}</p>
              </div>
            )}

            {/* Capabilities */}
            {profile.capabilities && (
              <div className="space-y-1.5">
                <h3 className="label-caps text-muted-foreground">Capabilities & Services</h3>
                <p className="text-sm leading-relaxed whitespace-pre-line">{profile.capabilities}</p>
              </div>
            )}

            {/* Classifications + Diversity */}
            <div className="space-y-3">
              <h3 className="label-caps text-muted-foreground">Classifications & Status</h3>
              <div className="flex flex-wrap gap-2">
                <BooleanBadge label="DBE" active={profile.dbe_certified} />
                <BooleanBadge label="MBE" active={profile.mbe_certified} />
                <BooleanBadge label="WBE" active={profile.wbe_certified} />
                <BooleanBadge label="SBE" active={profile.sbe_certified} />
                {profile.naics_codes.length > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-200 dark:ring-blue-800/60 text-xs font-medium">
                    NAICS: {profile.naics_codes.join(', ')}
                  </span>
                )}
                {profile.sic_codes.length > 0 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-md bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-1 ring-violet-200 dark:ring-violet-800/60 text-xs font-medium">
                    SIC: {profile.sic_codes.join(', ')}
                  </span>
                )}
              </div>
            </div>

            {/* Bonding */}
            {(profile.bonding_capacity || profile.aggregate_bonding || profile.bonding_company) && (
              <div className="space-y-2">
                <h3 className="label-caps text-muted-foreground">Bonding & Insurance</h3>
                <dl className="grid grid-cols-3 gap-x-6 gap-y-2">
                  <Field label="Single Project" value={formatCurrency(profile.bonding_capacity)} />
                  <Field label="Aggregate" value={formatCurrency(profile.aggregate_bonding)} />
                  <Field label="Bonding Company" value={profile.bonding_company} />
                </dl>
              </div>
            )}

            {/* Pursuit Profile */}
            <div className="space-y-3 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <h3 className="label-caps text-muted-foreground">Pursuit Profile</h3>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
                >
                  <Pencil size={11} /> Edit
                </button>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target Sectors</dt>
                  <dd><ChipList items={(profile.target_sectors ?? []).map(s => SECTOR_LABELS[s as ProjectSector] ?? s)} className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60" /></dd>
                </div>
                <Field
                  label="Project Size"
                  value={
                    profile.min_project_value == null && profile.max_project_value == null && profile.sweet_spot_value == null
                      ? null
                      : `${formatCurrency(profile.min_project_value)} – ${formatCurrency(profile.max_project_value)}${profile.sweet_spot_value != null ? ` (sweet spot ${formatCurrency(profile.sweet_spot_value)})` : ''}`
                  }
                />
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target Geographies</dt>
                  <dd><ChipList items={profile.target_geographies ?? []} /></dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Delivery Methods</dt>
                  <dd><ChipList items={profile.delivery_methods ?? []} /></dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contract Vehicles</dt>
                  <dd><ChipList items={profile.contract_types ?? []} /></dd>
                </div>
                <Field label="Annual Revenue" value={profile.annual_revenue != null ? formatCurrency(profile.annual_revenue) : null} />
              </dl>

              {profile.differentiators && (
                <div className="space-y-1">
                  <h4 className="label-caps text-muted-foreground">Differentiators / Win Themes</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{profile.differentiators}</p>
                </div>
              )}
              {profile.past_performance && (
                <div className="space-y-1">
                  <h4 className="label-caps text-muted-foreground">Relevant Past Performance</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{profile.past_performance}</p>
                </div>
              )}
              {profile.disqualifiers && (
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-400">Disqualifiers (hard no-go)</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{profile.disqualifiers}</p>
                </div>
              )}
              {profile.pursuit_notes && (
                <div className="space-y-1">
                  <h4 className="label-caps text-muted-foreground">Current Appetite Notes</h4>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{profile.pursuit_notes}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ── Certifications ── */}
      <section className="space-y-4">
        <SectionHeader title={`Certifications & Licenses (${certs.length})`}>
          <button
            type="button"
            onClick={() => setAddingCert(true)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Plus size={11} /> Add
          </button>
        </SectionHeader>

        {addingCert && (
          <AddCertForm
            key={addCertKey}
            onCancel={() => setAddingCert(false)}
            onSuccess={handleCertAdded}
          />
        )}

        {certs.length === 0 && !addingCert && (
          <div className="text-center py-8 text-sm text-muted-foreground rounded-lg border border-dashed border-border">
            No certifications yet. Add your licenses, certifications, and credentials.
          </div>
        )}

        <div className="space-y-2">
          {certs.map(cert => (
            <CertCard
              key={cert.id}
              cert={cert}
              onDelete={(certId: string) => setPendingDeleteCertId(certId)}
            />
          ))}
        </div>

        {deletingCertId && (
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> Deleting…
          </div>
        )}
      </section>

      <ConfirmDialog
        open={pendingDeleteCertId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteCertId(null) }}
        title="Delete this certification?"
        description="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { if (pendingDeleteCertId) await handleDeleteCert(pendingDeleteCertId) }}
      />
    </div>
  )
}
