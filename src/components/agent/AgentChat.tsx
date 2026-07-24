'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  /** Scope the chat to a single reference document (digest / Q&A). */
  documentId?: string
  className?: string
  placeholder?: string
  /** Seed the input box (e.g. handed off from the command palette). */
  initialInput?: string
  /** Open an existing conversation (loads its messages on mount). */
  conversationId?: string | null
  /** Fires when sending in a fresh chat creates a new persisted conversation. */
  onConversationCreated?: (id: string) => void
  /** Show a "clear conversation" control (for surfaces without a history list). */
  showClear?: boolean
}

export default function AgentChat({
  projectId,
  documentId,
  className = '',
  placeholder = 'Ask about this project...',
  initialInput,
  conversationId: initialConversationId = null,
  onConversationCreated,
  showClear = false,
}: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [activity, setActivity] = useState<string | null>(null) // live tool-call label while streaming
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId)
  const [confirmClear, setConfirmClear] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Seed input handed off from the command palette (never clobber typed text).
  // Derived-state-during-render pattern — reacts to a changed seed without an effect.
  const [lastSeed, setLastSeed] = useState(initialInput)
  if (initialInput !== lastSeed) {
    setLastSeed(initialInput)
    if (initialInput && !input) setInput(initialInput)
  }

  // Load an explicitly selected conversation, or the latest one for a project
  useEffect(() => {
    const loadMessages = (convId: string) =>
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

    if (initialConversationId) {
      loadMessages(initialConversationId).catch(() => {})
      return
    }
    const scopeQuery = projectId
      ? `projectId=${projectId}`
      : documentId
      ? `documentId=${documentId}`
      : null
    if (!scopeQuery) return
    fetch(`/api/ai/agent?${scopeQuery}`)
      .then(r => r.json())
      .then((data: { conversations?: Array<{ id: string }> }) => {
        if (data.conversations?.[0]) {
          const convId = data.conversations[0].id
          setConversationId(convId)
          return loadMessages(convId)
        }
      })
      .catch(() => {})
  }, [projectId, documentId, initialConversationId])

  const sendMessage = useCallback(async () => {
    const msg = input.trim()
    if (!msg || loading) return

    setInput('')
    setError(null)
    setActivity(null)

    const userMsg: Message = {
      id: `tmp-${Date.now()}`,
      role: 'user',
      content: msg,
    }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    // Placeholder assistant message that fills in as the stream arrives
    const streamId = `stream-${Date.now()}`

    // If the network stream dies mid-run (iPhone Safari kills idle or
    // backgrounded connections — "Load failed"), the server still finishes
    // and persists the answer. Poll the conversation and pick it up instead
    // of failing the message.
    const recoverAnswer = async (): Promise<boolean> => {
      type StoredMsg = { id: string; role: string; content: string; tool_calls?: string | null; latency_ms?: number | null }
      const deadline = Date.now() + 240_000
      let convId = conversationId
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000))
        try {
          // Fresh chat: the conversation was created server-side before the
          // drop — find it by scope + title (title = the message prefix).
          if (!convId) {
            const scope = projectId ? `?projectId=${projectId}` : documentId ? `?documentId=${documentId}` : ''
            const listRes = await fetch(`/api/ai/agent${scope}`)
            const listData = await listRes.json() as { conversations?: Array<{ id: string; title: string }> }
            const match = (listData.conversations ?? []).find(c => c.title === msg.slice(0, 100))
            if (!match) continue
            convId = match.id
          }
          const res = await fetch(`/api/ai/agent?conversationId=${convId}`)
          if (!res.ok) continue
          const data = await res.json() as { messages?: StoredMsg[] }
          const all = data.messages ?? []
          const lastUserIdx = all.map(m => m.role === 'user' && m.content === msg).lastIndexOf(true)
          if (lastUserIdx === -1) continue
          const answer = all.slice(lastUserIdx + 1).find(m => m.role === 'assistant')
          if (!answer) continue // run still in progress server-side — keep polling

          let toolCalls: Message['toolCalls']
          try { toolCalls = answer.tool_calls ? JSON.parse(answer.tool_calls) : undefined } catch { toolCalls = undefined }
          const recoveredConvId = convId
          setMessages(prev => [
            ...prev.filter(m => m.id !== streamId),
            {
              id: answer.id,
              role: 'assistant',
              content: answer.content,
              toolCalls,
              latencyMs: answer.latency_ms ?? undefined,
              rating: null,
            },
          ])
          if (!conversationId) onConversationCreated?.(recoveredConvId)
          setConversationId(recoveredConvId)
          return true
        } catch { /* transient — keep polling until the deadline */ }
      }
      return false
    }

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          conversationId,
          projectId,
          documentId,
          stream: true,
        }),
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        // A server refusal (auth, rate limit, bad request) is final — no recovery.
        throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { noRecover: true })
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let started = false

      const appendDelta = (delta: string) => {
        if (!started) {
          started = true
          setActivity(null)
          setMessages(prev => [...prev, { id: streamId, role: 'assistant', content: delta, rating: null }])
        } else {
          setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: m.content + delta } : m))
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE events are separated by a blank line
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const raw of events) {
          const line = raw.trim()
          if (!line.startsWith('data:')) continue
          let event: {
            type: string
            name?: string
            delta?: string
            message?: string
            conversationId?: string
            messageId?: string | null
            toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
            latencyMs?: number
          }
          try { event = JSON.parse(line.slice(5).trim()) } catch { continue }

          if (event.type === 'tool' && event.name) {
            setActivity(event.name.replace(/_/g, ' '))
          } else if (event.type === 'text' && event.delta) {
            appendDelta(event.delta)
          } else if (event.type === 'done') {
            if (event.conversationId) {
              if (!conversationId) onConversationCreated?.(event.conversationId)
              setConversationId(event.conversationId)
            }
            setMessages(prev => prev.map(m => m.id === streamId
              ? {
                  ...m,
                  id: event.messageId ?? m.id,
                  toolCalls: event.toolCalls,
                  latencyMs: event.latencyMs,
                }
              : m))
          } else if (event.type === 'error') {
            // The server itself reported failure — nothing to recover.
            throw Object.assign(new Error(event.message ?? 'Agent execution failed'), { noRecover: true })
          }
        }
      }

      if (!started) throw new Error('The agent returned no response — try again.')
    } catch (err) {
      // Network-layer drop ("Load failed") — the server keeps working and
      // persists the answer; try to recover it. Server-reported failures
      // (noRecover) surface immediately.
      let recovered = false
      if (!(err as { noRecover?: boolean }).noRecover) {
        setActivity('the connection — still working')
        recovered = await recoverAnswer()
      }
      if (!recovered) {
        // Drop the empty placeholder if nothing streamed
        setMessages(prev => prev.filter(m => m.id !== streamId || m.content))
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    } finally {
      setLoading(false)
      setActivity(null)
      inputRef.current?.focus()
    }
  }, [input, loading, conversationId, projectId, documentId, onConversationCreated])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  async function clearConversation() {
    if (conversationId) {
      const res = await fetch(`/api/ai/agent?conversationId=${conversationId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    }
    setMessages([])
    setConversationId(null)
    setError(null)
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
      {/* Optional clear-conversation header (surfaces without a history list) */}
      {showClear && conversationId && messages.length > 0 && (
        <div className="flex items-center justify-end px-3 py-1.5 border-b bg-background">
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 size={12} />
            Clear conversation
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-4 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 px-4">
            <div className="size-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center mb-3 elev-1">
              <Bot size={22} />
            </div>
            <p className="text-sm font-semibold text-foreground">Ask Ber AI</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
              {documentId
                ? 'Ask anything about this document — it will answer from the text, quote passages, and explain dense sections.'
                : 'Your executive intelligence agent — it reads the portfolio, documents, tasks, and the raise before answering.'}
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 mt-4 max-w-[420px]">
              {(documentId
                ? [
                    'Give me a plain-language outline of this document',
                    'What are the key obligations and deadlines?',
                    'What dollar amounts and terms should I know?',
                    'What are the risks or red flags here?',
                  ]
                : projectId
                ? [
                    'Summarize where this project stands',
                    'What are the biggest risks here?',
                    'Who are the key players on this project?',
                  ]
                : [
                    'What needs my attention today?',
                    'Where does the capital raise stand?',
                    'Which projects are stalled?',
                    'Draft a status update for Eric',
                  ]
              ).map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    setInput(q)
                    inputRef.current?.focus()
                  }}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
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
              className={`rounded-lg px-3 py-2 max-w-[85%] min-w-0 break-words text-sm ${
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
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Data sources: {msg.toolCalls.map(t => t.name.replace(/_/g, ' ')).join(', ')}
                  </p>
                </div>
              )}
              {msg.latencyMs && (
                <p className="text-xs text-muted-foreground mt-1">
                  {(msg.latencyMs / 1000).toFixed(1)}s
                </p>
              )}
              {msg.role === 'assistant' && !msg.id.startsWith('tmp-') && (
                <div className="flex items-center gap-0.5 mt-1.5 pt-1 border-t border-border/30">
                  <ReadAloudButton text={msg.content} />
                  <button
                    onClick={() => rateMessage(msg.id, 1)}
                    title="Helpful"
                    className={`p-1 rounded transition-colors ${msg.rating === 1 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <ThumbsUp size={11} />
                  </button>
                  <button
                    onClick={() => rateMessage(msg.id, -1)}
                    title="Not helpful"
                    className={`p-1 rounded transition-colors ${msg.rating === -1 ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <ThumbsDown size={11} />
                  </button>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-900/60 flex items-center justify-center shrink-0 mt-0.5">
                <User size={12} className="text-slate-600 dark:text-slate-400" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2 items-start">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot size={12} className="text-primary" />
            </div>
            <div className="bg-muted/60 rounded-lg px-3 py-2 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {activity ? `Checking ${activity}…` : 'Thinking…'}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">
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
            placeholder={placeholder}
            rows={1}
            className="flex-1 min-w-0 resize-none rounded-lg border bg-muted/30 px-3 py-2 text-base sm:text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 min-h-[36px] max-h-[120px]"
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

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear this conversation?"
        description="This conversation and all its messages will be removed permanently. This can't be undone."
        confirmLabel="Clear"
        destructive
        onConfirm={clearConversation}
      />
    </div>
  )
}
