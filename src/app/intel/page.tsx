import { Brain } from 'lucide-react'
import IntelTabs from '@/components/intel/IntelTabs'

export const metadata = { title: 'Intel — Ber Wilson Intelligence' }

export default function IntelPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
          <Brain size={16} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Intelligence</h1>
          <p className="text-xs text-muted-foreground">
            Query your data or chat with the Executive Agent across your full portfolio
          </p>
        </div>
      </div>

      {/* Tabbed interface: Queries | Agent */}
      <IntelTabs />
    </div>
  )
}
