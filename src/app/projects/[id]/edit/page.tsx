import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import ProjectForm from '@/components/projects/ProjectForm'

export const metadata = { title: 'Edit Project — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditProjectPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Fetch available parents: top-level projects that aren't this project
  // and aren't already children of this project
  const { data: topLevel } = await supabase
    .from('projects')
    .select('id, name')
    .is('parent_project_id', null)
    .neq('id', id)
    .order('name')

  // Exclude projects that are children of the current project (can't make a parent into a child of itself)
  const { data: children } = await supabase
    .from('projects')
    .select('id')
    .eq('parent_project_id', id)

  const childIds = new Set((children ?? []).map((c) => c.id))
  const availableParents = (topLevel ?? []).filter((p) => !childIds.has(p.id))

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={`/projects/${id}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          {project.name}
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Edit Project</h1>
      </div>

      <ProjectForm mode="edit" project={project} availableParents={availableParents} />
    </div>
  )
}
