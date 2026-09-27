import IntelTabs from '@/components/intel/IntelTabs'
import IntelSectionTabs from '@/components/intel/IntelSectionTabs'

export const metadata = { title: 'Intel — Ber Wilson Intelligence' }

export default function IntelPage() {
  return (
    <div className="space-y-5">
      <IntelSectionTabs active="intel" />

      <p className="text-xs text-muted-foreground">
        Ask anything — the agent searches your portfolio data, documents, and the web automatically
      </p>

      <IntelTabs />
    </div>
  )
}
