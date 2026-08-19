import Link from 'next/link'
import { ExternalLink, Wrench, Network } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import DinoDashboard from '@/components/dino/DinoDashboard'
import type { DinoRevenueRow } from '@/components/dino/RevenueLedger'
import type { DinoPaymentRow } from '@/components/dino/PaymentSchedule'
import type { DinoNoteRow } from '@/components/dino/DinoNotes'

export const metadata = { title: 'Dino Service Pros — Ber Wilson Intelligence' }

export default async function DinoPage() {
  const supabase = createAdminClient()

  const [{ data: revenueRaw, error }, { data: paymentsRaw }, { data: notesRaw }, { data: projectsRaw }] =
    await Promise.all([
      supabase
        .from('dino_revenue')
        .select('*, project:projects(id, name)')
        .order('revenue_date', { ascending: false }),
      supabase
        .from('dino_payments')
        .select('*')
        .order('paid', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('dino_notes').select('*').order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name').order('name', { ascending: true }),
    ])

  if (error) {
    throw new Error(`Failed to load Dino data: ${error.message}`)
  }

  const entries = (revenueRaw ?? []) as unknown as DinoRevenueRow[]
  const payments = (paymentsRaw ?? []) as DinoPaymentRow[]
  const notes = (notesRaw ?? []) as DinoNoteRow[]
  const projects = (projectsRaw ?? []) as { id: string; name: string }[]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <Wrench size={18} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight heading-tight">Dino Service Pros</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-xl">
              Our in-house plumbing &amp; HVAC company. Track revenue by source — Ber Wilson work vs. Dino&rsquo;s
              existing clients — and the payments we owe them.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/company/structure"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Network size={13} />
            Org structure
          </Link>
          <a
            href="https://www.dinoservicepros.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <ExternalLink size={13} />
            Website
          </a>
        </div>
      </div>

      <DinoDashboard entries={entries} projects={projects} payments={payments} notes={notes} />
    </div>
  )
}
