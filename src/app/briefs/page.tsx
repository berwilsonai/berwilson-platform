import { Sparkles, Calendar } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import BriefsList from '@/components/briefs/BriefsList'

export const metadata = { title: 'Briefs — Ber Wilson Intelligence' }

export default async function BriefsPage() {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: briefs } = await (supabase as any)
    .from('stored_briefs')
    .select('id, brief_type, title, content, metadata, model_used, latency_ms, created_at, project_id, projects(name)')
    .order('created_at', { ascending: false })
    .limit(30)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
          <Sparkles size={16} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Intelligence Briefs</h1>
          <p className="text-xs text-muted-foreground">
            Daily briefs, meeting preps, and project summaries — generated automatically
          </p>
        </div>
      </div>

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <BriefsList briefs={(briefs ?? []).map((b: any) => ({
        id: b.id,
        brief_type: b.brief_type,
        title: b.title,
        content: b.content,
        metadata: b.metadata as Record<string, unknown> | null,
        model_used: b.model_used,
        latency_ms: b.latency_ms,
        created_at: b.created_at,
        project_name: (b.projects as unknown as { name: string } | null)?.name ?? null,
      }))} />
    </div>
  )
}
