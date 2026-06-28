'use client'

import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'

interface OpportunityTasksProps {
  opportunityId: string
  initialTasks: BoardTask[]
  teamMembers: TeamMember[]
}

/** Opportunity-scoped view of the team task board (mirrors the project Tasks tab). */
export default function OpportunityTasks({ opportunityId, initialTasks, teamMembers }: OpportunityTasksProps) {
  return (
    <TeamTaskBoard
      initialTasks={initialTasks}
      teamMembers={teamMembers}
      projects={[]}
      scopeOpportunityId={opportunityId}
      embedded
    />
  )
}
