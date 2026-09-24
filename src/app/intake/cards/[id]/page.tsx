import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import CardBatchReview, { type CardBatchItem } from '@/components/contacts/CardBatchReview'
import SessionsAutoRefresh from '@/components/email-ingestion/SessionsAutoRefresh'
import { readCardBatch } from '@/lib/contacts/card-batch'
import { effectiveEmailIntakeStatus } from '@/lib/utils/email-ingestion'

export const metadata = { title: 'Review — Business Cards' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CardBatchPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: session } = await supabase
    .from('email_intake_sessions')
    .select('id, label, status, updated_at, extraction_result, created_record_ids')
    .eq('id', id)
    .eq('intake_kind', 'cards')
    .single()

  if (!session) notFound()

  const back = (
    <Link
      href="/intake?tab=cards"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft size={14} /> Business Cards
    </Link>
  )

  if (session.status === 'confirmed') {
    const ids = (session.created_record_ids ?? {}) as { party_ids?: string[] }
    const n = ids.party_ids?.length ?? 0
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-emerald-300 dark:border-emerald-700/60 bg-emerald-50/60 dark:bg-emerald-950/40 p-5 text-center space-y-3">
          <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <p className="text-sm font-medium">
            Already saved — {n} contact{n === 1 ? '' : 's'} in the directory.
          </p>
          <Link
            href="/contacts"
            className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
          >
            Open the Directory
          </Link>
        </div>
      </div>
    )
  }

  const draft = readCardBatch(session.extraction_result)
  if (!draft) {
    return (
      <div className="space-y-5 max-w-3xl">
        {back}
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <p className="text-sm font-medium">Nothing to review.</p>
          <p className="text-sm text-muted-foreground">
            {typeof (session.extraction_result as { error?: unknown } | null)?.error === 'string'
              ? String((session.extraction_result as { error?: unknown }).error)
              : 'This batch never produced a card.'}
          </p>
        </div>
      </div>
    )
  }

  // `running` is what the SERVER is doing; the stale guard is what the reader
  // should believe. A batch writes its row after every card, so a row that has
  // not moved in fifteen minutes is a run that died, not a slow one.
  const running = effectiveEmailIntakeStatus(session.status, session.updated_at) === 'running'
  const ready = draft.items.filter((i) => i.state === 'ready').length

  return (
    <div className="space-y-5 max-w-3xl">
      {running && <SessionsAutoRefresh />}
      {back}
      <div>
        <h1 className="text-lg font-semibold">{session.label || 'Business cards'}</h1>
        <p className="text-sm text-muted-foreground">
          {ready} of {draft.items.length} card{draft.items.length === 1 ? '' : 's'} researched
          {draft.stats.research_reused > 0 &&
            ` · ${draft.stats.research_reused} shared a company already looked up`}
          . Check each one, fix anything the photo was read wrong, and save. Nothing is created
          until you do.
        </p>
      </div>
      <CardBatchReview
        sessionId={session.id}
        items={draft.items as unknown as CardBatchItem[]}
        running={running}
      />
    </div>
  )
}
