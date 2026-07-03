import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import EmailResearchForm from '@/components/email-ingestion/EmailResearchForm'
import EmailIngestForm from '@/components/email-ingestion/EmailIngestForm'
import {
  emailIntakeStatus,
  EMAIL_INTAKE_STATUS_LABELS,
  EMAIL_INTAKE_STATUS_BADGE,
} from '@/lib/utils/email-ingestion'

export const metadata = { title: 'Email Intake — Ber Wilson Intelligence' }

export default async function EmailIntakePage() {
  const supabase = createAdminClient()
  const { data: sessions } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at')
    .order('updated_at', { ascending: false })
    .limit(25)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Inbox size={18} className="text-muted-foreground" />
          Email Intake
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
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

      {(sessions?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Recent</h2>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {sessions!.map((s) => {
              const st = emailIntakeStatus(s.status)
              return (
                <Link
                  key={s.id}
                  href={`/email-ingestion/${s.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-accent transition-colors"
                >
                  <span className="text-sm font-medium truncate">{s.label || 'Untitled research package'}</span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ring-1 ring-inset shrink-0 ${EMAIL_INTAKE_STATUS_BADGE[st]}`}>
                    {EMAIL_INTAKE_STATUS_LABELS[st]}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
