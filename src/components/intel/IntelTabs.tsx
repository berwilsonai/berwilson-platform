'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import AgentChat from '@/components/agent/AgentChat'
import ConversationList from './ConversationList'

/**
 * Unified Intelligence interface — single agent that handles both
 * internal knowledge base queries and external web research.
 * The agent decides which tools to use based on the question.
 */
export default function IntelTabs() {
  const router = useRouter()
  const searchParams = useSearchParams()

  /*
    ⚠ WHICH CONVERSATION IS OPEN LIVES IN THE URL, NOT ONLY IN STATE (§12 — a
    filter kept in component state is not a view). It was state alone, which
    meant this page could not be linked to: the notification email, which
    exists to say "your answer is ready", had nowhere to point but the top of
    /intel with the answer still two clicks away.
  */
  const urlConversation = searchParams.get('conversation')
  const [conversationId, setConversationId] = useState<string | null>(urlConversation)
  // Bumped only on explicit selection (or New) — remounts the chat to load
  // the picked conversation without remounting mid-stream when a fresh chat
  // gets its conversation id assigned.
  const [chatSession, setChatSession] = useState(0)
  const [listVersion, setListVersion] = useState(0)

  function selectConversation(id: string | null) {
    setConversationId(id)
    setChatSession(s => s + 1)
    // Shallow — the page re-reads nothing on the server, so this only makes
    // the open conversation linkable and survivable across a reload.
    const next = new URLSearchParams(Array.from(searchParams.entries()))
    if (id) next.set('conversation', id)
    else next.delete('conversation')
    router.replace(next.size ? `/intel?${next}` : '/intel', { scroll: false })
  }

  return (
    /* A chat fills the viewport it is in. A fixed 650px left dead space below
       it on a laptop and pushed the composer under the browser chrome on a
       phone, where `dvh` is the unit that accounts for the collapsing toolbar. */
    <div className="flex gap-4 h-[calc(100dvh-13rem)] min-h-[28rem]">
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
