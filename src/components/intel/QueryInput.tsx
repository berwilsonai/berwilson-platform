'use client'

import { useState, useRef } from 'react'
import { Send, Loader2 } from 'lucide-react'

const SUGGESTED_QUERIES = [
  'What are the open action items and blockers across all active projects?',
  'What risks have been flagged on the Fort Bragg project?',
  'What is the current status of the Salt Lake financing?',
  'What decisions have been made in the last 90 days?',
  'Who are we waiting on across all projects right now?',
]

interface Props {
  onSubmit: (query: string) => void
  loading: boolean
}

export default function QueryInput({ onSubmit, loading }: Props) {
  const [query, setQuery] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || loading) return
    onSubmit(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  function useSuggestion(s: string) {
    setQuery(s)
    textareaRef.current?.focus()
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your projects…&#10;e.g. What are the open blockers on Fort Bragg?"
            rows={3}
            disabled={loading}
            className="w-full resize-none rounded-lg border border-border bg-card px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!query.trim() || loading}
            className="absolute right-3 bottom-3 inline-flex items-center justify-center w-7 h-7 rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
            title="Submit (Enter)"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Enter to submit · Shift+Enter for new line
        </p>
      </form>

      {/* Suggested queries — hide while loading */}
      {!loading && !query && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Try asking
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUERIES.map((s) => (
              <button
                key={s}
                onClick={() => useSuggestion(s)}
                className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted hover:bg-accent text-foreground transition-colors text-left"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
