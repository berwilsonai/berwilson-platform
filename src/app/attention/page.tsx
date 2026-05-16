import { AlertTriangle } from 'lucide-react'
import AttentionList from '@/components/attention/AttentionList'

export const metadata = { title: 'Attention — Ber Wilson Intelligence' }

export default function AttentionPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10">
          <AlertTriangle size={16} className="text-red-500" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">What&apos;s Falling Through the Cracks</h1>
          <p className="text-xs text-muted-foreground">
            Overdue items, stale blockers, approaching deadlines, and unfollowed decisions
          </p>
        </div>
      </div>

      <AttentionList />
    </div>
  )
}
