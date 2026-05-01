import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import ProjectForm from '@/components/projects/ProjectForm'

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

      <ProjectForm mode="edit" project={project} />
    </div>
  )
}
