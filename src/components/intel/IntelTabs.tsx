'use client'

import { useState } from 'react'
import AgentChat from '@/components/agent/AgentChat'
import ConversationList from './ConversationList'

/**
 * Unified Intelligence interface — single agent that handles both
 * internal knowledge base queries and external web research.
 * The agent decides which tools to use based on the question.
 */
export default function IntelTabs() {
  const [conversationId, setConversationId] = useState<string | null>(null)

  return (
    <div className="flex gap-4 h-[650px]">
      {/* Conversation history sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <ConversationList
          activeConversationId={conversationId}
          onSelectConversation={setConversationId}
        />
      </aside>

      {/* Main chat */}
      <div className="flex-1 min-w-0 border rounded-xl bg-background shadow-sm flex flex-col overflow-hidden">
        <AgentChat
          key={conversationId ?? 'new'}
          className="flex-1 min-h-0"
        />
      </div>
    </div>
  )
}
