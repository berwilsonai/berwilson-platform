import { createAdminClient } from '@/lib/supabase/admin'
import FinancingTab from '@/components/projects/FinancingTab'
import type { FinancingWithSchedule, DrawScheduleEntry } from '@/types/domain'

export const metadata = { title: 'Financing — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function OpportunityFinancingPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('financing_structures')
    .select('*')
    .eq('opportunity_id', id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // `investments` target the parent company or a PROJECT (optionally via an
  // SPV) — an opportunity is not one of its targets, so there is no investor
  // roll-up here the way there is on a project. Recording the capital stack
  // for a deal still belongs on the deal.
  const financing: FinancingWithSchedule | null = data
    ? {
        ...data,
        draw_schedule: Array.isArray(data.draw_schedule)
          ? (data.draw_schedule as unknown as DrawScheduleEntry[])
          : null,
      }
    : null

  return <FinancingTab recordKind="opportunity" recordId={id} initialFinancing={financing} />
}
