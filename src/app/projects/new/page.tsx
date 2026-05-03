import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import ProjectForm from '@/components/projects/ProjectForm'

export const metadata = { title: 'New Project — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<{ from?: string }>
}

export default async function NewProjectPage({ searchParams }: PageProps) {
  const params = await searchParams
  const fromReview = params.from === 'review'

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href={fromReview ? '/review' : '/projects'}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          {fromReview ? 'Review Queue' : 'Projects'}
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">New Project</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {fromReview
            ? 'Create the project, then return to the Review Queue to assign the email.'
            : 'Add a project to your pipeline.'}
        </p>
      </div>

      <ProjectForm mode="create" redirectAfterCreate={fromReview ? '/review' : undefined} />
    </div>
  )
}
