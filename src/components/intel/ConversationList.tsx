'use client'

import { useState, useEffect } from 'react'
import { Plus, MessageSquare, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface Conversation {
  id: string
  title: string
  updated_at: string
}

interface ConversationListProps {
  activeConversationId: string | null
  onSelectConversation: (id: string | null) => void
  /** Bump to re-fetch the list (e.g. after a new conversation is created). */
  refreshToken?: number
}

export default function ConversationList({ activeConversationId, onSelectConversation, refreshToken }: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)

  useEffect(() => {
    fetch('/api/ai/agent')
      .then(r => r.json())
      .then((data: { conversations?: Conversation[] }) => {
        setConversations(data.conversations ?? [])
      })
      .catch(() => {})
  }, [refreshToken])

  async function deleteConversation(conv: Conversation) {
    const res = await fetch(`/api/ai/agent?conversationId=${conv.id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Delete failed')
    setConversations(prev => prev.filter(c => c.id !== conv.id))
    if (activeConversationId === conv.id) onSelectConversation(null)
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86_400_000)

    if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="h-full flex flex-col rounded-xl border bg-card overflow-hidden">
      <div className="px-3 py-2.5 border-b flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">History</span>
        <button
          onClick={() => onSelectConversation(null)}
          className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
          title="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {conversations.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <MessageSquare size={16} className="mx-auto text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground">No conversations yet</p>
          </div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group relative flex items-center hover:bg-accent/70 transition-colors ${
                activeConversationId === conv.id ? 'bg-primary/5 border-l-2 border-primary' : ''
              }`}
            >
              <button
                onClick={() => onSelectConversation(conv.id)}
                className="flex-1 min-w-0 text-left px-3 py-2.5"
              >
                <p className="text-xs font-medium text-foreground truncate pr-5">{conv.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{formatDate(conv.updated_at)}</p>
              </button>
              <button
                onClick={() => setPendingDelete(conv)}
                title="Delete conversation"
                aria-label="Delete conversation"
                className="absolute right-1.5 top-1.5 p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title="Delete this conversation?"
        description={`"${pendingDelete?.title ?? ''}" and all its messages will be removed permanently. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (pendingDelete) return deleteConversation(pendingDelete) }}
      />
    </div>
  )
}
