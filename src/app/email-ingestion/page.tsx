import Link from 'next/link'
import { Inbox } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import EmailIngestForm from '@/components/email-ingestion/EmailIngestForm'
import {
  emailIntakeStatus,
  EMAIL_INTAKE_STATUS_LABELS,
  EMAIL_INTAKE_STATUS_BADGE,
} from '@/lib/utils/email-ingestion'

export const metadata = { title: 'Email Ingestion — Ber Wilson Intelligence' }

export default async function EmailIngestionPage() {
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
          Email Ingestion
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run Email Research (or paste a report below) and Ber AI turns it into a proposed
          opportunity or project — with people and tasks — for you to review and confirm.
        </p>
      </div>

      <EmailIngestForm />

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
