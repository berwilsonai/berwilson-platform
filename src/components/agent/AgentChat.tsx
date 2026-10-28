'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Send, Bot, User, Loader2, AlertCircle, ThumbsUp, ThumbsDown, Trash2, ArrowUpRight, ArrowRight } from 'lucide-react'

import { BriefMarkdown } from '@/components/briefs/BriefMarkdown'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import Link from 'next/link'
import PushToTalkButton from './PushToTalkButton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { citationsFor } from '@/lib/agent/citations'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>
  latencyMs?: number
  createdAt?: string
  rating?: 1 | -1 | null
}

/**
 * How long the client will keep looking for an answer.
 *
 * Mirrors the server's `AGENT_TIME_BUDGET_MS` default (30 min). The server
 * value is the authoritative one and is not readable from the browser, so this
 * is deliberately set to the default rather than guessed lower: erring HIGH
 * only costs a few more polls against a run that has already ended, while
 * erring low abandons an answer that is still coming — which is exactly what
 * the old flat 240s cap did to every turn over four minutes.
 */
const AGENT_TIME_BUDGET_MS = 1_800_000

/** A message as the API stores it. */
interface StoredMsg {
  id: string
  role: string
  content: string
  tool_calls?: string | null
  latency_ms?: number | null
}

/** What the API says about a question still being worked on. */
interface InFlight {
  messageId: string
  conversationId: string
  question: string
  startedAt: string
}

/**
 * Wait for an answer that is being written somewhere this browser cannot see.
 *
 * ⚠ ONE POLLER, TWO CALLERS (§12 — never fork a shared pass; add a target).
 * This began as `recoverAnswer`, declared inside `sendMessage` and reachable
 * only from the catch that handles a dropped stream. The reattach path needs
 * exactly the same loop, and writing a second one for it would have been the
 * fork that is hardest to see — two functions days apart, neither looking like
 * a copy of the other.
 *
 * The run itself always survives: nothing in the route reads `request.signal`,
 * so the server finishes and persists the answer whether the asker is watching,
 * on another page, in another tab, or gone. This only finds it again.
 */
async function pollForAnswer(args: {
  question: string
  conversationId: string | null
  scopeQuery: string
  /** Absolute epoch ms to give up at. */
  deadline: number
  /** Set by the caller on unmount so a dead component stops polling. */
  cancelled: () => boolean
}): Promise<{ conversationId: string; answer: StoredMsg } | null> {
  let convId = args.conversationId

  while (Date.now() < args.deadline) {
    await new Promise(r => setTimeout(r, 5000))
    if (args.cancelled()) return null
    try {
      // Fresh chat: the conversation was created server-side before the drop —
      // find it by scope + title (the title is the message prefix).
      if (!convId) {
        const listRes = await fetch(`/api/ai/agent?${args.scopeQuery}`)
        const listData = await listRes.json() as { conversations?: Array<{ id: string; title: string }> }
        const match = (listData.conversations ?? []).find(c => c.title === args.question.slice(0, 100))
        if (!match) continue
        convId = match.id
      }
      const res = await fetch(`/api/ai/agent?conversationId=${convId}`)
      if (!res.ok) continue
      const data = await res.json() as { messages?: StoredMsg[] }
      const all = data.messages ?? []
      const lastUserIdx = all.map(m => m.role === 'user' && m.content === args.question).lastIndexOf(true)
      if (lastUserIdx === -1) continue
      const answer = all.slice(lastUserIdx + 1).find(m => m.role === 'assistant')
      if (!answer) continue // still in progress server-side — keep polling
      return { conversationId: convId, answer }
    } catch { /* transient — keep polling until the deadline */ }
  }
  return null
}

/** Turn a stored row into a rendered message. */
function toMessage(m: StoredMsg): Message {
  let toolCalls: Message['toolCalls']
  try { toolCalls = m.tool_calls ? JSON.parse(m.tool_calls) : undefined } catch { toolCalls = undefined }
  return {
    id: m.id,
    role: 'assistant',
    content: m.content,
    toolCalls,
    latencyMs: m.latency_ms ?? undefined,
    rating: null,
  }
}

interface AgentChatProps {
  projectId?: string
  /** Scope the chat to an opportunity — the other half of the deal pipeline. */
  opportunityId?: string
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
  /**
   * An answer arrived. Fired for every completed turn, including one picked up
   * by the reattach — the dock uses it to raise a toast when it is closed, so
   * a question answered while you were on another page announces itself.
   *
   * ⚠ IT CARRIES THE MESSAGE ID BECAUSE THE DOCK HAS TO REPORT A VERDICT ON IT.
   * Whether the asker was watching is a fact only the browser holds — the dock
   * stays mounted while CLOSED, so an open connection tells the server nothing
   * — and that verdict is what decides whether the answer is emailed.
   */
  onAnswered?: (answer: string, messageId: string | null) => void
}

export default function AgentChat({
  projectId,
  opportunityId,
  documentId,
  className = '',
  placeholder = 'Ask about this project...',
  initialInput,
  conversationId: initialConversationId = null,
  onConversationCreated,
  showClear = false,
  onAnswered,
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

  /*
    Stop polling once this component is gone.

    The RUN is never cancelled by this — the server has no idea the browser
    left and finishes regardless, which is the whole point. This only stops a
    dead component's loop from fetching every five seconds forever after the
    dock remounts on a record boundary.
  */
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => { cancelledRef.current = true }
  }, [])

  /*
    This chat's scope, as one query string.

    ⚠ It was spelled out in THREE places — the history load, the
    dropped-stream recovery lookup, and the POST body — so adding a second
    record type meant finding all three or silently scoping two of them
    differently. One value, and `tsc` names every reader if a third kind is
    added.
  */
  /*
    ⚠ `scope=portfolio` IS A SCOPE, NOT THE ABSENCE OF ONE. This returned null
    for the portfolio-wide dock, and every reader then either skipped
    (`if (!scopeQuery) return`, so ⌘J never resumed anything and each reload
    started from a blank slate) or listed with no filter at all — which returns
    every conversation the user owns, so "the most recent" would have been
    whichever deal chat was newest, opening on the dashboard. The server reads
    this value as "all three record pointers NULL".
  */
  const scopeQuery = useMemo(() => {
    if (projectId) return `projectId=${projectId}`
    if (opportunityId) return `opportunityId=${opportunityId}`
    if (documentId) return `documentId=${documentId}`
    return 'scope=portfolio'
  }, [projectId, opportunityId, documentId])

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
    const applyMessages = (rows?: StoredMsg[]) => {
      if (!rows) return
      setMessages(
        rows
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
            latencyMs: m.latency_ms ?? undefined,
            createdAt: (m as StoredMsg & { created_at?: string }).created_at ?? undefined,
          }))
      )
    }

    const loadMessages = (convId: string) =>
      fetch(`/api/ai/agent?conversationId=${convId}`)
        .then(r => r.json())
        .then((msgData: { messages?: StoredMsg[] }) => applyMessages(msgData.messages))

    /*
      Reattach to a question still being answered.

      This is the whole "ask it and walk away" mechanism, and it is one
      mechanism rather than three: the same call fixes the dock remounting as
      you step onto a project page, a browser reload, and a second tab —
      because none of those ever stopped the run, they only lost sight of it.
      The question is already a persisted row (the route writes it before
      starting), so `loadMessages` renders it and this just resumes the wait.
    */
    const reattach = async (run: InFlight) => {
      setConversationId(run.conversationId)
      setLoading(true)
      setActivity('still working')
      const found = await pollForAnswer({
        question: run.question,
        conversationId: run.conversationId,
        scopeQuery,
        // The server's own deadline, not a fresh one — a turn that started
        // twelve minutes ago has eighteen left, and starting the clock again
        // here would wait for a run that is already over.
        deadline: new Date(run.startedAt).getTime() + AGENT_TIME_BUDGET_MS,
        cancelled: () => cancelledRef.current,
      })
      if (cancelledRef.current) return
      setLoading(false)
      setActivity(null)
      if (found) {
        setMessages(prev => [...prev, toMessage(found.answer)])
        onAnswered?.(found.answer.content, found.answer.id)
      } else {
        setError('That question stopped before it finished — it was probably interrupted by a deploy. Ask it again.')
      }
    }

    if (initialConversationId) {
      fetch(`/api/ai/agent?conversationId=${initialConversationId}`)
        .then(r => r.json())
        .then((data: { messages?: StoredMsg[]; inFlight?: InFlight | null }) => {
          applyMessages(data.messages)
          if (data.inFlight) void reattach(data.inFlight)
        })
        .catch(() => {})
      return
    }

    fetch(`/api/ai/agent?${scopeQuery}`)
      .then(r => r.json())
      .then(async (data: {
        conversations?: Array<{ id: string; updated_at?: string | null }>
        inFlight?: InFlight | null
      }) => {
        // A live run wins over recency: resume the conversation being worked
        // on, whatever its age.
        if (data.inFlight) {
          await loadMessages(data.inFlight.conversationId)
          if (!cancelledRef.current) void reattach(data.inFlight)
          return
        }

        const conv = data.conversations?.[0]
        if (!conv) return

        /*
          ⚠ RECORD SCOPE RESUMES ALWAYS; PORTFOLIO SCOPE ONLY IF IT IS FRESH.
          A deal's chat is ABOUT that deal and belongs on its page however old
          it is. The portfolio dock has no such anchor — resuming a question
          from three weeks ago under ⌘J on the dashboard reads as the assistant
          being confused rather than as history, and `/intel` is where old
          conversations are meant to be browsed.
        */
        if (scopeQuery === 'scope=portfolio') {
          const updated = conv.updated_at ? new Date(conv.updated_at).getTime() : 0
          if (Date.now() - updated > 24 * 60 * 60 * 1000) return
        }

        setConversationId(conv.id)
        return loadMessages(conv.id)
      })
      .catch(() => {})
  }, [scopeQuery, initialConversationId, onAnswered])

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

    /*
      Set by whichever path produced the answer — the live stream, or the
      poller after the stream dropped — and announced ONCE in the `finally`.
      Both paths can reach the end of this turn, so firing from each of them
      is how the same answer gets announced twice.
    */
    let answeredText = ''
    let answeredId: string | null = null

    // If the network stream dies mid-run (iPhone Safari kills idle or
    // backgrounded connections — "Load failed"), the server still finishes
    // and persists the answer. Poll the conversation and pick it up instead
    // of failing the message.
    //
    // ⚠ The deadline is the agent's own TIME BUDGET, not a flat 240s. The
    // slowest answer on record took 16.8 minutes and the p90 is 7.6, so the
    // old cap gave up on precisely the long, well-evidenced turns that are
    // worth waiting for — and then showed an error above an answer that was
    // sitting in the database.
    const recoverAnswer = async (): Promise<boolean> => {
      const found = await pollForAnswer({
        question: msg,
        conversationId,
        scopeQuery,
        deadline: Date.now() + AGENT_TIME_BUDGET_MS,
        cancelled: () => cancelledRef.current,
      })
      if (!found) return false
      setMessages(prev => [...prev.filter(m => m.id !== streamId), toMessage(found.answer)])
      if (!conversationId) onConversationCreated?.(found.conversationId)
      setConversationId(found.conversationId)
      answeredText = found.answer.content
      answeredId = found.answer.id
      return true
    }

    try {
      const res = await fetch('/api/ai/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          conversationId,
          projectId,
          opportunityId,
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
      /*
        The answer text, accumulated outside React state.

        `setMessages` is the rendered copy; this is the one the completion
        handler reads, because reading state back inside an updater to fire a
        callback is how a toast ends up appearing twice. A `reset` clears it
        for the same reason it clears the rendered message — what came before
        was narration, not the answer.
      */
      let streamedText = ''

      const appendDelta = (delta: string) => {
        streamedText += delta
        if (!started) {
          started = true
          setActivity(null)
          setMessages(prev => [...prev, { id: streamId, role: 'assistant', content: delta, rating: null }])
        } else {
          setMessages(prev => prev.map(m => m.id === streamId ? { ...m, content: m.content + delta } : m))
        }
      }

      // The agent narrated ("Let me pull the lease...") and then went back for
      // more evidence. That narration is worth seeing while it works, but it is
      // not the answer — keeping it would leave the rendered message reading
      // differently from the one stored, the moment the page reloads.
      const resetText = () => {
        started = false
        streamedText = ''
        setMessages(prev => prev.filter(m => m.id !== streamId))
        setActivity('still working')
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
          } else if (event.type === 'reset') {
            resetText()
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
            // ⚠ Announced OUTSIDE the state updater. React may call an updater
            // twice (StrictMode, and any re-render it decides to replay), so a
            // callback fired from inside one is a toast that sometimes
            // appears twice and a notification that sometimes sends twice.
            // `streamedText` is accumulated by `appendDelta` for exactly this.
            if (streamedText) answeredText = streamedText
            answeredId = event.messageId ?? answeredId
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
      if (answeredText) onAnswered?.(answeredText, answeredId)
    }
  }, [input, loading, conversationId, projectId, opportunityId, documentId, scopeQuery, onConversationCreated, onAnswered])

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
            {/*
              ⚠ A CENTRED `flex-wrap` CANNOT PRODUCE A TIDY BLOCK. Four prompts
              of different lengths wrapped into three ragged centred lines —
              2 + 1 + 1 — which reads as a layout that failed rather than one
              that was chosen. They are a LIST of equal offers, so they are
              laid out as one: a single column, full width of the block, each
              the same shape. It also works in the dock, which is half this
              wide and where the wrap was worse.
            */}
            <div className="mt-4 flex w-full max-w-[22rem] flex-col gap-1.5">
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
                : opportunityId
                ? [
                    'Summarize where this deal stands',
                    'What has been agreed and what is still open?',
                    'Who is across the table, and what do they want?',
                    'What would make us walk away?',
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
                  className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
                >
                  <span className="min-w-0 truncate">{q}</span>
                  <ArrowRight
                    size={12}
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary"
                  />
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
              {/* The agent answers in markdown. Rendered as a raw string under a
                  `prose` wrapper, every `##` and `**` reached the reader as a
                  literal character — and none of those child selectors could
                  match, because no element they name was ever produced. The
                  user's own message stays a plain string: they typed it. */}
              {msg.role === 'assistant' ? (
                <div className="[&>*:first-child]:mt-0">
                  <BriefMarkdown text={msg.content} />
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
              {/*
                Citations. ⚠ This used to print the tool NAMES joined with
                commas and discard `args` entirely, so an answer about a lease
                could not be checked against the record it came from — no link,
                no search term, no sign of which project was read. The ids were
                in the stored message the whole time.
              */}
              {(() => {
                const cites = citationsFor(msg.toolCalls)
                if (cites.length === 0) return null
                return (
                  <div className="mt-2 pt-2 border-t border-border/40">
                    <p className="label-caps text-muted-foreground mb-1.5">Sources</p>
                    <div className="flex flex-wrap gap-1.5">
                      {cites.map((c, ci) => {
                        const body = (
                          <>
                            <span>{c.tool}</span>
                            {c.term && (
                              <span className="text-muted-foreground/70">&ldquo;{c.term}&rdquo;</span>
                            )}
                          </>
                        )
                        return c.href ? (
                          <Link
                            key={ci}
                            href={c.href}
                            className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ring-border bg-card text-muted-foreground transition-colors hover:text-foreground hover:bg-accent outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            {body}
                            <ArrowUpRight size={11} className="shrink-0" />
                          </Link>
                        ) : (
                          <span
                            key={ci}
                            className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs ring-1 ring-inset ring-border text-muted-foreground"
                          >
                            {body}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
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
                    className={`p-1 rounded transition-colors ${msg.rating === 1 ? 'text-positive bg-positive-surface' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <ThumbsUp size={11} />
                  </button>
                  <button
                    onClick={() => rateMessage(msg.id, -1)}
                    title="Not helpful"
                    className={`p-1 rounded transition-colors ${msg.rating === -1 ? 'text-critical bg-critical-surface' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}`}
                  >
                    <ThumbsDown size={11} />
                  </button>
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-muted dark:bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                <User size={12} className="text-muted-foreground" />
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
          <div className="flex items-center gap-2 text-xs text-critical bg-critical-surface rounded-lg px-3 py-2">
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
            // A placeholder does not contribute to scrollHeight, so the auto-grow
            // below can't see it — on a narrow screen the second line of a long
            // placeholder was being clipped by the box. Keeping the placeholder
            // on one line (ellipsised) is what actually fixes that; the 44px
            // floor on touch is the tap-target minimum.
            className="flex-1 min-w-0 resize-none rounded-lg border bg-muted/30 px-3 py-2 text-base sm:text-sm placeholder:text-muted-foreground placeholder:whitespace-nowrap placeholder:overflow-hidden placeholder:text-ellipsis outline-none focus-visible:ring-1 focus-visible:ring-primary/40 min-h-[2.75rem] sm:min-h-[36px] max-h-[120px]"
            style={{ height: 'auto', overflow: 'hidden' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          {/**
           * Voice in. It APPENDS rather than replaces, so dictating a sentence
           * onto something already typed works, and it does not auto-send — see
           * PushToTalkButton. Disabled while a turn is running because LM Studio
           * serves one request at a time, so recording during a turn would only
           * queue behind it.
           */}
          <PushToTalkButton
            disabled={loading}
            onError={setError}
            onTranscript={(text) => {
              setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))
              inputRef.current?.focus()
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            /* ⚠ The send button on the agent — the most-used control in the
               app's headline feature — had no accessible name at all: an icon
               and nothing else. A screen reader announced "button". */
            aria-label="Send message"
            className="shrink-0 size-[2.75rem] sm:size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <Send size={16} className="sm:size-3.5" />
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
