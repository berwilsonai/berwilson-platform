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
  // Bumped only on explicit selection (or New) — remounts the chat to load
  // the picked conversation without remounting mid-stream when a fresh chat
  // gets its conversation id assigned.
  const [chatSession, setChatSession] = useState(0)
  const [listVersion, setListVersion] = useState(0)

  function selectConversation(id: string | null) {
    setConversationId(id)
    setChatSession(s => s + 1)
  }

  return (
    <div className="flex gap-4 h-[650px]">
      {/* Conversation history sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <ConversationList
          activeConversationId={conversationId}
          onSelectConversation={selectConversation}
          refreshToken={listVersion}
        />
      </aside>

      {/* Main chat */}
      <div className="flex-1 min-w-0 border rounded-xl bg-background elev-1 flex flex-col overflow-hidden">
        <AgentChat
          key={chatSession}
          conversationId={conversationId}
          onConversationCreated={(id) => {
            setConversationId(id)
            setListVersion(v => v + 1)
          }}
          placeholder="Ask about your portfolio, projects, people, or the market..."
          className="flex-1 min-h-0"
        />
      </div>
    </div>
  )
}
