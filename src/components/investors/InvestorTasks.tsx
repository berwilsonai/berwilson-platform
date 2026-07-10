'use client'

import TeamTaskBoard from '@/components/tasks/TeamTaskBoard'
import type { BoardTask, TeamMember } from '@/components/tasks/task-utils'

interface InvestorTasksProps {
  investorId: string
  initialTasks: BoardTask[]
  teamMembers: TeamMember[]
}

/** Investor-scoped view of the team task board (mirrors the opportunity tasks section). */
export default function InvestorTasks({ investorId, initialTasks, teamMembers }: InvestorTasksProps) {
  return (
    <TeamTaskBoard
      initialTasks={initialTasks}
      teamMembers={teamMembers}
      projects={[]}
      scopeInvestorId={investorId}
      embedded
    />
  )
}
