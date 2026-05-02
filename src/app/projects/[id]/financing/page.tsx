import { createAdminClient } from '@/lib/supabase/admin'
import FinancingTab from '@/components/projects/FinancingTab'
import type { FinancingWithSchedule } from '@/types/domain'
import type { DrawScheduleEntry } from '@/types/domain'

export const metadata = { title: 'Financing — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function FinancingPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('financing_structures')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  // Cast the JSONB draw_schedule to the typed domain shape
  const financing: FinancingWithSchedule | null = data
    ? {
        ...data,
        draw_schedule: Array.isArray(data.draw_schedule)
          ? (data.draw_schedule as unknown as DrawScheduleEntry[])
          : null,
      }
    : null

  return <FinancingTab projectId={id} initialFinancing={financing} />
}
