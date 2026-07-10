import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import RaiseForm from '@/components/investors/RaiseForm'

export const metadata = { title: 'New Raise — Ber Wilson Intelligence' }

export default async function NewRaisePage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/investors')

  const supabase = createAdminClient()
  const { data: projects } = await supabase.from('projects').select('id, name').order('name')

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/investors"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Investors
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">New Raise</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Name the raise, set the target, and lay out the tranche schedule. Investor commitments tag the
          raise and fill tranches in order.
        </p>
      </div>

      <RaiseForm projects={projects ?? []} />
    </div>
  )
}
