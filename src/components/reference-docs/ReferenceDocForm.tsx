'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, FileUp, Sparkles } from 'lucide-react'

/**
 * Upload entry point for the Document digest tool. Pick a file (PDF, Word, or
 * text), optionally give it a title, and we POST to /api/reference-docs/upload
 * (server-side upload + summary + full-text indexing), then route to the reader
 * where the summary and a document-scoped Ber AI chat live.
 */
export default function ReferenceDocForm() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!title) setTitle(f.name.replace(/\.(pdf|docx?|txt|md|markdown|csv|html?)$/i, ''))
  }

  async function upload() {
    if (!file) {
      setError('Choose a document to upload first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file, file.name)
      if (title.trim()) form.append('title', title.trim())

      const res = await fetch('/api/reference-docs/upload', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data.error as string) || 'Upload failed.')
      router.push(`/intake/document/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
      setLoading(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title (optional)"
          className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.markdown,.csv,.html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv,text/html"
          onChange={onFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors shrink-0"
        >
          <FileUp size={14} />
          {file ? 'Change file' : 'Choose file'}
        </button>
      </div>

      {file && (
        <p className="text-xs text-muted-foreground">
          Selected <span className="font-medium text-foreground">{file.name}</span> ·{' '}
          {Math.max(1, Math.round(file.size / 1024))} KB
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Ber AI reads the whole document, writes a summary, and lets you ask questions about it —
          with read-aloud on the summary and every answer. PDF, Word (.docx), or text.
        </p>
        <button
          type="button"
          onClick={upload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60 shrink-0"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {loading ? 'Reading…' : 'Upload & digest'}
        </button>
      </div>
    </div>
  )
}
