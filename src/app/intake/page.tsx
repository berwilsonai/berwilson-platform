import Link from 'next/link'
import { Inbox, FileUp, Users, FileText, Loader2, UserSearch, Camera, Gavel } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import EmailResearchForm from '@/components/email-ingestion/EmailResearchForm'
import EmailIngestForm from '@/components/email-ingestion/EmailIngestForm'
import MeetingIntakeForm from '@/components/meeting-intake/MeetingIntakeForm'
import ProfileIntakeForm from '@/components/contacts/ProfileIntakeForm'
import CardBatchUpload from '@/components/contacts/CardBatchUpload'
import SessionsAutoRefresh from '@/components/email-ingestion/SessionsAutoRefresh'
import DismissSessionButton from '@/components/email-ingestion/DismissSessionButton'
import DedupeProposalsButton from '@/components/email-ingestion/DedupeProposalsButton'
import ProposalIntakeWizard from '@/components/proposals/ProposalIntakeWizard'
import ReferenceDocForm from '@/components/reference-docs/ReferenceDocForm'
import { formatDate } from '@/lib/utils/constants'
import { readCardBatch } from '@/lib/contacts/card-batch'
import {
  effectiveEmailIntakeStatus,
  EMAIL_INTAKE_STATUS_LABELS,
  EMAIL_INTAKE_STATUS_BADGE,
} from '@/lib/utils/email-ingestion'

export const metadata = { title: 'Intake — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

const TABS = [
  { key: 'email', label: 'Email', icon: Inbox },
  { key: 'people', label: 'People', icon: UserSearch },
  { key: 'cards', label: 'Cards', icon: Camera },
  { key: 'meeting', label: 'Meeting', icon: Users },
  { key: 'proposal', label: 'Proposal', icon: FileUp },
  { key: 'document', label: 'Document', icon: FileText },
] as const

type TabKey = (typeof TABS)[number]['key']

export default async function IntakePage({ searchParams }: PageProps) {
  const params = await searchParams
  const tab: TabKey =
    params.tab === 'proposal'
      ? 'proposal'
      : params.tab === 'people'
      ? 'people'
      : params.tab === 'cards'
      ? 'cards'
      : params.tab === 'meeting'
      ? 'meeting'
      : params.tab === 'document'
      ? 'document'
      : 'email'

  const supabase = createAdminClient()

  return (
    /*
      ⚠ `max-w-5xl`, UP FROM `max-w-3xl`. Five of the six tabs here are queues
      and staged lists — recent runs, staged packages, scanned cards — and
      they were pinned to a 768px column inside a 1,451px frame, so a row's
      title, its destination and its status all competed for a third of the
      screen while the other two thirds were empty. The proposal tab already
      knew this and opted out to `max-w-6xl`; the rest were never revisited.
      ⚠ Still CAPPED, not full-bleed: the forms on these tabs are prose and
      single fields, and a 1,451px text input is not an improvement.
    */
    <div className={cn('space-y-6', tab === 'proposal' ? 'max-w-6xl' : 'max-w-5xl')}>
      {/* Tab switcher — the Directory `?tab=` idiom */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={key === 'email' ? '/intake' : `/intake?tab=${key}`}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon size={14} />
            {label}
          </Link>
        ))}
      </div>

      {tab === 'email' ? (
        <EmailTab supabase={supabase} />
      ) : tab === 'people' ? (
        <PeopleTab supabase={supabase} />
      ) : tab === 'cards' ? (
        <CardsTab supabase={supabase} />
      ) : tab === 'meeting' ? (
        <MeetingTab supabase={supabase} />
      ) : tab === 'document' ? (
        <DocumentTab supabase={supabase} />
      ) : (
        <ProposalTab supabase={supabase} />
      )}
    </div>
  )
}

/** Recommended disposition attached by the pre-decide phase. */
type Predecision = {
  disposition: 'create' | 'merge' | 'dismiss'
  confidence: number
  reason: string
  merge_target_name?: string | null
  headline?: string | null
}

const DISPOSITION_LABEL: Record<string, string> = {
  create: 'Create',
  merge: 'Merge',
  dismiss: 'Let go',
}

const DISPOSITION_BADGE: Record<string, string> = {
  create: 'bg-positive-surface text-positive ring-positive-edge',
  merge: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  dismiss: 'bg-muted text-muted-foreground ring-border dark:bg-muted/60',
}

/** Tolerant read — predecision is jsonb and predates the generated types. */
function readPredecision(raw: unknown): Predecision | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const d = String(o.disposition ?? '')
  if (d !== 'create' && d !== 'merge' && d !== 'dismiss') return null
  return {
    disposition: d,
    confidence: Number(o.confidence) || 0,
    reason: String(o.reason ?? ''),
    merge_target_name: typeof o.merge_target_name === 'string' ? o.merge_target_name : null,
    headline: typeof o.headline === 'string' ? o.headline : null,
  }
}

async function EmailTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  // The list below is capped at 25, and the backlog is routinely far longer —
  // 115 pending on 2026-10-08 — so the count is read separately rather than
  // inferred from the rows. Scoped to what the dedupe pass itself reads
  // (`create`), because a number beside a button has to mean what the button
  // will act on.
  const [{ data: sessions }, { count: pendingCreate }, { count: pendingTotal }] = await Promise.all([
    supabase
      .from('email_intake_sessions')
      .select('id, label, status, updated_at, extraction_result, predecision')
      .eq('intake_kind', 'email')
      // ⚠ IN SQL, BEFORE THE LIMIT. Filtering `pending` out in the caller
      // afterwards returned an EMPTY list — the 25 newest undismissed rows are
      // all pending, so every confirmed run fell outside the window (§12: an
      // exclusion must be applied before the LIMIT). `running` is stored;
      // `failed` is a stale `running`, which is why it is not a status here.
      .in('status', ['running', 'confirmed'])
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('intake_kind', 'email')
      .eq('status', 'pending')
      .eq('predecision->>disposition', 'create'),
    // Everything this tab USED to list and now points at instead. Counted in
    // SQL rather than from `rows`, which is capped at 25 against a backlog
    // routinely four times that.
    supabase
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('intake_kind', 'email')
      .eq('status', 'pending'),
  ])

  /*
   * ⚠ This tab used to list the pending sessions too, ranked by
   * DISPOSITION_RANK — a SECOND decide queue over the same rows /decide ranks
   * by `decideWeight`, with its own order and its own dismiss buttons. On
   * 2026-10-19 that was 101 rows appearing twice, in two different orders,
   * each page implying it was the queue. CLAUDE.md §12: one quantity, one
   * definition, or the reader trusts neither.
   *
   * So the split is by WHO the row is waiting on. A `running` or `failed`
   * session is this page's own job — it is the research form's output and
   * belongs beside the form that started it. A `pending` session is waiting on
   * a human judgement, which is Decide's whole purpose, and is a count and a
   * link from here. Nothing is hidden; it has one home.
   */
  const rows = (sessions ?? []).map((s) => ({
    ...s,
    effective: effectiveEmailIntakeStatus(s.status, s.updated_at),
    pre: readPredecision(s.predecision),
  }))
  const anyRunning = rows.some((r) => r.effective === 'running')

  return (
    <>
      {anyRunning && <SessionsAutoRefresh />}
      <div>
        <p className="text-sm text-muted-foreground">
          Sweep the connected Gmail mailboxes for a person, email, or project. Ber AI reads the
          matching threads and attachments, assembles a research report, and proposes an
          opportunity or project — with people and tasks — for you to review and confirm.
          Nothing is created until you approve it.
        </p>
      </div>

      <EmailResearchForm />

      <DedupeProposalsButton pending={pendingCreate ?? 0} />

      {/* Where the pending ones went. One destination, named, with its count. */}
      {(pendingTotal ?? 0) > 0 && (
        <Link
          href="/decide"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-accent transition-colors"
        >
          <span className="min-w-0">
            <span className="text-sm font-medium block">
              {pendingTotal} research {pendingTotal === 1 ? 'package is' : 'packages are'} waiting on you
            </span>
            <span className="text-xs text-muted-foreground">
              Ber AI has read them and proposed what to do. Decide is where they get confirmed, merged or dismissed.
            </span>
          </span>
          <Gavel size={16} className="text-muted-foreground shrink-0" />
        </Link>
      )}

      {/* Manual fallback — reports produced outside the mailbox sweep */}
      <details className="group rounded-lg border border-border bg-card">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
          Paste a report manually
        </summary>
        <div className="px-4 pb-4">
          <EmailIngestForm />
        </div>
      </details>

      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground">Recent runs</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((s) => {
              const st = s.effective
              const badge = (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 inline-flex items-center gap-1 ${EMAIL_INTAKE_STATUS_BADGE[st]}`}>
                  {st === 'running' && <Loader2 size={10} className="animate-spin" />}
                  {EMAIL_INTAKE_STATUS_LABELS[st]}
                </span>
              )

              if (st === 'running') {
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{s.label || 'Untitled research package'}</span>
                      <span className="text-xs text-muted-foreground">
                        Searching Gmail and reading threads — usually 1–4 minutes. Safe to leave this page.
                      </span>
                    </div>
                    {badge}
                  </div>
                )
              }

              if (st === 'failed') {
                const err =
                  s.extraction_result && typeof s.extraction_result === 'object' && 'error' in s.extraction_result
                    ? String((s.extraction_result as { error?: unknown }).error ?? '')
                    : ''
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{s.label || 'Untitled research package'}</span>
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {err || 'The run never finished — it likely hit the 5-minute limit. Try a narrower search.'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {badge}
                      <DismissSessionButton sessionId={s.id} />
                    </div>
                  </div>
                )
              }

              return (
                <Link
                  key={s.id}
                  href={`/email-ingestion/${s.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium truncate block">{s.label || 'Untitled research package'}</span>
                    {/* The one fact that would change the reader's mind, so the
                        decision can be made from the list without opening it. */}
                    {s.pre?.headline && (
                      <span className="text-xs text-muted-foreground line-clamp-2 mt-0.5 block">{s.pre.headline}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {s.pre && (
                      <span
                        title={s.pre.reason}
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset ${DISPOSITION_BADGE[s.pre.disposition]}`}
                      >
                        {s.pre.disposition === 'merge' && s.pre.merge_target_name
                          ? `Merge → ${s.pre.merge_target_name}`
                          : DISPOSITION_LABEL[s.pre.disposition]}
                      </span>
                    )}
                    {badge}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

async function PeopleTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at, extraction_result, created_record_ids')
    .eq('intake_kind', 'people')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(25)

  const rows = (sessions ?? []).map((s) => {
    const effective = effectiveEmailIntakeStatus(s.status, s.updated_at)
    // One line that says whether this is worth opening: how many people were
    // actually found in the mail, not how many were asked for.
    const draft = (s.extraction_result ?? {}) as {
      people?: { evidence?: string }[]
      cast?: unknown[]
      error?: unknown
    }
    const asked = draft.people?.length ?? 0
    const found = (draft.people ?? []).filter((p) => p.evidence === 'mail').length
    const castCount = draft.cast?.length ?? 0
    const confirmed = (s.created_record_ids ?? {}) as { party_ids?: string[] }

    let summary: string | null = null
    if (effective === 'confirmed') {
      const n = confirmed.party_ids?.length ?? 0
      summary = `${n} contact${n === 1 ? '' : 's'} saved`
    } else if (effective === 'pending' && asked > 0) {
      summary =
        `${found} of ${asked} profiled from mail` +
        (castCount > 0 ? ` · ${castCount} more in the same threads` : '')
    }
    return { ...s, effective, summary }
  })

  const anyRunning = rows.some((r) => r.effective === 'running')

  return (
    <>
      {anyRunning && <SessionsAutoRefresh />}
      <div>
        <p className="text-sm text-muted-foreground">
          Enter the people on a deal — names, email addresses, or a pasted To: line. Ber AI reads the
          correspondence the platform has already swept, pulls their title, employer and direct
          number out of their own signatures, works out what each of them is doing on the deal, and
          finds everyone else on the same threads. You review it and pick the record they all attach
          to. Nothing is created until you confirm.
        </p>
      </div>

      <ProfileIntakeForm />

      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground">Recent</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((s) => {
              const st = s.effective
              const badge = (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 inline-flex items-center gap-1 ${EMAIL_INTAKE_STATUS_BADGE[st]}`}>
                  {st === 'running' && <Loader2 size={10} className="animate-spin" />}
                  {EMAIL_INTAKE_STATUS_LABELS[st]}
                </span>
              )

              if (st === 'running') {
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{s.label || 'Profiling people'}</span>
                      <span className="text-xs text-muted-foreground">
                        Reading the mail — about a minute per person. Safe to leave this page.
                      </span>
                    </div>
                    {badge}
                  </div>
                )
              }

              if (st === 'failed') {
                const err =
                  s.extraction_result && typeof s.extraction_result === 'object' && 'error' in s.extraction_result
                    ? String((s.extraction_result as { error?: unknown }).error ?? '')
                    : ''
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{s.label || 'Profiling people'}</span>
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {err || 'The run never finished — try fewer people at once.'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {badge}
                      <DismissSessionButton sessionId={s.id} />
                    </div>
                  </div>
                )
              }

              return (
                <Link
                  key={s.id}
                  href={`/intake/people/${s.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium truncate block">{s.label || 'People'}</span>
                    {s.summary && <span className="text-xs text-muted-foreground">{s.summary}</span>}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {badge}
                    {st === 'pending' && <DismissSessionButton sessionId={s.id} />}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

async function CardsTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at, extraction_result, created_record_ids')
    .eq('intake_kind', 'cards')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(25)

  const rows = (sessions ?? []).map((s) => {
    const effective = effectiveEmailIntakeStatus(s.status, s.updated_at)
    const draft = readCardBatch(s.extraction_result)
    const total = draft?.items.length ?? 0
    const ready = draft?.items.filter((i) => i.state === 'ready').length ?? 0
    const confirmed = (s.created_record_ids ?? {}) as { party_ids?: string[] }

    let summary: string | null = null
    if (effective === 'confirmed') {
      const n = confirmed.party_ids?.length ?? 0
      summary = `${n} contact${n === 1 ? '' : 's'} saved`
    } else if (total > 0) {
      // The honest progress number, because a batch that has stopped moving and
      // one that is simply slow look identical without it.
      summary = `${ready} of ${total} card${total === 1 ? '' : 's'} researched`
    }
    return { ...s, effective, summary }
  })

  const anyRunning = rows.some((r) => r.effective === 'running')

  return (
    <>
      {anyRunning && <SessionsAutoRefresh />}
      <div>
        <p className="text-sm text-muted-foreground">
          Photograph a stack of business cards and drop the lot here. Each one is read on this
          machine, its company researched on the web, and its fit for Ber Wilson assessed against
          the company profile — then you review the whole stack at once. Cards already in the
          directory are flagged rather than duplicated. Nothing is created until you confirm.
        </p>
      </div>

      <CardBatchUpload />

      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground">Recent</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((s) => {
              const st = s.effective
              const badge = (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 inline-flex items-center gap-1 ${EMAIL_INTAKE_STATUS_BADGE[st]}`}>
                  {st === 'running' && <Loader2 size={10} className="animate-spin" />}
                  {EMAIL_INTAKE_STATUS_LABELS[st]}
                </span>
              )

              return (
                <Link
                  key={s.id}
                  href={`/intake/cards/${s.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium truncate block">{s.label || 'Business cards'}</span>
                    {s.summary && <span className="text-xs text-muted-foreground">{s.summary}</span>}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {badge}
                    {(st === 'pending' || st === 'failed') && <DismissSessionButton sessionId={s.id} />}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

async function MeetingTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  // Confirmed only, for the same reason as the Email tab: a staged meeting is
  // already a lane on /decide (14 of them on 2026-10-19), and a row that
  // appears in two queues makes the reader wonder which one is authoritative.
  const [{ data: sessions }, { count: pendingTotal }] = await Promise.all([
    supabase
      .from('email_intake_sessions')
      .select('id, label, status, updated_at, created_record_ids')
      .eq('intake_kind', 'meeting')
      .eq('status', 'confirmed')
      .order('updated_at', { ascending: false })
      .limit(25),
    supabase
      .from('email_intake_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('intake_kind', 'meeting')
      .eq('status', 'pending'),
  ])

  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  const rows = (sessions ?? []).map((s) => {
    const c = (s.created_record_ids ?? {}) as {
      project_ids?: string[]; opportunity_ids?: string[]; task_ids?: string[]; document_ids?: string[]
    }
    const records = (c.project_ids?.length ?? 0) + (c.opportunity_ids?.length ?? 0)
    const parts: string[] = []
    if (records) parts.push(`${records} record${records === 1 ? '' : 's'}`)
    if (c.task_ids?.length) parts.push(`${c.task_ids.length} task${c.task_ids.length === 1 ? '' : 's'}`)
    const when = s.updated_at ? dateFmt.format(new Date(s.updated_at)) : null
    return {
      ...s,
      summary: s.status === 'confirmed'
        ? [when, ...parts].filter(Boolean).join(' · ') || null
        : null,
    }
  })

  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">
          Paste the notes or transcript from a meeting. Ber AI extracts a summary, attendees,
          decisions, and follow-up tasks — then you pick which existing projects and opportunities
          to update (or create new ones) and confirm. Each record gets the minutes, a saved meeting
          document, the attendees, and its tasks. Nothing is created until you approve it.
        </p>
      </div>

      <MeetingIntakeForm />

      {(pendingTotal ?? 0) > 0 && (
        <Link
          href="/decide"
          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:bg-accent transition-colors"
        >
          <span className="min-w-0">
            <span className="text-sm font-medium block">
              {pendingTotal} recorded {pendingTotal === 1 ? 'meeting is' : 'meetings are'} waiting on you
            </span>
            <span className="text-xs text-muted-foreground">
              Already transcribed and searchable. Confirming adds the deal, the attendees and the follow-up tasks.
            </span>
          </span>
          <Gavel size={16} className="text-muted-foreground shrink-0" />
        </Link>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground">Confirmed</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((s) => {
              const st = 'confirmed' as const
              const badge = (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 inline-flex items-center gap-1 ${EMAIL_INTAKE_STATUS_BADGE[st]}`}>
                  {EMAIL_INTAKE_STATUS_LABELS[st]}
                </span>
              )
              return (
                <Link
                  key={s.id}
                  href={`/intake/meeting/${s.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium truncate block">{s.label || 'Untitled meeting'}</span>
                    {s.summary && <span className="text-[11px] text-muted-foreground">{s.summary}</span>}
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {badge}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

async function DocumentTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  const { data: docs } = await supabase
    .from('documents')
    .select('id, file_name, ai_summary, embedding_status, uploaded_at')
    .eq('is_reference', true)
    .order('uploaded_at', { ascending: false })
    .limit(30)

  const rows = docs ?? []

  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">
          Upload a lengthy proposal or document to digest it. Ber AI reads the whole thing, writes a
          summary, and lets you ask questions to make sure you understand it — with read-aloud on the
          summary and every answer. Documents stay here and become searchable from Ask Ber AI.
        </p>
      </div>

      <ReferenceDocForm />

      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground">Recent documents</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((d) => (
              <Link
                key={d.id}
                href={`/intake/document/${d.id}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium truncate block">{d.file_name}</span>
                  {d.ai_summary && (
                    <span className="text-xs text-muted-foreground line-clamp-1">{d.ai_summary}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {d.uploaded_at ? formatDate(d.uploaded_at) : ''}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

async function ProposalTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  // Projects that can be parents (top-level, active/on_hold)
  const { data: parents } = await supabase
    .from('projects')
    .select('id, name')
    .is('parent_project_id', null)
    .in('status', ['active', 'on_hold'])
    .order('name')

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Upload a proposal document and the system will extract project details automatically.
      </p>
      <ProposalIntakeWizard availableParents={parents || []} />
    </>
  )
}
