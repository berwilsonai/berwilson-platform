'use client'

import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'

interface TasksTabProps {
  projectId: string
  initialTasks: BoardTask[]
  teamMembers: TeamMember[]
  /** Open the add form on arrival — `?new=1` from the header's Log menu. */
  startAdd?: boolean
}

/** Project-scoped view of the team task board. */
export default function TasksTab({ projectId, initialTasks, teamMembers, startAdd = false }: TasksTabProps) {
  return (
    <TeamTaskBoard
      initialTasks={initialTasks}
      teamMembers={teamMembers}
      projects={[]}
      scopeProjectId={projectId}
      startAdd={startAdd}
    />
  )
}
