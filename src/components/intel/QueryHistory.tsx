'use client'

import { useEffect, useState } from 'react'
import { History, Bookmark, BookmarkCheck, Trash2 } from 'lucide-react'

interface HistoryEntry {
  id: string
  query_text: string
  model_used: string
  latency_ms: number | null
  created_at: string
}

interface Props {
  onSelectQuery: (query: string) => void
}

const SAVED_QUERIES_KEY = 'bw-intel-saved-queries'

function getSavedQueries(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(SAVED_QUERIES_KEY) ?? '[]')
  } catch {
    return []
  }
}

function setSavedQueries(queries: string[]) {
  localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries))
}

export default function QueryHistory({ onSelectQuery }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [savedQueries, setSaved] = useState<string[]>([])
  const [tab, setTab] = useState<'history' | 'saved'>('saved')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setSaved(getSavedQueries())

    fetch('/api/ai/queries?limit=20')
      .then((r) => r.json())
      .then((data: { queries?: HistoryEntry[] }) => {
        setHistory(data.queries ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggleSave(query: string) {
    const current = getSavedQueries()
    const idx = current.indexOf(query)
    let next: string[]
    if (idx >= 0) {
      next = current.filter((_, i) => i !== idx)
    } else {
      next = [query, ...current]
    }
    setSavedQueries(next)
    setSaved(next)
  }

  function removeSaved(query: string) {
    const next = getSavedQueries().filter((q) => q !== query)
    setSavedQueries(next)
    setSaved(next)
  }

  const isSaved = (q: string) => savedQueries.includes(q)

  // Deduplicate history by query_text
  const uniqueHistory = history.filter(
    (h, i, arr) => arr.findIndex((x) => x.query_text === h.query_text) === i
  )

  return (
    <div className="space-y-3">
      {/* Tab toggle */}
      <div className="flex gap-1 bg-muted rounded-lg p-0.5">
        <button
          onClick={() => setTab('saved')}
          className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
            tab === 'saved' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bookmark size={11} className="inline mr-1" />
          Saved
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
            tab === 'history' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <History size={11} className="inline mr-1" />
          History
        </button>
      </div>

      {/* Saved queries tab */}
      {tab === 'saved' && (
        <div className="space-y-1">
          {savedQueries.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-2">
              No saved queries yet. Bookmark a query after running it.
            </p>
          )}
          {savedQueries.map((q) => (
            <div key={q} className="group flex items-start gap-1.5">
              <button
                onClick={() => onSelectQuery(q)}
                className="flex-1 text-left text-xs text-foreground hover:text-primary py-1 leading-snug transition-colors line-clamp-2"
              >
                {q}
              </button>
              <button
                onClick={() => removeSaved(q)}
                className="shrink-0 p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all"
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* History tab */}
      {tab === 'history' && (
        <div className="space-y-1">
          {loading && (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-5/6" />
            </div>
          )}
          {!loading && uniqueHistory.length === 0 && (
            <p className="text-[11px] text-muted-foreground py-2">
              No queries yet. Ask your first question above.
            </p>
          )}
          {!loading &&
            uniqueHistory.map((h) => {
              const date = new Date(h.created_at)
              const timeStr = date.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric',
              })
              return (
                <div key={h.id} className="group flex items-start gap-1.5">
                  <button
                    onClick={() => onSelectQuery(h.query_text)}
                    className="flex-1 text-left text-xs text-foreground hover:text-primary py-1 leading-snug transition-colors line-clamp-2"
                  >
                    {h.query_text.length > 80
                      ? h.query_text.slice(0, 80) + '...'
                      : h.query_text}
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-muted-foreground">{timeStr}</span>
                    <button
                      onClick={() => toggleSave(h.query_text)}
                      className="p-0.5 text-muted-foreground hover:text-primary transition-colors"
                      title={isSaved(h.query_text) ? 'Unsave' : 'Save'}
                    >
                      {isSaved(h.query_text) ? (
                        <BookmarkCheck size={11} className="text-primary" />
                      ) : (
                        <Bookmark size={11} />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
