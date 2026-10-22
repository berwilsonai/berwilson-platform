import { Suspense } from 'react'
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

      {/* `IntelTabs` reads ?conversation= so a link can open one. Next
          requires a Suspense boundary around any client component calling
          useSearchParams, and without it the build fails on this route. */}
      <Suspense fallback={<div className="h-[calc(100dvh-13rem)] min-h-[28rem] rounded-xl border bg-background elev-1" />}>
        <IntelTabs />
      </Suspense>
    </div>
  )
}
