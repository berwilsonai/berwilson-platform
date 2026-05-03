'use client'

import { useState } from 'react'
import { Search, Bot } from 'lucide-react'
import IntelClient from './IntelClient'
import AgentTab from './AgentTab'

export default function IntelTabs() {
  const [tab, setTab] = useState<'queries' | 'agent'>('agent')

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b">
        <button
          onClick={() => setTab('agent')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'agent'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bot size={14} />
          Agent
        </button>
        <button
          onClick={() => setTab('queries')}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'queries'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Search size={14} />
          Queries
        </button>
      </div>

      {/* Tab content */}
      {tab === 'queries' && <IntelClient />}
      {tab === 'agent' && <AgentTab />}
    </div>
  )
}
