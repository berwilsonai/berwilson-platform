'use client'

import AgentChat from '@/components/agent/AgentChat'

export default function AgentTab() {
  return (
    <div className="border rounded-xl bg-background shadow-sm h-[600px] flex flex-col overflow-hidden">
      <AgentChat className="flex-1 min-h-0" />
    </div>
  )
}
