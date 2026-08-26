import Link from 'next/link'
import { Inbox, FileUp, Users, FileText, Loader2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import EmailResearchForm from '@/components/email-ingestion/EmailResearchForm'
import EmailIngestForm from '@/components/email-ingestion/EmailIngestForm'
import MeetingIntakeForm from '@/components/meeting-intake/MeetingIntakeForm'
import SessionsAutoRefresh from '@/components/email-ingestion/SessionsAutoRefresh'
import DismissSessionButton from '@/components/email-ingestion/DismissSessionButton'
import ProposalIntakeWizard from '@/components/proposals/ProposalIntakeWizard'
import ReferenceDocForm from '@/components/reference-docs/ReferenceDocForm'
import { formatDate } from '@/lib/utils/constants'
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
      : params.tab === 'meeting'
      ? 'meeting'
      : params.tab === 'document'
      ? 'document'
      : 'email'

  const supabase = createAdminClient()

  return (
    <div className={cn('space-y-6', tab === 'proposal' ? 'max-w-6xl' : 'max-w-3xl')}>
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

const DISPOSITION_RANK: Record<string, number> = { create: 0, merge: 1, none: 2, dismiss: 3 }

const DISPOSITION_LABEL: Record<string, string> = {
  create: 'Create',
  merge: 'Merge',
  dismiss: 'Let go',
}

const DISPOSITION_BADGE: Record<string, string> = {
  create: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  merge: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  dismiss: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700',
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
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at, extraction_result, predecision')
    .eq('intake_kind', 'email')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(25)

  const rows = (sessions ?? [])
    .map((s) => ({
      ...s,
      effective: effectiveEmailIntakeStatus(s.status, s.updated_at),
      pre: readPredecision(s.predecision),
    }))
    // Best first: what Ber AI says to CREATE leads the list, then merges, then
    // anything it has not judged yet. A queue in arrival order makes the reader
    // do the sorting, which is the work we are trying to remove.
    .sort((a, b) => DISPOSITION_RANK[a.pre?.disposition ?? 'none'] - DISPOSITION_RANK[b.pre?.disposition ?? 'none'])
  const anyRunning = rows.some((r) => r.effective === 'running')
  const judged = rows.filter((r) => r.pre).length

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
          <h2 className="label-caps text-muted-foreground">
            Recent{judged > 0 && <span className="ml-2 normal-case tracking-normal">· {judged} pre-read by Ber AI</span>}
          </h2>
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

async function MeetingTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at, created_record_ids')
    .eq('intake_kind', 'meeting')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(25)

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

      {rows.length > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground">Recent</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((s) => {
              const st = s.status === 'confirmed' ? 'confirmed' : 'pending'
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
