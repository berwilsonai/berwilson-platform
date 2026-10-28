import { Suspense } from 'react'
import { Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import IntelTabs from '@/components/intel/IntelTabs'
import IntelSectionTabs from '@/components/intel/IntelSectionTabs'

export const metadata = { title: 'Intel — Ber Wilson Intelligence' }

export default function IntelPage() {
  return (
    <div className="space-y-5">
      {/*
        ⚠ THIS PAGE HAD NO TITLE OF ITS OWN. It opened straight onto a tab row,
        so the app's headline feature was one of three screens with nothing
        above the fold naming it — the 14px locator in `AppHeader` was the only
        thing on the page that said "Intel". The tab row moves into the header's
        own slot, which is what that slot is for, and the sentence that was
        floating between the tabs and the chat becomes the description.
      */}
      <PageHeader
        title="Ber AI"
        icon={Sparkles}
        description="Ask anything — the agent searches your portfolio data, documents, and the web automatically."
      >
        <IntelSectionTabs active="intel" />
      </PageHeader>

      {/* `IntelTabs` reads ?conversation= so a link can open one. Next
          requires a Suspense boundary around any client component calling
          useSearchParams, and without it the build fails on this route. */}
      <Suspense fallback={<div className="h-[calc(100dvh-13rem)] min-h-[28rem] rounded-xl border bg-background elev-1" />}>
        <IntelTabs />
      </Suspense>
    </div>
  )
}
