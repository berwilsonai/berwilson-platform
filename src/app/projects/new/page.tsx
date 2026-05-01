import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import ProjectForm from '@/components/projects/ProjectForm'

export const metadata = { title: 'New Project — Ber Wilson Intelligence' }

export default function NewProjectPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/projects"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Projects
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">New Project</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Add a project to your pipeline.
        </p>
      </div>

      <ProjectForm mode="create" />
    </div>
  )
}
