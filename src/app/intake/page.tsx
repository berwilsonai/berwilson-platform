import Link from 'next/link'
import { Inbox, FileUp, Users, Loader2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { cn } from '@/lib/utils'
import EmailResearchForm from '@/components/email-ingestion/EmailResearchForm'
import EmailIngestForm from '@/components/email-ingestion/EmailIngestForm'
import MeetingIntakeForm from '@/components/meeting-intake/MeetingIntakeForm'
import SessionsAutoRefresh from '@/components/email-ingestion/SessionsAutoRefresh'
import DismissSessionButton from '@/components/email-ingestion/DismissSessionButton'
import ProposalIntakeWizard from '@/components/proposals/ProposalIntakeWizard'
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
] as const

type TabKey = (typeof TABS)[number]['key']

export default async function IntakePage({ searchParams }: PageProps) {
  const params = await searchParams
  const tab: TabKey =
    params.tab === 'proposal' ? 'proposal' : params.tab === 'meeting' ? 'meeting' : 'email'

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
      ) : (
        <ProposalTab supabase={supabase} />
      )}
    </div>
  )
}

async function EmailTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at, extraction_result')
    .eq('intake_kind', 'email')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(25)

  const rows = (sessions ?? []).map((s) => ({
    ...s,
    effective: effectiveEmailIntakeStatus(s.status, s.updated_at),
  }))
  const anyRunning = rows.some((r) => r.effective === 'running')

  return (
    <>
      {anyRunning && <SessionsAutoRefresh />}
      <div>
        <p className="text-sm text-muted-foreground">
          Sweep the Outlook mailboxes for a person, email, or project. Ber AI reads the
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
                      <span className="text-sm font-medium truncate block">{s.label || 'Untitled research package'}</span>
                      <span className="text-xs text-muted-foreground">
                        Searching Outlook and reading threads — usually 1–4 minutes. Safe to leave this page.
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
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <span className="text-sm font-medium truncate">{s.label || 'Untitled research package'}</span>
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

async function MeetingTab({ supabase }: { supabase: ReturnType<typeof createAdminClient> }) {
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at')
    .eq('intake_kind', 'meeting')
    .neq('status', 'dismissed')
    .order('updated_at', { ascending: false })
    .limit(25)

  const rows = sessions ?? []

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
                  <span className="text-sm font-medium truncate">{s.label || 'Untitled meeting'}</span>
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
