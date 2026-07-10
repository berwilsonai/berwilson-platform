import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer } from '@/lib/auth/viewer'
import RaiseForm from '@/components/investors/RaiseForm'

export const metadata = { title: 'Edit Raise — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditRaisePage({ params }: PageProps) {
  const { id } = await params
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/investors')

  const supabase = createAdminClient()
  const [{ data: raise }, { data: projects }] = await Promise.all([
    supabase.from('raises').select('*').eq('id', id).single(),
    supabase.from('projects').select('id, name').order('name'),
  ])

  if (!raise) notFound()

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={`/investors/raises/${id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          {raise.name}
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Edit Raise</h1>
      </div>

      <RaiseForm projects={projects ?? []} initial={raise} />
    </div>
  )
}
