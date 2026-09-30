'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Paperclip, Download, Mail, Phone, Building2, MapPin, Calendar,
  FolderKanban, Lightbulb, Factory, Send, Archive, Undo2, ExternalLink,
  FolderOpen, Check, Minus, Link2, Search, X,
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import FitAssessmentCard from '@/components/proposals/FitAssessmentCard'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { viewDocument, downloadDocument } from '@/lib/utils/document-links'
import { formatValue, formatDate, bidDueLabel, bidDueColor } from '@/lib/utils/constants'
import {
  categoryLookup, promoteTargetFor, STATUS_BADGE, STATUS_LABELS, gmailThreadUrl,
  type LeadCategoryView,
} from '@/lib/utils/leads'
import { DEAL_CHECKLIST, CHECKLIST_BY_KEY } from '@/lib/deal-intake/checklist'
import type { LeadRow, LeadNote, IntakeAnswer } from '@/lib/leads/db'

type PromoteTarget = 'project' | 'opportunity' | 'steel' | 'attach'

/** An existing record a lead can be attached to instead of creating a new one. */
export interface AttachOption {
  id: string
  name: string
  kind: 'project' | 'opportunity'
}

/**
 * Type-ahead over the records a lead could already belong to.
 *
 * The same shape as the meeting review's record picker, and deliberately a
 * filter over a list already in memory rather than a search endpoint — fifteen
 * projects is not a query, and a picker that has to round-trip is one nobody
 * waits for.
 */
function RecordPicker({
  options, onPick,
}: {
  options: AttachOption[]
  onPick: (o: AttachOption) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return options.slice(0, 8)
    return options.filter((o) => o.name.toLowerCase().includes(needle)).slice(0, 8)
  }, [q, options])

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        placeholder="Find the project or opportunity…"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
          {matches.map((o) => (
            <button
              key={`${o.kind}-${o.id}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onPick(o) }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent outline-none focus-visible:bg-accent"
            >
              {o.kind === 'project'
                ? <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" />
                : <Lightbulb className="size-3.5 shrink-0 text-muted-foreground" />}
              <span className="flex-1 truncate">{o.name}</span>
              <span className="text-[11px] text-muted-foreground">{o.kind}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Fact({ icon: Icon, label, children }: {
  icon: typeof Mail
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="label-caps text-muted-foreground">{label}</p>
        <div className="break-words">{children}</div>
      </div>
    </div>
  )
}

/**
 * The intake checklist, answered and unanswered.
 *
 * Shown instead of the raw key_facts bullets for a web-form lead: the gaps are
 * the point. Whether the sponsor has site control and a capital stack decides
 * whether this is worth an hour, and a list that only shows what was filled in
 * hides exactly the half that matters.
 */
function IntakeChecklist({ answers }: { answers: Record<string, IntakeAnswer> }) {
  const rows = DEAL_CHECKLIST.map((spec) => ({
    spec,
    answer: answers[spec.key]?.provided ? answers[spec.key]?.answer ?? null : null,
  }))

  // Anything the form sent under a key this build does not know about — usually
  // a question the form gained first. Visible rather than silently dropped.
  const extra = Object.entries(answers).filter(
    ([key, a]) => !CHECKLIST_BY_KEY[key] && a?.answer?.trim()
  )

  if (rows.length === 0 && extra.length === 0) return null

  const answered = rows.filter((r) => r.answer).length
  const missingRequired = rows.filter((r) => !r.answer && r.spec.required).length

  return (
    <div className="space-y-1">
      <p className="label-caps text-muted-foreground">
        Diligence checklist ({answered} of {rows.length} answered
        {missingRequired > 0 ? `, ${missingRequired} required missing` : ''})
      </p>
      <div className="space-y-1">
        {rows.map(({ spec, answer }) => (
          <div key={spec.key} className="rounded-md bg-muted/30 px-2 py-1.5 text-sm">
            <div className="flex items-start gap-2">
              {answer ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
              ) : (
                <Minus
                  className={`mt-0.5 size-3.5 shrink-0 ${
                    spec.required ? 'text-amber-600' : 'text-muted-foreground'
                  }`}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className={answer ? '' : 'text-muted-foreground'}>{spec.label}</p>
                {answer ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground break-words">
                    {answer}
                  </p>
                ) : (
                  spec.required && (
                    <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                      Required — not provided
                    </p>
                  )
                )}
              </div>
            </div>
          </div>
        ))}
        {extra.map(([key, a]) => (
          <div key={key} className="rounded-md bg-muted/30 px-2 py-1.5 text-sm">
            <p className="text-muted-foreground">{key}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground break-words">
              {a.answer}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="label-caps text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-sm leading-relaxed flex gap-1.5">
            <span className="select-none text-muted-foreground">•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function LeadDetailSheet({
  lead,
  open,
  onOpenChange,
  onChanged,
  siblings = [],
  onSelectSibling,
  notes = [],
  attachOptions = [],
  categories = [],
}: {
  lead: LeadRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: (lead: LeadRow | null) => void
  /**
   * Other opportunities described in the SAME email.
   *
   * A referrer who lists four deals in one message produces four leads, and in
   * a queue sorted by bid date they can sit pages apart looking unrelated. This
   * is what says they came in together.
   */
  siblings?: LeadRow[]
  onSelectSibling?: (lead: LeadRow) => void
  /** Activity written when later mail landed on this lead's thread. */
  notes?: LeadNote[]
  /** Existing records this lead can be attached to rather than duplicating. */
  attachOptions?: AttachOption[]
  /** The routing registry, in display order. */
  categories?: LeadCategoryView[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<PromoteTarget | null>(null)
  // The record picked for an 'attach'. Also what the confirm dialog names, so
  // the reader is told which record is about to receive the files.
  const [attachTo, setAttachTo] = useState<AttachOption | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  if (!lead) return null

  const isOpenStatus = lead.status === 'new' || lead.status === 'reviewing'

  const cat = categoryLookup(categories)
  const category = cat.get(lead.route)
  // What this lead's OWN category says it becomes. The buttons follow this
  // rather than offering all five destinations at once: the route is the answer
  // the triage pass exists to produce, and asking again discards it.
  const recommended = promoteTargetFor(category?.destination)

  async function patch(body: Record<string, unknown>, message: string) {
    if (!lead) return
    setBusy('patch')
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Update failed.')
      onChanged(json.lead as LeadRow)
      toast.success(message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed.')
    } finally {
      setBusy(null)
    }
  }

  async function promote(target: PromoteTarget) {
    if (!lead) return
    if (target === 'attach' && !attachTo) {
      toast.error('Pick the record to attach this lead to.')
      return
    }
    setBusy(target)
    try {
      const res = await fetch(`/api/leads/${lead.id}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          target === 'attach'
            ? { target, attach_to: { kind: attachTo!.kind, id: attachTo!.id } }
            : { target }
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Promotion failed.')

      // `recordKind` rather than `target`: an attach lands on whichever kind the
      // picked record is, which is not knowable from the button that was pressed.
      const kind: string = json.recordKind ?? target
      const where =
        kind === 'project' ? 'projects' : kind === 'opportunity' ? 'opportunities' : 'steel'
      // Say what actually landed. A promotion that pulled in 14 documents and
      // seeded a diligence checklist deserves more than "Created".
      const parts = [`${json.documentsCopied} file(s) attached`]
      if (json.diligenceCreated > 0) parts.push(`${json.diligenceCreated} diligence item(s)`)
      toast.success(
        target === 'attach'
          ? `Attached to ${json.attachedToName ?? 'the record'} — ${parts.join(', ')}.`
          : `Created — ${parts.join(', ')}.`,
        {
          action: {
            label: 'Open',
            onClick: () => router.push(`/${where}/${json.id}`),
          },
        }
      )
      onChanged(null)
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Promotion failed.')
    } finally {
      setBusy(null)
      setConfirmTarget(null)
      setAttachTo(null)
      setAttachOpen(false)
    }
  }

  async function forward() {
    if (!lead) return
    setBusy('forward')
    try {
      const res = await fetch(`/api/leads/${lead.id}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed.')
      // Names the lane and the address: two lanes can go to the same company,
      // and "sent to Dino" would not say which team now owns it.
      toast.success(
        `Handed to ${json.label} at ${json.to} — ${json.attachmentsSent} file(s).`,
        json.folderUrl
          ? { action: { label: 'Open in Drive', onClick: () => window.open(json.folderUrl, '_blank') } }
          : undefined
      )
      onChanged(null)
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed.')
    } finally {
      setBusy(null)
    }
  }

  // Reuses the shared document helpers: they mint the signed URL server-side
  // and handle the popup-blocker dance. Non-viewable types fall back to a
  // download rather than opening a blank tab.
  async function openAttachment(
    path: string,
    mimeType: string | null,
    download: boolean
  ) {
    if (!lead) return
    const apiPath = `/api/leads/${lead.id}/attachment?path=${encodeURIComponent(path)}`
    const ok = download
      ? await downloadDocument(apiPath)
      : await viewDocument(apiPath, mimeType)
    if (!ok) toast.error('Could not open that file.')
  }

  const promoted =
    lead.promoted_project_id ?? lead.promoted_opportunity_id ?? lead.promoted_steel_deal_id
  const promotedHref = lead.promoted_project_id
    ? `/projects/${lead.promoted_project_id}`
    : lead.promoted_opportunity_id
      ? `/opportunities/${lead.promoted_opportunity_id}`
      : lead.promoted_steel_deal_id
        ? `/steel/${lead.promoted_steel_deal_id}`
        : null
  // Gmail's own conversation id — `thread_id` is our UUID and resolves to nothing.
  const gmailUrl = gmailThreadUrl(lead.mailbox, lead.gmail_thread_id ?? null)
  const isWebForm = lead.source === 'web_form'

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="pr-8 leading-snug">{lead.title}</SheetTitle>
          </SheetHeader>

          <div className="px-4 pb-8 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={cat.tone(lead.route)}>{cat.label(lead.route)}</Chip>
              <Chip tone={STATUS_BADGE[lead.status]}>{STATUS_LABELS[lead.status]}</Chip>
              {lead.bid_due_date && (
                <span className={`text-sm font-medium ${bidDueColor(lead.bid_due_date)}`}>
                  {bidDueLabel(lead.bid_due_date)}
                </span>
              )}
            </div>

            {lead.status === 'spam' && lead.spam_reason && (
              <div className="rounded-md bg-muted/30 p-3 text-sm">
                <p className="label-caps text-muted-foreground mb-1">Why this was filtered</p>
                <p>{lead.spam_reason}</p>
              </div>
            )}

            {promotedHref && (
              <Link
                href={promotedHref}
                className="flex items-center gap-2 rounded-md bg-muted/30 p-3 text-sm hover:bg-accent"
              >
                <ExternalLink className="size-3.5 text-muted-foreground" />
                <span>Open the record this became</span>
              </Link>
            )}

            {gmailUrl && (
              <a
                href={gmailUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 rounded-md bg-muted/30 p-3 text-sm hover:bg-accent"
              >
                <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  {lead.gmail_draft_id ? (
                    <>
                      <span className="font-medium">A reply is drafted in Gmail</span>
                      <span className="block text-xs text-muted-foreground">
                        Ber AI wrote it; read, edit, and send it yourself — nothing was sent.
                      </span>
                    </>
                  ) : (
                    <>
                      Open the original thread in Gmail
                      {lead.gmail_label && (
                        <span className="block text-xs text-muted-foreground">
                          Filed under {lead.gmail_label}
                        </span>
                      )}
                    </>
                  )}
                </span>
              </a>
            )}

            {lead.drive_folder_url && (
              <a
                href={lead.drive_folder_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 rounded-md bg-muted/30 p-3 text-sm hover:bg-accent"
              >
                <FolderOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  Open the deal folder in Drive
                  <span className="block text-xs text-muted-foreground">
                    Everything in it is imported onto the project when this lead is promoted.
                  </span>
                </span>
              </a>
            )}

            {lead.summary && <p className="text-sm leading-relaxed">{lead.summary}</p>}

            <div className="grid grid-cols-2 gap-3">
              {(lead.sender_name || lead.sender_company) && (
                <Fact icon={Building2} label="From">
                  {lead.sender_name}
                  {lead.sender_name && lead.sender_company && ' · '}
                  {lead.sender_company}
                </Fact>
              )}
              {lead.sender_email && (
                <Fact icon={Mail} label="Email">
                  <a href={`mailto:${lead.sender_email}`} className="text-primary hover:underline">
                    {lead.sender_email}
                  </a>
                </Fact>
              )}
              {lead.sender_phone && (
                <Fact icon={Phone} label="Phone">
                  <a href={`tel:${lead.sender_phone}`} className="text-primary hover:underline">
                    {lead.sender_phone}
                  </a>
                </Fact>
              )}
              {lead.location && <Fact icon={MapPin} label="Location">{lead.location}</Fact>}
              {lead.estimated_value != null && (
                <Fact icon={Building2} label="Value">
                  <span className="tnum">{formatValue(lead.estimated_value)}</span>
                </Fact>
              )}
              {lead.solicitation_number && (
                <Fact icon={FolderKanban} label="Solicitation">{lead.solicitation_number}</Fact>
              )}
              {lead.bid_due_date && (
                <Fact icon={Calendar} label="Bid due">{formatDate(lead.bid_due_date)}</Fact>
              )}
              {lead.site_visit_date && (
                <Fact icon={Calendar} label="Site visit">{formatDate(lead.site_visit_date)}</Fact>
              )}
              {lead.rfi_due_date && (
                <Fact icon={Calendar} label="RFIs due">{formatDate(lead.rfi_due_date)}</Fact>
              )}
              {lead.received_at && (
                <Fact icon={Mail} label="Received">{formatDate(lead.received_at.slice(0, 10))}</Fact>
              )}
            </div>

            {lead.scope && (
              <div className="space-y-1">
                <p className="label-caps text-muted-foreground">Scope</p>
                <p className="text-sm leading-relaxed">{lead.scope}</p>
              </div>
            )}

            {isWebForm ? (
              <IntakeChecklist answers={lead.intake_answers ?? {}} />
            ) : (
              <>
                <Bullets title="Key facts" items={lead.key_facts} />
                <Bullets title="Requirements to bid" items={lead.requirements} />
              </>
            )}

            {siblings.length > 0 && (
              <div className="space-y-1">
                <p className="label-caps text-muted-foreground">
                  Also in this email ({siblings.length})
                </p>
                <ul className="space-y-1">
                  {siblings.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onSelectSibling?.(s)}
                        className="text-left text-sm text-primary hover:underline"
                      >
                        {s.title}
                      </button>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {cat.label(s.route)}
                        {s.estimated_value ? ` · ${formatValue(s.estimated_value)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {notes.length > 0 && (
              <div className="space-y-1">
                <p className="label-caps text-muted-foreground">
                  Since this arrived ({notes.length})
                </p>
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-md bg-muted/30 p-2">
                      <p className="text-xs text-muted-foreground">
                        {n.created_at ? formatDate(n.created_at) : ''}
                        {n.author ? ` · ${n.author}` : ''}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed line-clamp-6">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {lead.attachments.length > 0 && (
              <div className="space-y-1">
                <p className="label-caps text-muted-foreground">
                  Attachments ({lead.attachments.length})
                </p>
                <div className="space-y-1">
                  {lead.attachments.map((a) => (
                    <div
                      key={a.storage_path}
                      className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-sm"
                    >
                      <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                      <button
                        type="button"
                        onClick={() => openAttachment(a.storage_path, a.mime_type, false)}
                        className="min-w-0 flex-1 truncate text-left hover:text-primary hover:underline"
                      >
                        {a.name}
                      </button>
                      {!a.extracted && (
                        <span className="label-caps text-muted-foreground shrink-0">not read</span>
                      )}
                      <button
                        type="button"
                        onClick={() => openAttachment(a.storage_path, a.mime_type, true)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Download ${a.name}`}
                      >
                        <Download className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {lead.fit_recommendation && (
              <FitAssessmentCard
                fit={{
                  recommendation: lead.fit_recommendation,
                  fit_score: lead.fit_score ?? 0,
                  summary: lead.fit_summary ?? '',
                  strengths: lead.fit_strengths,
                  concerns: lead.fit_concerns,
                  gaps: lead.fit_gaps,
                  key_questions: lead.fit_questions,
                  profile_incomplete: false,
                }}
              />
            )}

            {lead.score_error && (
              <p className="text-xs text-amber-600">{lead.score_error}</p>
            )}

            {/* ── Actions ───────────────────────────────────────────────── */}
            <div className="space-y-3 border-t border-border pt-4">
              <div className="space-y-1">
                <p className="label-caps text-muted-foreground">Line of business</p>
                <select
                  value={lead.route}
                  onChange={(e) => patch({ route: e.target.value }, 'Category updated.')}
                  disabled={busy !== null}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* Active lanes, plus this lead's own if it has been retired —
                      a retired category must stay selected on the leads it
                      already owns, or opening one silently re-routes it to
                      whatever happens to sort first. */}
                  {categories
                    .filter((c) => c.active || c.key === lead.route)
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                        {!c.active ? ' (retired)' : ''}
                      </option>
                    ))}
                </select>
                {cat.note(lead.route) && (
                  <p className="text-xs text-muted-foreground">{cat.note(lead.route)}</p>
                )}
              </div>

              {lead.status === 'spam' ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() => patch({ status: 'new', rescore: true }, 'Restored to the queue — it will be scored on the next sweep.')}
                >
                  <Undo2 className="size-4" />
                  Not spam — restore to queue
                </Button>
              ) : (
                isOpenStatus && (
                  <>
                    {/* THE CATEGORY IS THE RECOMMENDATION, so its own
                        destination is the primary button and the rest are a
                        disclosure. Offering all five at equal weight is what had
                        1,268 scored leads and zero ever promoted: every
                        promotion re-asked a question the triage pass had already
                        answered, so the reader answered none of them. */}
                    {recommended === 'handoff' ? (
                      category?.handoff_ready ? (
                        <Button className="w-full" disabled={busy !== null} onClick={forward}>
                          <Send className="size-4" />
                          {busy === 'forward'
                            ? 'Sending…'
                            : `Hand off to ${category.label}`}
                        </Button>
                      ) : (
                        // Named rather than disabled-and-silent: this is exactly
                        // the failure DINO_LEAD_EMAIL produced for a year — a
                        // button that looked live and 400'd on press.
                        <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-700/60 dark:bg-amber-950/30">
                          <p className="text-xs text-amber-800 dark:text-amber-200">
                            {category?.label ?? 'This category'} has no handoff address yet, so
                            there is nobody to send it to.
                          </p>
                          <Link
                            href="/settings/lead-categories"
                            className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline dark:text-amber-100"
                          >
                            Add one in Lead categories
                            <ExternalLink className="size-3" />
                          </Link>
                        </div>
                      )
                    ) : recommended ? (
                      <Button
                        className="w-full"
                        disabled={busy !== null}
                        onClick={() => setConfirmTarget(recommended)}
                      >
                        {recommended === 'project' ? (
                          <FolderKanban className="size-4" />
                        ) : recommended === 'steel' ? (
                          <Factory className="size-4" />
                        ) : (
                          <Lightbulb className="size-4" />
                        )}
                        {recommended === 'project'
                          ? 'Create project'
                          : recommended === 'steel'
                            ? 'Create steel deal'
                            : 'Create opportunity'}
                      </Button>
                    ) : (
                      // `manual` — the triage could not place it, which is
                      // precisely when a one-click destination would file a deal
                      // into the wrong module silently.
                      <p className="text-xs text-muted-foreground">
                        Unsorted. Pick a line of business above, or choose a destination below.
                      </p>
                    )}

                    {/* Never a dead end: every other destination stays one
                        disclosure away, for the lead whose category is right but
                        whose destination this time is not. */}
                    <details className="group">
                      <summary className="cursor-pointer list-none text-xs text-muted-foreground underline decoration-dotted outline-none focus-visible:text-foreground">
                        Other destinations
                      </summary>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {recommended !== 'project' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => setConfirmTarget('project')}
                          >
                            <FolderKanban className="size-4" />
                            To project
                          </Button>
                        )}
                        {recommended !== 'opportunity' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => setConfirmTarget('opportunity')}
                          >
                            <Lightbulb className="size-4" />
                            To opportunity
                          </Button>
                        )}
                        {recommended !== 'steel' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => setConfirmTarget('steel')}
                          >
                            <Factory className="size-4" />
                            To Steel CRM
                          </Button>
                        )}
                        {recommended !== 'handoff' && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy !== null || !category?.handoff_ready}
                            onClick={forward}
                            title={
                              category?.handoff_ready
                                ? undefined
                                : 'This category has no handoff address configured.'
                            }
                          >
                            <Send className="size-4" />
                            {busy === 'forward' ? 'Sending…' : 'Hand off by email'}
                          </Button>
                        )}
                      </div>
                    </details>

                    {/* Attach to a record that already exists.
                        The fourth answer, and the one the buttons above cannot
                        give: a GC re-inviting us to a job we are already bidding
                        is a real deal with a real record, and promoting it makes
                        a second one — splitting the deal's documents and its mail
                        across both. */}
                    {attachOptions.length > 0 && (
                      attachOpen ? (
                        <div className="space-y-2 rounded-md border border-border/60 p-2.5">
                          <div className="flex items-center gap-2">
                            <Link2 className="size-3.5 text-muted-foreground" />
                            <p className="text-xs font-medium flex-1">Attach to an existing record</p>
                            <button
                              type="button"
                              onClick={() => { setAttachOpen(false); setAttachTo(null) }}
                              className="text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:text-foreground"
                              title="Cancel"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                          {attachTo ? (
                            <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50/60 px-2 py-1.5 text-xs text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                              <Check className="size-3.5 shrink-0" />
                              <span className="flex-1 truncate">{attachTo.name}</span>
                              <button
                                type="button"
                                onClick={() => setAttachTo(null)}
                                className="shrink-0 transition-colors hover:text-destructive outline-none focus-visible:text-destructive"
                                title="Pick a different record"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ) : (
                            <RecordPicker options={attachOptions} onPick={setAttachTo} />
                          )}
                          <Button
                            className="w-full"
                            disabled={busy !== null || !attachTo}
                            onClick={() => setConfirmTarget('attach')}
                          >
                            <Link2 className="size-4" />
                            Attach this lead
                          </Button>
                          <p className="text-[11px] text-muted-foreground">
                            Adds this lead&rsquo;s summary and files to that record and drains it from the
                            queue. Nothing on the record is overwritten.
                          </p>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          className="w-full text-muted-foreground"
                          disabled={busy !== null}
                          onClick={() => setAttachOpen(true)}
                        >
                          <Link2 className="size-4" />
                          Already have a record for this — attach it
                        </Button>
                      )
                    )}

                    <Button
                      variant="ghost"
                      className="w-full text-muted-foreground"
                      disabled={busy !== null}
                      onClick={() => patch({ status: 'ignored' }, 'Lead dismissed.')}
                    >
                      <Archive className="size-4" />
                      Not interested
                    </Button>
                  </>
                )
              )}
              {promoted && !isOpenStatus && lead.status !== 'spam' && (
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => patch({ status: 'new' }, 'Reopened.')}
                >
                  <Undo2 className="size-4" />
                  Reopen
                </Button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        title={
          confirmTarget === 'attach'
            ? `Attach to ${attachTo?.name ?? 'this record'}?`
            : confirmTarget === 'project'
              ? 'Create a project?'
              : confirmTarget === 'opportunity'
                ? 'Create an opportunity?'
                : 'Create a steel deal?'
        }
        description={
          confirmTarget === 'attach'
            ? 'The lead’s summary is posted to that record’s feed and its files are copied onto it. The record’s own stage, value and owner are left exactly as they are — nothing is overwritten. The lead leaves the queue.'
            : confirmTarget === 'project'
              ? 'This starts a project at the Pursuit stage with you as capture lead, and copies the files onto it. It will appear in pipeline value and on the dashboard.'
              : confirmTarget === 'opportunity'
                ? 'This creates an opportunity at the Identified stage and copies the files onto it.'
                : 'This creates a steel deal at the Quote stage and copies the files onto it.'
        }
        confirmLabel={busy ? (confirmTarget === 'attach' ? 'Attaching…' : 'Creating…') : confirmTarget === 'attach' ? 'Attach' : 'Create'}
        onConfirm={() => {
          if (confirmTarget) return promote(confirmTarget)
        }}
      />
    </>
  )
}
