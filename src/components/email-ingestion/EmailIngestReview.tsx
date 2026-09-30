'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, Building2, Lightbulb, FolderKanban, User, ListChecks, Paperclip, Eye, Trash2, Link2, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import FitAssessmentCard from '@/components/proposals/FitAssessmentCard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { viewDocument } from '@/lib/utils/document-links'
import type { StagedAttachment } from '@/lib/email-ingestion/attachments'
import type { EmailIntakeExtraction } from '@/lib/ai/prompts/email-intake'
import type { PartyMatch } from '@/lib/ai/proposal-matching'
import type { FitAssessment } from '@/lib/ai/fit-assessment'
import { recordFieldsFor } from '@/lib/email-ingestion/defaults'
import { SECTORS, SECTOR_LABELS, STAGES, STAGE_LABELS } from '@/lib/utils/constants'
import { formatBytes } from '@/lib/utils/format'
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  type OpportunityType,
} from '@/lib/utils/opportunities'

export interface RecordOption {
  id: string
  name: string
  location?: string | null
  stage?: string | null
  status?: string | null
}

interface Props {
  sessionId: string
  extraction: EmailIntakeExtraction
  partyMatches: PartyMatch[]
  fit: FitAssessment | null
  label: string | null
  stagedAttachments: StagedAttachment[]
  /** Every project this package could be sent to instead of creating one. */
  projects: RecordOption[]
  /** Every open opportunity, same purpose. */
  opportunities: RecordOption[]
  /** The matcher's own candidate projects for this package (jsonb). */
  matchCandidates?: unknown
  /**
   * Ber AI's own recommendation for this session. The page selected it and
   * then dropped it, so the verdict you were shown on /decide vanished at
   * exactly the moment you needed it — leaving a 25-input form and no reason
   * why you were looking at it.
   */
  predecision?: unknown
}

interface Predecision {
  disposition?: string
  reason?: string | null
  headline?: string | null
  merge_target_name?: string | null
}

function readPredecision(raw: unknown): Predecision | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Predecision
  return o.disposition ? o : null
}

type PersonRow = EmailIntakeExtraction['people'][number] & {
  action: 'create' | 'link' | 'skip'
  existing_party_id: string | null
  existing_name: string | null
}

type TaskRow = EmailIntakeExtraction['tasks'][number] & { include: boolean }

const inputCls = 'w-full h-9 px-3 rounded-md border border-input bg-background text-sm'
const labelCls = 'label-caps text-muted-foreground'

/** Where this package lands: a new record, or one that already exists. */
type Destination =
  | { mode: 'create' }
  | { mode: 'existing'; kind: 'opportunity' | 'project'; id: string; name: string }

/**
 * Names the matcher already put forward for this package, in the order it
 * ranked them. Read tolerantly — `match_candidates` is jsonb, predates the
 * generated types, and holds a different shape per intake kind.
 */
function readCandidateNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const name = [o.project_name, o.opportunity_name, o.name]
      .find((v) => typeof v === 'string' && v.trim())
    if (typeof name === 'string') seen.add(name.trim())
  }
  return [...seen].slice(0, 6)
}

export default function EmailIngestReview({
  sessionId, extraction, partyMatches, fit, label, stagedAttachments, predecision,
  projects, opportunities, matchCandidates,
}: Props) {
  const pre = readPredecision(predecision)
  const router = useRouter()
  const [kind, setKind] = useState<'opportunity' | 'project'>(extraction.suggested_record)
  const [destination, setDestination] = useState<Destination>({ mode: 'create' })
  const [recordQuery, setRecordQuery] = useState('')
  const [recordOpen, setRecordOpen] = useState(false)
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

  /** One flat, searchable list of every record this could be sent to. */
  const allRecords = useMemo(
    () => [
      ...projects.map((p) => ({ ...p, kind: 'project' as const })),
      ...opportunities.map((o) => ({ ...o, kind: 'opportunity' as const })),
    ],
    [projects, opportunities]
  )

  /**
   * Records Ber AI already thinks this is about — the merge target it named,
   * then whatever the matcher scored. Shown as one-click chips because the
   * common case is that the reader agrees with it, and making them retype a
   * name the system already knows is the work we are trying to remove.
   */
  const suggested = useMemo(() => {
    const wanted = [pre?.merge_target_name, ...readCandidateNames(matchCandidates)]
      .filter((n): n is string => !!n && !!n.trim())
      .map((n) => n.trim().toLowerCase())
    const out: typeof allRecords = []
    for (const w of wanted) {
      const hit = allRecords.find((r) => r.name.trim().toLowerCase() === w)
      if (hit && !out.some((o) => o.id === hit.id)) out.push(hit)
    }
    return out
  }, [pre?.merge_target_name, matchCandidates, allRecords])

  const recordOptions = useMemo(() => {
    const q = recordQuery.trim().toLowerCase()
    if (!q) return allRecords.slice(0, 12)
    return allRecords
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.location ?? '').toLowerCase().includes(q)
      )
      .slice(0, 12)
  }, [recordQuery, allRecords])

  function pickExisting(r: { id: string; name: string; kind: 'project' | 'opportunity' }) {
    setDestination({ mode: 'existing', kind: r.kind, id: r.id, name: r.name })
    // switchKind, not setKind: it carries the shared facts across into the
    // target kind's blanks. Attaching an opportunity-shaped extraction to a
    // PROJECT with a bare setKind would hand the fill pass an empty project
    // form, and the blank columns it was meant to fill would stay blank.
    switchKind(r.kind)
    setRecordQuery('')
    setRecordOpen(false)
    setError(null)
  }

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
      router.push('/intake')
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
    // Built by the same function the Decide queue's Accept button uses, so a
    // field added to the record can never reach one path and not the other.
    const record_fields = recordFieldsFor(kind, { ...extraction, project: proj, opportunity: opp })

    // A name is required to CREATE a record and irrelevant when attaching to
    // one — the target already has a name, and attaching never renames it.
    // Four of the 81 staged sessions have no name for their suggested kind
    // (measured 2026-09-24); for those, attaching is now the way through.
    if (
      destination.mode === 'create' &&
      (!record_fields.name || !String(record_fields.name).trim())
    ) {
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
          target_record:
            destination.mode === 'existing'
              ? { kind: destination.kind, id: destination.id }
              : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Confirmation failed.')

      // Say what landed. A row that simply disappears gives no evidence that
      // anything reached the record — and on an attach the whole question the
      // reader has is whether their existing project actually changed.
      if (data.attached) {
        const parts: string[] = []
        if (data.fields_filled?.length) parts.push(`${data.fields_filled.length} blank field${data.fields_filled.length === 1 ? '' : 's'} filled`)
        if (data.tasks_created) parts.push(`${data.tasks_created} task${data.tasks_created === 1 ? '' : 's'}`)
        if (data.documents_created) parts.push(`${data.documents_created} document${data.documents_created === 1 ? '' : 's'}`)
        if (data.parties_created) parts.push(`${data.parties_created} ${data.parties_created === 1 ? 'person' : 'people'}`)
        const targetName = destination.mode === 'existing' ? destination.name : 'the record'
        toast.success(`Added to ${data.record_name ?? targetName}`, {
          description: parts.length ? parts.join(' · ') : 'The research report is on the record.',
        })
      }
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

      {pre && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-1">
          <p className={labelCls}>Ber AI recommends</p>
          <p className="text-sm font-medium capitalize">
            {pre.disposition}
            {pre.merge_target_name ? ` into ${pre.merge_target_name}` : ''}
          </p>
          {pre.headline && <p className="text-sm text-foreground">{pre.headline}</p>}
          {pre.reason && <p className="text-xs text-muted-foreground">{pre.reason}</p>}
        </div>
      )}

      {fit && <FitAssessmentCard fit={fit} />}

      {extraction.summary && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-foreground leading-relaxed">{extraction.summary}</p>
        </div>
      )}

      {/* ── Where this package lands ──────────────────────────────────────────
          The queue proposes one record per CLUSTER of correspondence, not one
          per deal, so a long-running programme arrives as several proposals.
          Without a way to say "this is the Myton project you already have",
          agreeing with each of them created a second, third and eighth Myton.
          Attaching is therefore a first-class destination, not a special case. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={labelCls}>Send to</span>
          <div className="inline-flex rounded-md border border-input overflow-hidden">
            <button
              type="button"
              onClick={() => { setDestination({ mode: 'create' }); switchKind('opportunity') }}
              className={`inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium transition-colors ${
                destination.mode === 'create' && kind === 'opportunity'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              }`}
            >
              <Lightbulb size={14} /> New opportunity
            </button>
            <button
              type="button"
              onClick={() => { setDestination({ mode: 'create' }); switchKind('project') }}
              className={`inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium transition-colors border-l border-input ${
                destination.mode === 'create' && kind === 'project'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              }`}
            >
              <FolderKanban size={14} /> New project
            </button>
            <button
              type="button"
              onClick={() => { setRecordOpen(true) }}
              className={`inline-flex items-center gap-1.5 h-8 px-3 text-sm font-medium transition-colors border-l border-input ${
                destination.mode === 'existing'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              }`}
            >
              <Link2 size={14} /> Existing record
            </button>
          </div>
        </div>

        {destination.mode === 'existing' ? (
          <div className="rounded-lg border border-indigo-300 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-950/30 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              {destination.kind === 'project' ? (
                <FolderKanban size={15} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              ) : (
                <Lightbulb size={15} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              )}
              <p className="text-sm font-medium truncate flex-1">{destination.name}</p>
              <button
                type="button"
                onClick={() => { setDestination({ mode: 'create' }); setRecordOpen(true) }}
                className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
              >
                Change
              </button>
              <button
                type="button"
                onClick={() => { setDestination({ mode: 'create' }); setRecordOpen(false) }}
                title="Create a new record instead"
                className="inline-flex items-center justify-center size-6 rounded hover:bg-accent text-muted-foreground shrink-0"
              >
                <X size={13} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Nothing new is created. The report, the people, the tasks and the checked
              attachments go onto this {destination.kind}, and its conversation is linked so later
              replies post here too. Blank fields are filled from the correspondence —
              anything already set is left alone.
            </p>
          </div>
        ) : (
          recordOpen && (
            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
              {suggested.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Sparkles size={11} /> Ber AI matched this package to
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggested.map((r) => (
                      <button
                        key={`${r.kind}-${r.id}`}
                        type="button"
                        onClick={() => pickExisting(r)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-input bg-background text-xs hover:bg-accent transition-colors"
                      >
                        {r.kind === 'project' ? <FolderKanban size={11} /> : <Lightbulb size={11} />}
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-input bg-background text-sm"
                  placeholder="Search projects and opportunities by name or location…"
                  value={recordQuery}
                  onChange={(e) => setRecordQuery(e.target.value)}
                />
              </div>
              <div className="max-h-60 overflow-auto rounded-md border border-border divide-y divide-border">
                {recordOptions.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No record matches “{recordQuery}”.
                  </p>
                ) : (
                  recordOptions.map((r) => (
                    <button
                      key={`${r.kind}-${r.id}`}
                      type="button"
                      onClick={() => pickExisting(r)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      {r.kind === 'project' ? (
                        <FolderKanban size={13} className="text-muted-foreground shrink-0" />
                      ) : (
                        <Lightbulb size={13} className="text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm truncate flex-1">{r.name}</span>
                      {r.location && (
                        <span className="text-[11px] text-muted-foreground truncate max-w-[10rem]">{r.location}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* Record fields */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {destination.mode === 'existing' && (
          <p className="text-xs text-muted-foreground">
            What the correspondence says. Used only to fill columns that are still blank on{' '}
            <span className="font-medium text-foreground">{destination.name}</span> — the name and
            anything already set stay as they are.
          </p>
        )}
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

      {/* Attachments pulled from the email threads.
          Rendered even when empty, deliberately. Hiding the section made "the
          run found no files" indistinguishable from "staging silently dropped
          every file", which is exactly how a MIME misclassification went
          unnoticed while it discarded every attachment sent from Gmail. An
          empty list a reader can disbelieve is worth more than no list. */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Paperclip size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">
            Attachments{attachments.length > 0 && ` (${attachments.filter((a) => a.include).length} of ${attachments.length})`}
          </h3>
          {attachments.length > 0 && (
            <span className="text-xs text-muted-foreground">— checked files are saved to the {kind}&apos;s documents</span>
          )}
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No files were found on the email threads this report was built from. If you know a
            document was sent, it may sit behind a portal link rather than being attached, or be
            larger than the 25 MB staging limit — the report notes anything it skipped.
          </p>
        ) : (
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
        )}
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        <p className="text-[11px] text-muted-foreground mr-auto">
          {destination.mode === 'existing'
            ? `The full research report is saved to ${destination.name} as a document.`
            : `The full research report is saved to the ${kind} as a document.`}
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
          {submitting ? (
            <Loader2 size={15} className="animate-spin" />
          ) : destination.mode === 'existing' ? (
            <Link2 size={15} />
          ) : (
            <CheckCircle2 size={15} />
          )}
          {submitting
            ? destination.mode === 'existing' ? 'Adding…' : 'Creating…'
            : destination.mode === 'existing'
              ? <span className="truncate max-w-[16rem]">Add to {destination.name}</span>
              : `Create ${kind}`}
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


function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${full ? 'sm:col-span-2' : ''}`}>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}
