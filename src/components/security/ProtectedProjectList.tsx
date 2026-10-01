import Link from 'next/link'
import { Lock } from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/card'

/**
 * Protected projects, listed apart from the portfolio.
 *
 * Lifted out of the main list rather than redacted inside it, for two reasons.
 * The list renderer has several paths — program card, pipeline column, table row
 * — and a blanked value would read as a missing figure in all of them (§12: a
 * bare em dash at a value's own weight reads as a failed render). And the count
 * on the toolbar is a different quantity from this one, so they must be named
 * apart rather than summed.
 *
 * Nothing but the name. The name is what makes the project findable, which is
 * the whole job of this block; the value, the client and the stage are what a
 * glance over somebody's shoulder is worth, so they wait for a code.
 */
export default function ProtectedProjectList({
  projects,
}: {
  projects: Array<{ id: string; name: string }>
}) {
  if (projects.length === 0) return null

  return (
    <Panel>
      <PanelHeader label="Protected" count={projects.length} />
      <ul className="divide-y divide-border">
        {projects.map((project) => (
          <li key={project.id}>
            <Link
              href={`/projects/${project.id}`}
              className="flex min-h-11 items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
            >
              <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Needs a code</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
