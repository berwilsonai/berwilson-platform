'use client'

import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'

interface TasksTabProps {
  projectId: string
  initialTasks: BoardTask[]
  teamMembers: TeamMember[]
}

/** Project-scoped view of the team task board. */
export default function TasksTab({ projectId, initialTasks, teamMembers }: TasksTabProps) {
  return (
    <TeamTaskBoard
      initialTasks={initialTasks}
      teamMembers={teamMembers}
      projects={[]}
      scopeProjectId={projectId}
    />
  )
}
