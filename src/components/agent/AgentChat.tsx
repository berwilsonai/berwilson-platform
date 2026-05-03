'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, ThumbsUp, ThumbsDown } from 'lucide-react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
  latencyMs?: number
  createdAt?: string
  rating?: 1 | -1 | null
}

interface AgentChatProps {
  projectId?: string
  className?: string
}

export default function AgentChat({ projectId, className = '' }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load existing conversation for this project
  useEffect(() => {
    if (!projectId) return
    fetch(`/api/ai/agent?projectId=${projectId}`)
      .then(r => r.json())
      .then((data: { conversations?: Array<{ id: string }> }) => {
        if (data.conversations?.[0]) {
          const convId = data.conversations[0].id
          setConversationId(convId)
          // Load messages
          fetch(`/api/ai/agent?conversationId=${convId}`)
            .then(r => r.json())
            .then((msgData: { messages?: Array<{ id: string; role: string; content: string; tool_calls?: string; latency_ms?: number; created_at?: string }> }) => {
              if (msgData.messages) {
                setMessages(
                  msgData.messages
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({
                      id: m.id,
                      role: m.role as 'user' | 'assistant',
                      content: m.content,
                      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
                      latencyMs: m.latency_ms ?? undefined,
                      createdAt: m.created_at ?? undefined,
                    }))
                )
              }
            })
        }
      })
      .catch(() => {})
  }, [projectId])

  const sendMessage = useCallback(async () => {
    const msg = input.trim()
    if (!msg || loading) return

    setInput('')
    setError(null)

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: msg,
    }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          conversationId,
          projectId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Request failed (${res.status})`)
      }

      const data = await res.json() as {
        response: string
        conversationId: string
        messageId?: string
        toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
        latencyMs?: number
      }

      setConversationId(data.conversationId)

      const assistantMsg: Message = {
        id: data.messageId ?? `resp-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        toolCalls: data.toolCalls,
        latencyMs: data.latencyMs,
        rating: null,
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, conversationId, projectId])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  async function rateMessage(messageId: string, value: 1 | -1) {
    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, rating: value } : m))
    await fetch('/api/eval/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'agent_messages', id: messageId, rating: value }),
    }).catch(() => {})
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-3">
              <Bot size={20} className="text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">Executive Intelligence Agent</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px]">
              Ask about project status, risks, compliance, financials, or portfolio performance.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={12} className="text-primary" />
              </div>
            )}
            <div
              className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-foreground'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm prose-slate max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/40">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    Data sources: {msg.toolCalls.map(t => t.name.replace(/_/g, ' ')).join(', ')}
                  </p>
                </div>
              )}
              {msg.latencyMs && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {(msg.latencyMs / 1000).toFixed(1)}s
                </p>
              )}
              {msg.role === 'assistant' && !msg.id.startsWith('tmp-') && (
                <div className="flex items-center gap-0.5 mt-1.5 pt-1 border-t border-border/30">
                  <button
                    onClick={() => rateMessage(msg.id, 1)}
                    title="Helpful"
                    className={`p-1 rounded transition-colors ${msg.rating === 1 ? 'text-emerald-600 bg-emerald-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <ThumbsUp size={11} />
                  </button>
                  <button
                    onClick={() => rateMessage(msg.id, -1)}
                    title="Not helpful"
                    className={`p-1 rounded transition-colors ${msg.rating === -1 ? 'text-red-600 bg-red-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <ThumbsDown size={11} />
                  </button>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                <User size={12} className="text-slate-600" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2 items-start">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot size={12} className="text-primary" />
            </div>
            <div className="bg-muted/60 rounded-lg px-3 py-2">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={12} />
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t bg-background px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this project..."
            rows={1}
            className="flex-1 resize-none rounded-lg border bg-muted/30 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 min-h-[36px] max-h-[120px]"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="shrink-0 w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
