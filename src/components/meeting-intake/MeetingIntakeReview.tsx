'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, CheckCircle2, Building2, ListChecks, Users, FolderKanban,
  Lightbulb, Plus, X, Trash2, Search, Target, Sparkles, Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import type { MeetingIntakeExtraction } from '@/lib/ai/prompts/meeting-intake'
import type { ReferencedMatch } from '@/lib/email-ingestion/analyze-meeting'
import type { PartyMatch } from '@/lib/ai/proposal-matching'
import { SECTORS, SECTOR_LABELS, STAGES, STAGE_LABELS } from '@/lib/utils/constants'
import { OPPORTUNITY_TYPES, OPPORTUNITY_TYPE_LABELS, type OpportunityType } from '@/lib/utils/opportunities'

interface RecordOption { id: string; name: string; sector?: string | null }
interface TeamMember { id: string; name: string }
interface Contact {
  id: string
  full_name: string
  company: string | null
  email: string | null
  is_organization: boolean | null
}

interface Props {
  sessionId: string
  extraction: MeetingIntakeExtraction
  referencedMatches: ReferencedMatch[]
  partyMatches: PartyMatch[]
  projects: RecordOption[]
  opportunities: RecordOption[]
  teamMembers: TeamMember[]
  contacts: Contact[]
}

/** Per-attendee type-ahead over the whole contacts directory — link to any
 *  existing contact (not just the AI's guess) so we never create duplicates. */
function ContactPicker({
  contacts, onPick,
}: {
  contacts: Contact[]
  onPick: (c: Contact) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return contacts
      .filter((c) => c.full_name.toLowerCase().includes(s) || (c.company ?? '').toLowerCase().includes(s))
      .slice(0, 8)
  }, [q, contacts])

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        className="h-7 pl-7 pr-2 rounded border border-input bg-background text-xs w-full"
        placeholder="Link to an existing contact…"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-card shadow-lg">
          {options.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(c); setQ(''); setOpen(false) }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent transition-colors"
            >
              {c.is_organization && <Building2 size={12} className="text-muted-foreground shrink-0" />}
              <span className="truncate flex-1">{c.full_name}</span>
              {c.company && <span className="text-[11px] text-muted-foreground truncate max-w-[8rem]">{c.company}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Best-effort resolve of the AI's free-text assignee guess to a real team member.
 * Exact full-name wins; then substring either direction; then a shared name token
 * (e.g. "Eric" → "Eric Tuaone"). Returns the member id or null (Unassigned).
 */
function bestMemberId(guess: string | null | undefined, members: TeamMember[]): string | null {
  const g = guess?.trim().toLowerCase()
  if (!g) return null
  const exact = members.find((m) => m.name.toLowerCase() === g)
  if (exact) return exact.id
  const gTokens = g.split(/\s+/).filter((t) => t.length > 1)
  const scored = members
    .map((m) => {
      const n = m.name.toLowerCase()
      const nTokens = n.split(/\s+/)
      let score = 0
      if (n.includes(g) || g.includes(n)) score = 3
      else if (gTokens[0] && nTokens.includes(gTokens[0])) score = 2
      else if (gTokens.some((t) => nTokens.includes(t))) score = 1
      return { id: m.id, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.id ?? null
}

type Kind = 'project' | 'opportunity'
/** 'company' = Ber Wilson itself (minutes land in the company Knowledge Base). */
type TargetKind = Kind | 'company'
const COMPANY_REF = 'company'

type PersonRow = MeetingIntakeExtraction['attendees'][number] & {
  /** Stable client ref so tasks can point at an attendee promoted to task owner. */
  ref: string
  action: 'create' | 'link' | 'skip'
  existing_party_id: string | null
  existing_name: string | null
  /** Internal person who can OWN follow-up tasks (added to the assignee list). */
  owner: boolean
}

type TaskRow = MeetingIntakeExtraction['tasks'][number] & {
  include: boolean
  target_ref: string | null
  /**
   * Assignee reference: a real team-member id, or `owner:<attendeeRef>` for an
   * attendee being promoted to owner in this same pass, or null for unassigned.
   */
  assignee_id: string | null
  /** Handoff: this task is blocked waiting on someone (same ref space as assignee). */
  waiting_on_id: string | null
  waiting_on_what: string | null
  showBlocked: boolean
}

interface NewFields {
  name: string
  sector: string | null
  stage: string | null
  opp_type: string | null
  location: string | null
  description: string | null
}

interface SelectedTarget {
  ref: string
  kind: TargetKind
  id?: string
  name: string
  isNew: boolean
  fields?: NewFields
}

const inputCls = 'w-full h-9 px-3 rounded-md border border-input bg-background text-sm'
const labelCls = 'label-caps text-muted-foreground'

let refCounter = 0
const nextRef = () => `t${++refCounter}`
let attRefCounter = 0
const nextAttRef = () => `att-new-${++attRefCounter}`

export default function MeetingIntakeReview({
  sessionId, extraction, referencedMatches, partyMatches, projects, opportunities, teamMembers, contacts,
}: Props) {
  const router = useRouter()

  const [title, setTitle] = useState(extraction.title ?? '')
  const [meetingDate, setMeetingDate] = useState(extraction.meeting_date ?? '')
  const [summary, setSummary] = useState(extraction.summary ?? '')
  const [minutes, setMinutes] = useState(extraction.minutes ?? '')
  const [decisionsText, setDecisionsText] = useState((extraction.decisions ?? []).join('\n'))

  const matchByIndex = useMemo(() => {
    const m = new Map<number, ReferencedMatch>()
    referencedMatches.forEach((rm) => m.set(rm.index, rm))
    return m
  }, [referencedMatches])

  // Selected targets — pre-seed from matched referenced records.
  const [targets, setTargets] = useState<SelectedTarget[]>(() => {
    const seeded: SelectedTarget[] = []
    extraction.referenced_records.forEach((rec, i) => {
      const match = matchByIndex.get(i)
      if (match?.matched_id) {
        seeded.push({
          ref: `seed-${i}`,
          kind: rec.kind,
          id: match.matched_id,
          name: match.matched_name ?? rec.name,
          isNew: false,
        })
      }
    })
    return seeded
  })

  // Unmatched referenced records become "suggestions" the user can add.
  const suggestions = useMemo(
    () =>
      extraction.referenced_records
        .map((rec, i) => ({ rec, i }))
        .filter(({ i }) => !matchByIndex.get(i)?.matched_id),
    [extraction.referenced_records, matchByIndex],
  )
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<number>>(new Set())

  const [attendees, setAttendees] = useState<PersonRow[]>(
    extraction.attendees.map((p, i) => {
      const m = partyMatches.find((pm) => pm.extracted_index === i && pm.match_type !== 'none')
      return {
        ...p,
        ref: `att-seed-${i}`,
        action: m ? 'link' : 'create',
        existing_party_id: m?.matched_party_id ?? null,
        existing_name: m?.matched_party_name ?? null,
        owner: false,
      }
    }),
  )

  const [tasks, setTasks] = useState<TaskRow[]>(
    extraction.tasks.map((t) => {
      // Tie a task to a seeded target when its record_hint matches by name.
      const hint = t.record_hint?.trim().toLowerCase()
      const seededRef = hint
        ? extraction.referenced_records.findIndex((rec, i) => matchByIndex.get(i)?.matched_id && rec.name.trim().toLowerCase() === hint)
        : -1
      return {
        ...t,
        include: true,
        target_ref: seededRef >= 0 ? `seed-${seededRef}` : null,
        assignee_id: bestMemberId(t.assignee, teamMembers),
        waiting_on_id: null,
        waiting_on_what: null,
        showBlocked: false,
      }
    }),
  )

  const [addQuery, setAddQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [redrafting, setRedrafting] = useState(false)
  const [addedObjectives, setAddedObjectives] = useState<Set<string>>(new Set())

  const decisionLines = useMemo(
    () => decisionsText.split('\n').map((d) => d.trim()).filter(Boolean),
    [decisionsText],
  )

  /** Re-run the AI over the edited minutes to re-suggest tasks (+ new attendees). */
  async function redraft() {
    const bodyText = [title.trim(), summary.trim(), minutes.trim(), decisionLines.join('\n')].filter(Boolean).join('\n\n')
    if (!bodyText.trim()) { toast.error('Add minutes or a summary first.'); return }
    setRedrafting(true)
    try {
      const res = await fetch('/api/meeting-intake/redraft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: bodyText, title: title.trim() || null, meeting_date: meetingDate || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Re-draft failed.')
      setTasks(
        (data.tasks ?? []).map((t: MeetingIntakeExtraction['tasks'][number]) => ({
          ...t, include: true, target_ref: null,
          assignee_id: bestMemberId(t.assignee, teamMembers),
          waiting_on_id: null, waiting_on_what: null, showBlocked: false,
        })),
      )
      if (Array.isArray(data.attendees)) {
        setAttendees((prev) => {
          const seen = new Set(prev.map((p) => p.name.trim().toLowerCase()))
          const additions = (data.attendees as MeetingIntakeExtraction['attendees'])
            .filter((a) => a.name?.trim() && !seen.has(a.name.trim().toLowerCase()))
            .map((a) => ({ ...a, ref: nextAttRef(), action: 'create' as const, existing_party_id: null, existing_name: null, owner: false }))
          return [...prev, ...additions]
        })
      }
      toast.success('Tasks re-suggested from the minutes. Re-tag their records if needed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-draft failed.')
    } finally {
      setRedrafting(false)
    }
  }

  /** Push a meeting decision onto the steering board as a Soon objective. */
  async function addObjective(text: string) {
    try {
      const res = await fetch('/api/objectives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: text, bucket: 'soon' }),
      })
      if (!res.ok) throw new Error()
      setAddedObjectives((prev) => new Set(prev).add(text))
      toast.success('Added to the steering board (Soon).')
    } catch {
      toast.error('Could not add the objective.')
    }
  }

  const selectedIds = useMemo(() => new Set(targets.filter((t) => !t.isNew).map((t) => t.id)), [targets])

  const addOptions = useMemo(() => {
    const q = addQuery.trim().toLowerCase()
    const proj = projects
      .filter((p) => !selectedIds.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
      .map((p) => ({ ...p, kind: 'project' as const }))
    const opp = opportunities
      .filter((o) => !selectedIds.has(o.id) && (!q || o.name.toLowerCase().includes(q)))
      .map((o) => ({ ...o, kind: 'opportunity' as const }))
    return [...proj, ...opp].slice(0, 12)
  }, [addQuery, projects, opportunities, selectedIds])

  function addExisting(opt: { id: string; name: string; kind: Kind }) {
    setTargets((prev) => [...prev, { ref: nextRef(), kind: opt.kind, id: opt.id, name: opt.name, isNew: false }])
    setAddQuery('')
    setAddOpen(false)
  }

  function addNew(kind: Kind, name = '', description: string | null = null) {
    setTargets((prev) => [
      ...prev,
      {
        ref: nextRef(),
        kind,
        name: name || `New ${kind}`,
        isNew: true,
        fields: { name, sector: null, stage: null, opp_type: null, location: null, description },
      },
    ])
  }

  function addCompany() {
    if (targets.some((t) => t.kind === 'company')) return
    setTargets((prev) => [...prev, { ref: COMPANY_REF, kind: 'company', id: COMPANY_REF, name: 'Ber Wilson', isNew: false }])
  }

  function removeTarget(ref: string) {
    setTargets((prev) => prev.filter((t) => t.ref !== ref))
    setTasks((prev) => prev.map((t) => (t.target_ref === ref ? { ...t, target_ref: null } : t)))
  }

  function setTargetFields(ref: string, patch: Partial<NewFields>) {
    setTargets((prev) =>
      prev.map((t) => (t.ref === ref && t.isNew && t.fields ? { ...t, fields: { ...t.fields, ...patch }, name: patch.name ?? t.name } : t)),
    )
  }

  function setPerson(i: number, patch: Partial<PersonRow>) {
    setAttendees((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }
  function setTask(i: number, patch: Partial<TaskRow>) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }

  /** Link an attendee row to an existing contact from the directory. */
  function linkPerson(i: number, c: Contact) {
    setPerson(i, {
      action: 'link',
      existing_party_id: c.id,
      existing_name: c.full_name,
      name: c.full_name,
      company: c.company ?? undefined,
      email: c.email ?? undefined,
      is_organization: c.is_organization ?? false,
    })
  }
  function unlinkPerson(i: number) {
    setPerson(i, { action: 'create', existing_party_id: null, existing_name: null })
  }
  function addAttendee() {
    setAttendees((prev) => [
      ...prev,
      {
        ref: nextAttRef(), name: '', email: null, company: null, title: null, role: null,
        is_organization: false, action: 'create', existing_party_id: null, existing_name: null, owner: false,
      },
    ])
  }
  function removePerson(i: number) {
    const removed = attendees[i]
    setAttendees((prev) => prev.filter((_, idx) => idx !== i))
    // Clear any task pointing at this attendee-as-owner.
    if (removed) {
      const ref = `owner:${removed.ref}`
      setTasks((prev) => prev.map((t) => (t.assignee_id === ref ? { ...t, assignee_id: null } : t)))
    }
  }

  // Assignee options: existing owners + attendees promoted to owner in this pass.
  const assigneeOptions = useMemo(() => {
    const opts = teamMembers.map((m) => ({ value: m.id, label: m.name }))
    attendees.forEach((p) => {
      if (p.owner && p.action !== 'skip' && !p.is_organization) {
        opts.push({ value: `owner:${p.ref}`, label: `${p.name.trim() || 'New person'} (new owner)` })
      }
    })
    return opts
  }, [teamMembers, attendees])
  const assigneeValues = useMemo(() => new Set(assigneeOptions.map((o) => o.value)), [assigneeOptions])
  // Display/submit value — drop a stale ref (owner un-toggled/removed) to Unassigned.
  const effectiveAssignee = (t: TaskRow) => (t.assignee_id && assigneeValues.has(t.assignee_id) ? t.assignee_id : '')

  async function discard() {
    try {
      const res = await fetch(`/api/email-ingestion/sessions/${sessionId}`, { method: 'PATCH' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not discard the meeting.')
      }
      toast.success('Meeting notes discarded.')
      router.push('/intake?tab=meeting')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not discard the meeting.')
    }
  }

  async function confirm() {
    const badNew = targets.find((t) => t.isNew && !t.fields?.name.trim())
    if (badNew) {
      setError('Every new record needs a name.')
      return
    }

    const decisions = decisionsText.split('\n').map((d) => d.trim()).filter(Boolean)

    const targetPayload = targets.map((t) => {
      if (t.kind === 'company') return { ref: t.ref, kind: 'company' as const, id: COMPANY_REF, new_fields: null }
      if (!t.isNew) return { ref: t.ref, kind: t.kind, id: t.id, new_fields: null }
      const f = t.fields!
      const new_fields: Record<string, unknown> =
        t.kind === 'project'
          ? { name: f.name, sector: f.sector, stage: f.stage, location: f.location, description: f.description }
          : { name: f.name, opp_type: f.opp_type, sector: f.sector, location: f.location, objective: f.description }
      return { ref: t.ref, kind: t.kind, id: null, new_fields }
    })

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/meeting-intake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          meeting: { title: title.trim() || null, date: meetingDate || null, summary: summary.trim() || null, minutes: minutes.trim() || null, decisions },
          targets: targetPayload,
          attendee_actions: attendees.map((p) => ({
            ref: p.ref, name: p.name, email: p.email, company: p.company, title: p.title,
            role: p.role, is_organization: p.is_organization,
            action: p.action, existing_party_id: p.existing_party_id, owner: p.owner,
          })),
          task_actions: tasks.map((t) => ({
            title: t.title, what: t.what, why: t.why, how: t.how,
            assignee: t.assignee, assignee_ref: effectiveAssignee(t) || null,
            due_date: t.due_date, include: t.include, target_ref: t.target_ref,
            waiting_on_ref: t.waiting_on_id && assigneeValues.has(t.waiting_on_id) ? t.waiting_on_id : null,
            waiting_on_what: t.waiting_on_what,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Processing failed.')
      toast.success(`Updated ${data.records_updated} record${data.records_updated === 1 ? '' : 's'} · ${data.tasks_created} task${data.tasks_created === 1 ? '' : 's'} created.`)
      if (data.redirect) router.push(data.redirect)
      else { router.push('/intake?tab=meeting'); router.refresh() }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed.')
      setSubmitting(false)
    }
  }

  const targetLabel = (t: SelectedTarget) => (t.isNew ? `New: ${t.fields?.name || t.name}` : t.name)

  return (
    <div className="space-y-5">
      {/* Meeting header */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 space-y-1">
            <label className={labelCls}>Meeting title</label>
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Leadership sync" />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Date</label>
            <DatePicker value={meetingDate} onChange={setMeetingDate} placeholder="Meeting date" />
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Summary</label>
          <textarea className={`${inputCls} h-auto py-2`} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Minutes</label>
          <textarea className={`${inputCls} h-auto py-2 font-mono leading-relaxed`} rows={6} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Narrative record of the meeting…" />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Decisions <span className="normal-case font-normal text-muted-foreground">(one per line)</span></label>
          <textarea className={`${inputCls} h-auto py-2`} rows={3} value={decisionsText} onChange={(e) => setDecisionsText(e.target.value)} placeholder="Key decisions reached…" />
          {decisionLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] text-muted-foreground">Push to steering board:</span>
              {decisionLines.map((d, i) => {
                const added = addedObjectives.has(d)
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={added}
                    onClick={() => addObjective(d)}
                    className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] transition-colors ${added ? 'border-emerald-300 dark:border-emerald-700/60 text-emerald-700 dark:text-emerald-300' : 'border-dashed border-input hover:bg-accent'}`}
                    title={added ? 'Added as a Soon objective' : `Add "${d}" to the steering board as a Soon objective`}
                  >
                    {added ? <CheckCircle2 size={11} /> : <Target size={11} />}
                    <span className="max-w-[16rem] truncate">{d}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Target records */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FolderKanban size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Records to update ({targets.length})</h3>
          <span className="text-xs text-muted-foreground">— optional; leave empty for a pure executive-team meeting (tasks go to the general list)</span>
        </div>

        {targets.length > 0 && (
          <div className="space-y-2">
            {targets.map((t) => {
              const taskCount = tasks.filter((tk) => tk.include && tk.target_ref === t.ref).length
              return (
                <div key={t.ref} className="rounded-md border border-border/60 p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    {t.kind === 'project' ? <FolderKanban size={13} className="text-muted-foreground shrink-0" /> : t.kind === 'company' ? <Building2 size={13} className="text-muted-foreground shrink-0" /> : <Lightbulb size={13} className="text-muted-foreground shrink-0" />}
                    <span className="text-sm font-medium truncate flex-1">{targetLabel(t)}</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">{t.kind === 'company' ? 'company' : t.kind}{taskCount > 0 ? ` · ${taskCount} task${taskCount === 1 ? '' : 's'}` : ''}</span>
                    <button type="button" onClick={() => removeTarget(t.ref)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remove">
                      <X size={15} />
                    </button>
                  </div>
                  {t.isNew && t.fields && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-5">
                      <input className={`${inputCls} h-8`} placeholder="Name" value={t.fields.name} onChange={(e) => setTargetFields(t.ref, { name: e.target.value })} />
                      {t.kind === 'project' ? (
                        <select className={`${inputCls} h-8`} value={t.fields.sector ?? 'real_estate'} onChange={(e) => setTargetFields(t.ref, { sector: e.target.value })}>
                          {SECTORS.map((s) => <option key={s} value={s}>{SECTOR_LABELS[s]}</option>)}
                        </select>
                      ) : (
                        <select className={`${inputCls} h-8`} value={t.fields.opp_type ?? 'other'} onChange={(e) => setTargetFields(t.ref, { opp_type: e.target.value })}>
                          {OPPORTUNITY_TYPES.map((o) => <option key={o} value={o}>{OPPORTUNITY_TYPE_LABELS[o as OpportunityType]}</option>)}
                        </select>
                      )}
                      {t.kind === 'project' && (
                        <select className={`${inputCls} h-8`} value={t.fields.stage ?? 'pursuit'} onChange={(e) => setTargetFields(t.ref, { stage: e.target.value })}>
                          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                        </select>
                      )}
                      <input className={`${inputCls} h-8`} placeholder="Location" value={t.fields.location ?? ''} onChange={(e) => setTargetFields(t.ref, { location: e.target.value || null })} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Unmatched suggestions from the meeting */}
        {suggestions.filter((s) => !dismissedSuggestions.has(s.i)).length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Mentioned, not matched:</span>
            {suggestions.filter((s) => !dismissedSuggestions.has(s.i)).map(({ rec, i }) => (
              <button
                key={i}
                type="button"
                onClick={() => { addNew(rec.kind, rec.name, rec.note); setDismissedSuggestions((prev) => new Set(prev).add(i)) }}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-dashed border-input text-xs hover:bg-accent transition-colors"
                title={`Create "${rec.name}" as a new ${rec.kind}`}
              >
                <Plus size={12} /> {rec.name} <span className="text-muted-foreground">({rec.kind})</span>
              </button>
            ))}
          </div>
        )}

        {/* Add record controls */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="relative flex-1 min-w-[12rem]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className={`${inputCls} h-8 pl-8`}
              placeholder="Add an existing project or opportunity…"
              value={addQuery}
              onFocus={() => setAddOpen(true)}
              onChange={(e) => { setAddQuery(e.target.value); setAddOpen(true) }}
              onBlur={() => setTimeout(() => setAddOpen(false), 150)}
            />
            {addOpen && addOptions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-card shadow-lg">
                {addOptions.map((opt) => (
                  <button
                    key={`${opt.kind}-${opt.id}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); addExisting(opt) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    {opt.kind === 'project' ? <FolderKanban size={13} className="text-muted-foreground" /> : <Lightbulb size={13} className="text-muted-foreground" />}
                    <span className="truncate flex-1">{opt.name}</span>
                    <span className="text-[11px] text-muted-foreground">{opt.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!targets.some((t) => t.kind === 'company') && (
            <button type="button" onClick={addCompany} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-accent transition-colors" title="Tag the meeting to Ber Wilson — minutes are saved to the company Knowledge Base">
              <Building2 size={13} /> Ber Wilson (company)
            </button>
          )}
          <button type="button" onClick={() => addNew('project')} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-accent transition-colors">
            <Plus size={13} /> New project
          </button>
          <button type="button" onClick={() => addNew('opportunity')} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-accent transition-colors">
            <Plus size={13} /> New opportunity
          </button>
        </div>
      </div>

      {/* Attendees */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Attendees ({attendees.length})</h3>
          <span className="text-xs text-muted-foreground">— link an existing contact to avoid duplicates; edit before creating</span>
        </div>
        {attendees.length > 0 && (
          <div className="space-y-2">
            {attendees.map((p, i) => (
              <div key={p.ref} className={`p-2.5 rounded-md border border-border/60 space-y-2 ${p.action === 'skip' ? 'opacity-60' : ''}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input className="h-8 px-2 rounded border border-input bg-background text-sm" placeholder="Full name" value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} />
                  <input className="h-8 px-2 rounded border border-input bg-background text-xs" placeholder="Role (e.g. GC principal)" value={p.role ?? ''} onChange={(e) => setPerson(i, { role: e.target.value || null })} />
                  <input className="h-8 px-2 rounded border border-input bg-background text-xs" placeholder="Company" value={p.company ?? ''} onChange={(e) => setPerson(i, { company: e.target.value || null })} />
                  <input className="h-8 px-2 rounded border border-input bg-background text-xs" placeholder="Email" value={p.email ?? ''} onChange={(e) => setPerson(i, { email: e.target.value || null })} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[12rem]">
                    {p.existing_party_id ? (
                      <span className="inline-flex items-center gap-1.5 h-7 px-2 rounded border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 text-xs text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 size={12} /> Linked: {p.existing_name}
                        <button type="button" onClick={() => unlinkPerson(i)} className="ml-0.5 hover:text-destructive" title="Unlink"><X size={12} /></button>
                      </span>
                    ) : (
                      <ContactPicker contacts={contacts} onPick={(c) => linkPerson(i, c)} />
                    )}
                  </div>
                  <select
                    className="h-7 px-2 rounded border border-input bg-background text-xs shrink-0"
                    value={p.action}
                    onChange={(e) => setPerson(i, { action: e.target.value as PersonRow['action'] })}
                  >
                    {p.existing_party_id && <option value="link">Link existing</option>}
                    <option value="create">Create new</option>
                    <option value="skip">Skip</option>
                  </select>
                  {!p.is_organization && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground shrink-0" title="Add this person as a task owner — they'll appear in the assignee list">
                      <input type="checkbox" checked={p.owner} onChange={(e) => setPerson(i, { owner: e.target.checked })} />
                      Can own tasks
                    </label>
                  )}
                  <label className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0" title="This attendee is an organization, not a person">
                    <input type="checkbox" checked={p.is_organization} onChange={(e) => setPerson(i, { is_organization: e.target.checked, owner: e.target.checked ? false : p.owner })} />
                    Org
                  </label>
                  <button type="button" onClick={() => removePerson(i)} className="text-muted-foreground hover:text-destructive shrink-0" title="Remove attendee"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={addAttendee} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-accent transition-colors">
          <Plus size={13} /> Add attendee
        </button>
      </div>

      {/* Tasks */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Follow-up tasks ({tasks.filter((t) => t.include).length} of {tasks.length})</h3>
          <button
            type="button"
            onClick={redraft}
            disabled={redrafting}
            className="ml-auto inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-accent transition-colors disabled:opacity-60"
            title="Re-run Ber AI over your edited minutes to re-suggest tasks"
          >
            {redrafting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {redrafting ? 'Thinking…' : 'Re-suggest from minutes'}
          </button>
        </div>
        {tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((t, i) => (
              <div key={i} className="flex items-start gap-2.5 p-2 rounded-md border border-border/60">
                <input type="checkbox" checked={t.include} onChange={(e) => setTask(i, { include: e.target.checked })} className="mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-1">
                  <input className={`${inputCls} h-8`} value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="h-7 px-2 rounded border border-input bg-background text-xs w-36"
                      value={effectiveAssignee(t)}
                      onChange={(e) => setTask(i, { assignee_id: e.target.value || null })}
                      title="Assign to a team member"
                    >
                      <option value="">Unassigned</option>
                      {assigneeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <div className="w-36">
                      <DatePicker value={t.due_date ?? ''} onChange={(v) => setTask(i, { due_date: v || null })} placeholder="Due date" className="h-7 rounded px-2 text-xs" />
                    </div>
                    <select className="h-7 px-2 rounded border border-input bg-background text-xs" value={t.target_ref ?? ''} onChange={(e) => setTask(i, { target_ref: e.target.value || null })}>
                      <option value="">No record (executive list)</option>
                      {targets.map((tg) => <option key={tg.ref} value={tg.ref}>{targetLabel(tg)}</option>)}
                    </select>
                    {!t.showBlocked && !t.waiting_on_id && (
                      <button type="button" onClick={() => setTask(i, { showBlocked: true })} className="inline-flex items-center gap-1 h-7 px-2 rounded border border-dashed border-input text-[11px] text-muted-foreground hover:bg-accent transition-colors" title="Mark this task as waiting on someone">
                        <Clock size={11} /> Blocked?
                      </button>
                    )}
                  </div>
                  {(t.showBlocked || t.waiting_on_id) && (
                    <div className="flex flex-wrap items-center gap-2 pl-0.5">
                      <span className="text-[11px] text-amber-600 dark:text-amber-400 inline-flex items-center gap-1"><Clock size={11} /> Waiting on</span>
                      <select
                        className="h-7 px-2 rounded border border-input bg-background text-xs w-32"
                        value={t.waiting_on_id && assigneeValues.has(t.waiting_on_id) ? t.waiting_on_id : ''}
                        onChange={(e) => setTask(i, { waiting_on_id: e.target.value || null })}
                      >
                        <option value="">— who</option>
                        {assigneeOptions.filter((o) => o.value !== effectiveAssignee(t)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input className="h-7 px-2 rounded border border-input bg-background text-xs flex-1 min-w-[8rem]" placeholder="for what (e.g. the survey)" value={t.waiting_on_what ?? ''} onChange={(e) => setTask(i, { waiting_on_what: e.target.value || null })} />
                      <button type="button" onClick={() => setTask(i, { showBlocked: false, waiting_on_id: null, waiting_on_what: null })} className="text-muted-foreground hover:text-destructive" title="Clear"><X size={13} /></button>
                    </div>
                  )}
                  {!effectiveAssignee(t) && t.assignee && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      AI suggested “{t.assignee}” — not a team owner. Pick one, or tick “Can own tasks” on that attendee.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No tasks yet — edit the minutes and click “Re-suggest from minutes”, or process without tasks.</p>
        )}
        <p className="text-[11px] text-muted-foreground">Ber AI pre-assigns each task to the team member it inferred; adjust the owner, the record, or a blocker before processing.</p>
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        <p className="text-[11px] text-muted-foreground mr-auto">
          The meeting minutes are saved to each record as a document and indexed for Ber AI.
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
          {submitting ? 'Processing…' : 'Process meeting'}
        </button>
      </div>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard these meeting notes?"
        description="Nothing has been created from them. The notes are removed from Intake."
        confirmLabel="Discard"
        destructive
        onConfirm={discard}
      />
    </div>
  )
}
