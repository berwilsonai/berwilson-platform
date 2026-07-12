'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, Building2, Lightbulb, FolderKanban, User, ListChecks, Paperclip, Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import FitAssessmentCard from '@/components/proposals/FitAssessmentCard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { viewDocument } from '@/lib/utils/document-links'
import type { StagedAttachment } from '@/lib/email-ingestion/attachments'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'
import type { FitAssessment } from '@/lib/ai/fit-assessment'
import { SECTORS, SECTOR_LABELS, STAGES, STAGE_LABELS } from '@/lib/utils/constants'
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  type OpportunityType,
} from '@/lib/utils/opportunities'

interface Props {
  sessionId: string
  extraction: EmailIntakeExtraction
  partyMatches: PartyMatch[]
  fit: FitAssessment | null
  label: string | null
  stagedAttachments: StagedAttachment[]
}

type PersonRow = EmailIntakeExtraction['people'][number] & {
  action: 'create' | 'link' | 'skip'
  existing_party_id: string | null
  existing_name: string | null
}

type TaskRow = EmailIntakeExtraction['tasks'][number] & { include: boolean }

const inputCls = 'w-full h-9 px-3 rounded-md border border-input bg-background text-sm'
const labelCls = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

export default function EmailIngestReview({ sessionId, extraction, partyMatches, fit, label, stagedAttachments }: Props) {
  const router = useRouter()
  const [kind, setKind] = useState<'opportunity' | 'project'>(extraction.suggested_record)
  const [opp, setOpp] = useState({ ...extraction.opportunity })
  const [proj, setProj] = useState({ ...extraction.project })
  const [attachments, setAttachments] = useState(
    stagedAttachments.map((a) => ({ ...a, include: true }))
  )

  const [people, setPeople] = useState<PersonRow[]>(
    extraction.people.map((p, i) => {
      const m = partyMatches.find((pm) => pm.extracted_index === i && pm.match_type !== 'none')
      return {
        ...p,
        action: m ? 'link' : 'create',
        existing_party_id: m?.matched_party_id ?? null,
        existing_name: m?.matched_party_name ?? null,
      }
    })
  )

  const [tasks, setTasks] = useState<TaskRow[]>(
    extraction.tasks.map((t) => ({ ...t, include: true }))
  )

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  /** Switch record kind, carrying shared facts into the other record's blanks
   *  so toggling never loses prepopulated data. Never overwrites edits. */
  function switchKind(next: 'opportunity' | 'project') {
    if (next === kind) return
    const keep = <T,>(cur: T | null | undefined, fallback: T | null): T | null =>
      cur !== null && cur !== undefined && String(cur).trim() !== '' ? cur : fallback
    if (next === 'project') {
      setProj((p) => ({
        ...p,
        name: keep(p.name, opp.name),
        sector: keep(p.sector, opp.sector),
        location: keep(p.location, opp.location),
        estimated_value: keep(p.estimated_value, opp.estimated_value),
        description: keep(p.description, opp.objective ?? opp.thesis),
        client_entity: keep(p.client_entity, opp.counterparty ?? opp.target_name),
      }))
    } else {
      setOpp((o) => ({
        ...o,
        name: keep(o.name, proj.name),
        sector: keep(o.sector, proj.sector),
        location: keep(o.location, proj.location),
        estimated_value: keep(o.estimated_value, proj.estimated_value),
        objective: keep(o.objective, proj.description),
        counterparty: keep(o.counterparty, proj.client_entity),
      }))
    }
    setKind(next)
  }

  async function discard() {
    try {
      const res = await fetch(`/api/email-ingestion/sessions/${sessionId}`, { method: 'PATCH' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not discard the package.')
      }
      toast.success('Research package discarded.')
      router.push('/email-ingestion')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not discard the package.')
    }
  }

  function setPerson(i: number, patch: Partial<PersonRow>) {
    setPeople((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function setTask(i: number, patch: Partial<TaskRow>) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }
  function setAttachment(i: number, include: boolean) {
    setAttachments((prev) => prev.map((a, idx) => (idx === i ? { ...a, include } : a)))
  }

  async function confirm() {
    const record_fields =
      kind === 'project'
        ? {
            name: proj.name,
            sector: proj.sector,
            stage: proj.stage,
            description: proj.description,
            estimated_value: proj.estimated_value,
            contract_type: proj.contract_type,
            delivery_method: proj.delivery_method,
            location: proj.location,
            client_entity: proj.client_entity,
          }
        : {
            name: opp.name,
            opp_type: opp.opp_type,
            sector: opp.sector,
            location: opp.location,
            objective: opp.objective,
            thesis: opp.thesis,
            target_name: opp.target_name,
            counterparty: opp.counterparty,
            estimated_value: opp.estimated_value,
            next_step: opp.next_step,
          }

    if (!record_fields.name || !String(record_fields.name).trim()) {
      setError(`A ${kind} name is required.`)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/email-ingestion/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          record_kind: kind,
          record_fields,
          party_actions: people.map((p) => ({
            name: p.name,
            email: p.email,
            company: p.company,
            title: p.title,
            role: p.role,
            is_organization: p.is_organization,
            action: p.action,
            existing_party_id: p.existing_party_id,
          })),
          task_actions: tasks.map((t) => ({
            title: t.title,
            what: t.what,
            why: t.why,
            how: t.how,
            assignee: t.assignee,
            due_date: t.due_date,
            include: t.include,
          })),
          attachment_paths: attachments.filter((a) => a.include).map((a) => a.storage_path),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Confirmation failed.')
      router.push(data.project_id ? `/projects/${data.project_id}` : `/opportunities/${data.opportunity_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed.')
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      {label && (
        <p className="text-sm text-muted-foreground">
          Research package: <span className="font-medium text-foreground">{label}</span>
        </p>
      )}

      {fit && <FitAssessmentCard fit={fit} />}

      {extraction.summary && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-foreground leading-relaxed">{extraction.summary}</p>
        </div>
      )}

      {/* Record kind toggle */}
      <div className="flex items-center gap-2">
        <span className={labelCls}>Create as</span>
        <div className="inline-flex rounded-md border border-input overflow-hidden">
          <button
            type="button"
            onClick={() => switchKind('opportunity')}
            className={`inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium transition-colors ${
              kind === 'opportunity' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
            }`}
          >
            <Lightbulb size={14} /> Opportunity
          </button>
          <button
            type="button"
            onClick={() => switchKind('project')}
            className={`inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium transition-colors ${
              kind === 'project' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
            }`}
          >
            <FolderKanban size={14} /> Project
          </button>
        </div>
      </div>

      {/* Record fields */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {kind === 'opportunity' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name" full>
              <input className={inputCls} value={opp.name ?? ''} onChange={(e) => setOpp({ ...opp, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <select className={inputCls} value={opp.opp_type ?? 'other'} onChange={(e) => setOpp({ ...opp, opp_type: e.target.value })}>
                {OPPORTUNITY_TYPES.map((t) => (
                  <option key={t} value={t}>{OPPORTUNITY_TYPE_LABELS[t as OpportunityType]}</option>
                ))}
              </select>
            </Field>
            <Field label="Sector">
              <select className={inputCls} value={opp.sector ?? ''} onChange={(e) => setOpp({ ...opp, sector: e.target.value || null })}>
                <option value="">—</option>
                {SECTORS.map((s) => <option key={s} value={s}>{SECTOR_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Target / Counterparty">
              <input className={inputCls} value={opp.target_name ?? ''} onChange={(e) => setOpp({ ...opp, target_name: e.target.value || null })} />
            </Field>
            <Field label="Location">
              <input className={inputCls} value={opp.location ?? ''} onChange={(e) => setOpp({ ...opp, location: e.target.value || null })} />
            </Field>
            <Field label="Estimated value ($)">
              <input type="number" className={inputCls} value={opp.estimated_value ?? ''} onChange={(e) => setOpp({ ...opp, estimated_value: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Next step">
              <input className={inputCls} value={opp.next_step ?? ''} onChange={(e) => setOpp({ ...opp, next_step: e.target.value || null })} />
            </Field>
            <Field label="Objective" full>
              <textarea className={`${inputCls} h-auto py-2`} rows={2} value={opp.objective ?? ''} onChange={(e) => setOpp({ ...opp, objective: e.target.value || null })} />
            </Field>
            <Field label="Thesis" full>
              <textarea className={`${inputCls} h-auto py-2`} rows={2} value={opp.thesis ?? ''} onChange={(e) => setOpp({ ...opp, thesis: e.target.value || null })} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name" full>
              <input className={inputCls} value={proj.name ?? ''} onChange={(e) => setProj({ ...proj, name: e.target.value })} />
            </Field>
            <Field label="Sector">
              <select className={inputCls} value={proj.sector ?? 'real_estate'} onChange={(e) => setProj({ ...proj, sector: e.target.value })}>
                {SECTORS.map((s) => <option key={s} value={s}>{SECTOR_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Stage">
              <select className={inputCls} value={proj.stage ?? 'pursuit'} onChange={(e) => setProj({ ...proj, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Client / Owner">
              <input className={inputCls} value={proj.client_entity ?? ''} onChange={(e) => setProj({ ...proj, client_entity: e.target.value || null })} />
            </Field>
            <Field label="Location">
              <input className={inputCls} value={proj.location ?? ''} onChange={(e) => setProj({ ...proj, location: e.target.value || null })} />
            </Field>
            <Field label="Contract type">
              <input className={inputCls} value={proj.contract_type ?? ''} onChange={(e) => setProj({ ...proj, contract_type: e.target.value || null })} />
            </Field>
            <Field label="Delivery method">
              <input className={inputCls} value={proj.delivery_method ?? ''} onChange={(e) => setProj({ ...proj, delivery_method: e.target.value || null })} />
            </Field>
            <Field label="Estimated value ($)">
              <input type="number" className={inputCls} value={proj.estimated_value ?? ''} onChange={(e) => setProj({ ...proj, estimated_value: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Description" full>
              <textarea className={`${inputCls} h-auto py-2`} rows={2} value={proj.description ?? ''} onChange={(e) => setProj({ ...proj, description: e.target.value || null })} />
            </Field>
          </div>
        )}
      </div>

      {/* People */}
      {people.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <User size={15} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">People ({people.length})</h3>
            {kind === 'project' && (
              <span className="text-xs text-muted-foreground">— linked to the project as players</span>
            )}
          </div>
          <div className="space-y-2">
            {people.map((p, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded-md border border-border/60">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    {p.is_organization && <Building2 size={13} className="text-muted-foreground shrink-0" />}
                    {p.name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[p.role, p.company, p.email].filter(Boolean).join(' · ') || '—'}
                    {p.action === 'link' && p.existing_name && (
                      <span className="text-emerald-600 dark:text-emerald-400"> · matches {p.existing_name}</span>
                    )}
                  </p>
                </div>
                <select
                  className="h-8 px-2 rounded-md border border-input bg-background text-xs shrink-0"
                  value={p.action}
                  onChange={(e) => setPerson(i, { action: e.target.value as PersonRow['action'] })}
                >
                  {p.existing_party_id && <option value="link">Link existing</option>}
                  <option value="create">Create new</option>
                  <option value="skip">Skip</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      {tasks.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ListChecks size={15} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">Tasks ({tasks.filter((t) => t.include).length} of {tasks.length})</h3>
          </div>
          <div className="space-y-2">
            {tasks.map((t, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2 rounded-md border border-border/60">
                <input
                  type="checkbox"
                  checked={t.include}
                  onChange={(e) => setTask(i, { include: e.target.checked })}
                  className="mt-1.5 shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <input
                    className={`${inputCls} h-8`}
                    value={t.title}
                    onChange={(e) => setTask(i, { title: e.target.value })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="h-7 px-2 rounded border border-input bg-background text-xs w-32"
                      placeholder="Assignee"
                      value={t.assignee ?? ''}
                      onChange={(e) => setTask(i, { assignee: e.target.value || null })}
                    />
                    <div className="w-36">
                      <DatePicker
                        value={t.due_date ?? ''}
                        onChange={(v) => setTask(i, { due_date: v || null })}
                        placeholder="Due date"
                        className="h-7 rounded px-2 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Assignees are matched to team members by name; unmatched names are left unassigned.</p>
        </div>
      )}

      {/* Attachments pulled from the email threads */}
      {attachments.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Paperclip size={15} className="text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              Attachments ({attachments.filter((a) => a.include).length} of {attachments.length})
            </h3>
            <span className="text-xs text-muted-foreground">— checked files are saved to the {kind}&apos;s documents</span>
          </div>
          <div className="space-y-2">
            {attachments.map((a, i) => (
              <div key={a.storage_path} className="flex items-center gap-2.5 p-2 rounded-md border border-border/60">
                <input
                  type="checkbox"
                  checked={a.include}
                  onChange={(e) => setAttachment(i, e.target.checked)}
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {formatBytes(a.size_bytes)} · from “{a.thread_subject}”
                    {a.analyzed && <span className="text-emerald-600 dark:text-emerald-400"> · content in report</span>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    viewDocument(
                      `/api/email-ingestion/sessions/${sessionId}/attachment?path=${encodeURIComponent(a.storage_path)}`,
                      a.mime_type
                    )
                  }
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-accent transition-colors shrink-0"
                  title="Open (non-viewable types download instead)"
                >
                  <Eye size={13} /> View
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        <p className="text-[11px] text-muted-foreground mr-auto">
          The full research report is saved to the {kind} as a document.
        </p>
        <button
          type="button"
          onClick={() => setDiscardOpen(true)}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-60"
        >
          <Trash2 size={14} /> Discard
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {submitting ? 'Creating…' : `Create ${kind}`}
        </button>
      </div>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this research package?"
        description="Nothing has been created from it. The package and its staged attachments are removed from Email Intake; the underlying emails are untouched."
        confirmLabel="Discard"
        destructive
        onConfirm={discard}
      />
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${full ? 'sm:col-span-2' : ''}`}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
