'use client'

import { useState, useCallback } from 'react'
import { Bookmark, BookmarkCheck, ThumbsUp, ThumbsDown } from 'lucide-react'
import QueryInput from './QueryInput'
import GroundedAnswer from './GroundedAnswer'
import QueryHistory from './QueryHistory'
import type { SynthesisResponse } from '@/types/domain'

const SAVED_QUERIES_KEY = 'bw-intel-saved-queries'

function getSavedQueries(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) ?? '[]')
  } catch {
    return []
  }
}

function toggleSavedQuery(query: string): boolean {
  const current = getSavedQueries()
  const idx = current.indexOf(query)
  if (idx >= 0) {
    localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(current.filter((_, i) => i !== idx)))
    return false
  }
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify([query, ...current]))
  return true
}

export default function IntelClient() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SynthesisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastQuery, setLastQuery] = useState<string>('')
  const [isSaved, setIsSaved] = useState(false)
  const [rating, setRating] = useState<1 | -1 | null>(null)

  const handleQuery = useCallback(async (query: string) => {
    setLoading(true)
    setError(null)
    setResult(null)
    setLastQuery(query)
    setIsSaved(getSavedQueries().includes(query))
    setRating(null)

    try {
      const res = await fetch('/api/ai/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
      }

      const data = await res.json() as SynthesisResponse
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [])

  function handleBookmark() {
    if (!lastQuery) return
    const nowSaved = toggleSavedQuery(lastQuery)
    setIsSaved(nowSaved)
  }

  async function handleRate(value: 1 | -1) {
    if (!result?.ai_query_id) return
    setRating(value)
    await fetch('/api/eval/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'ai_queries', id: result.ai_query_id, rating: value }),
    }).catch(() => {})
  }

  return (
    <div className="flex gap-6">
      {/* Main query area */}
      <div className="flex-1 min-w-0 space-y-6">
        <QueryInput onSubmit={handleQuery} loading={loading} />

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3 animate-pulse">
            <div className="h-3 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="h-3 bg-muted rounded w-2/3" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="space-y-4">
            {/* Query header with bookmark */}
            <div className="flex items-start justify-between gap-2 border-l-2 border-primary/40 pl-3">
              <p className="text-xs text-muted-foreground italic flex-1">{lastQuery}</p>
              <button
                onClick={handleBookmark}
                className="shrink-0 p-1 text-muted-foreground hover:text-primary transition-colors"
                title={isSaved ? 'Remove bookmark' : 'Bookmark this query'}
              >
                {isSaved ? (
                  <BookmarkCheck size={14} className="text-primary" />
                ) : (
                  <Bookmark size={14} />
                )}
              </button>
            </div>

            <GroundedAnswer
              answer={result.answer}
              citations={result.citations}
              low_confidence={result.low_confidence}
              no_data={result.no_data}
              model_used={result.model_used}
              latency_ms={result.latency_ms}
            />

            {/* Rating + ask another */}
            <div className="flex items-center justify-between">
              {result.ai_query_id && !result.no_data ? (
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-muted-foreground mr-1">Helpful?</span>
                  <button
                    onClick={() => handleRate(1)}
                    title="Thumbs up"
                    className={`p-1 rounded transition-colors ${rating === 1 ? 'text-emerald-600 bg-emerald-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    <ThumbsUp size={13} />
                  </button>
                  <button
                    onClick={() => handleRate(-1)}
                    title="Thumbs down"
                    className={`p-1 rounded transition-colors ${rating === -1 ? 'text-red-600 bg-red-50' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
                  >
                    <ThumbsDown size={13} />
                  </button>
                </div>
              ) : <span />}
              {!result.no_data && (
                <button
                  onClick={() => { setResult(null); setError(null) }}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Ask another question
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* History sidebar — hidden on mobile */}
      <aside className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-6">
          <QueryHistory onSelectQuery={handleQuery} />
        </div>
      </aside>
    </div>
  )
}
