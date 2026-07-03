'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FileUp, Sparkles } from 'lucide-react'

/**
 * Paste-or-upload entry point for the Email Ingestion flow. Most reports now
 * arrive automatically via /email-research; this form covers any report from
 * elsewhere — paste the text (or drop a .md/.txt file, read client-side) and we
 * POST it to /api/email-ingestion/analyze, then route to the review screen.
 */
export default function EmailIngestForm() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const content = await file.text()
    setText(content)
    if (!label) setLabel(file.name.replace(/\.(md|txt|markdown)$/i, ''))
  }

  async function analyze() {
    if (!text.trim()) {
      setError('Paste the research report or choose a file first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/email-ingestion/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: text, label: label.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Analysis failed.')
      router.push(`/email-ingestion/${data.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. search term or counterparty)"
          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".md,.txt,.markdown,text/markdown,text/plain"
          onChange={onFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors shrink-0"
        >
          <FileUp size={14} />
          {fileName ? 'Change file' : 'Upload .md / .txt'}
        </button>
      </div>

      {fileName && (
        <p className="text-xs text-muted-foreground">
          Loaded <span className="font-medium text-foreground">{fileName}</span> — edit below if needed.
        </p>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        placeholder="Paste the email research report here…"
        className="w-full rounded-md border border-input bg-background p-3 text-sm font-mono leading-relaxed resize-y"
      />

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Ber AI maps this into a proposed record + people + tasks for you to review.
        </p>
        <button
          type="button"
          onClick={analyze}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 shrink-0"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? 'Analyzing…' : 'Analyze with Ber AI'}
        </button>
      </div>
    </div>
  )
}
