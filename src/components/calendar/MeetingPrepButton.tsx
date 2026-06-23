'use client'

import { useState } from 'react'
import { Sparkles, X, RefreshCw } from 'lucide-react'

interface MeetingPrepButtonProps {
  subject: string
  date: string
  attendees: { name: string; email: string }[]
}

export default function MeetingPrepButton({ subject, date, attendees }: MeetingPrepButtonProps) {
  const [open, setOpen] = useState(false)
  const [brief, setBrief] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/meeting-prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, date, attendees }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `Failed (${res.status})`)
      }
      const data = await res.json() as { brief: string }
      setBrief(data.brief)
      setOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); brief ? setOpen(true) : generate() }}
        disabled={loading}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 ring-1 ring-indigo-200 dark:ring-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors disabled:opacity-50"
        title="Generate meeting prep brief"
      >
        {loading ? <RefreshCw size={10} className="animate-spin" /> : <Sparkles size={10} />}
        Prep
      </button>

      {/* Modal */}
      {open && brief && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-semibold text-foreground flex-1">Meeting Prep: {subject}</h3>
              <button onClick={() => setOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <div className="text-sm text-foreground leading-relaxed prose prose-sm prose-slate max-w-none [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 [&_strong]:text-foreground whitespace-pre-wrap">
                {brief}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <span className="text-xs text-red-500 dark:text-red-400 ml-1">{error}</span>
      )}
    </>
  )
}
