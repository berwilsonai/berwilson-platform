'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, Loader2, ScanLine, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The stack-of-cards uploader.
 *
 * Two distinct phases, and keeping them apart is what makes the wait bearable.
 * Recognition is local and takes about a second a card, so it happens here, up
 * front, with the photos in front of you: an unreadable one says so while you
 * can still retake it. Only then does the slow part start, and the slow part
 * runs on the server without anybody watching it.
 */

const MAX_CARDS = 30

type ItemState = 'queued' | 'reading' | 'read' | 'failed'

interface Item {
  id: string
  file: File
  state: ItemState
  rawText: string | null
  error: string | null
}

let seq = 0

export default function CardBatchUpload() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [reading, setReading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const read = items.filter((i) => i.state === 'read')
  const failed = items.filter((i) => i.state === 'failed')

  const patch = useCallback((id: string, next: Partial<Item>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...next } : i)))
  }, [])

  const ingest = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|tiff?)$/i.test(f.name))
      if (images.length === 0) {
        setError('Those were not images. Photograph or screenshot the cards first.')
        return
      }
      setError(null)

      let added: Item[] = []
      setItems((prev) => {
        const room = MAX_CARDS - prev.length
        if (room <= 0) {
          setError(`${MAX_CARDS} cards is the most one batch will read. Save these, then start another.`)
          return prev
        }
        added = images.slice(0, room).map((file) => ({
          id: `f${++seq}`,
          file,
          state: 'queued' as const,
          rawText: null,
          error: null,
        }))
        if (images.length > room) {
          setError(`Only the first ${room} were added — ${MAX_CARDS} cards is the most one batch will read.`)
        }
        return [...prev, ...added]
      })

      // One at a time: recognition is a local process per photo, and a dozen at
      // once would only queue inside the machine where nothing can show it.
      setReading(true)
      for (const item of added) {
        patch(item.id, { state: 'reading' })
        try {
          const body = new FormData()
          body.append('image', item.file)
          const res = await fetch('/api/contacts/scan-card/ocr', { method: 'POST', body })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? 'Could not read this photo.')
          patch(item.id, { state: 'read', rawText: String(json.raw_text ?? ''), error: null })
        } catch (err) {
          patch(item.id, {
            state: 'failed',
            error: err instanceof Error ? err.message : 'Could not read this photo.',
          })
        }
      }
      setReading(false)
    },
    [patch],
  )

  async function start() {
    if (read.length === 0) return
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/contacts/scan-card/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: read.map((i) => ({ raw_text: i.rawText, file_name: i.file.name })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not start the batch.')
      router.push(`/intake/cards/${json.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the batch.')
      setStarting(false)
    }
  }

  const busy = reading || starting

  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void ingest(files)
        }}
        className="hidden"
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          if (files.length) void ingest(files)
        }}
        className={cn(
          'rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
      >
        <Camera size={22} className="mx-auto text-muted-foreground" />
        <p className="mt-2 text-sm font-medium">Drop the photos here</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Or pick them from the camera roll — one photo per card, as many as you have.
        </p>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1.5 h-11 sm:h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors disabled:opacity-60"
        >
          <Upload size={15} />
          Choose photos
        </button>
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="label-caps text-muted-foreground">
              {items.length} photo{items.length === 1 ? '' : 's'}
            </span>
            {!busy && (
              <button
                type="button"
                onClick={() => { setItems([]); setError(null) }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          <ul className="rounded-md border border-border divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5 px-3 py-2">
                <span className="mt-0.5 shrink-0">
                  {item.state === 'reading' ? (
                    <Loader2 size={14} className="animate-spin text-muted-foreground" />
                  ) : item.state === 'read' ? (
                    <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                  ) : item.state === 'failed' ? (
                    <TriangleAlert size={14} className="text-amber-600 dark:text-amber-400" />
                  ) : (
                    <ScanLine size={14} className="text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{item.file.name}</span>
                  <span className="block text-xs text-muted-foreground line-clamp-1">
                    {item.state === 'failed'
                      ? item.error
                      : item.state === 'read'
                      ? (item.rawText ?? '').replace(/\s+/g, ' ').slice(0, 90)
                      : item.state === 'reading'
                      ? 'Reading the text…'
                      : 'Waiting'}
                  </span>
                </span>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                    title="Remove this photo"
                    className="relative shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className="absolute -inset-3" aria-hidden />
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>}

      {failed.length > 0 && !reading && (
        <p className="text-xs text-muted-foreground">
          {failed.length} photo{failed.length === 1 ? '' : 's'} could not be read and will be left
          out. Retake {failed.length === 1 ? 'it' : 'them'} with the card filling the frame, in even
          light.
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {read.length > 0 &&
            `${read.length} card${read.length === 1 ? '' : 's'} ready · roughly ${Math.max(1, Math.round(read.length * 1.5))} min to research`}
        </span>
        <button
          type="button"
          onClick={start}
          disabled={busy || read.length === 0}
          className="inline-flex items-center gap-1.5 h-11 sm:h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {starting ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
          {starting ? 'Starting…' : reading ? 'Reading photos…' : `Research ${read.length || ''} card${read.length === 1 ? '' : 's'}`}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Each photo is read on this machine and discarded — only the text goes any further. The
        research then runs on the server, so you can close this page and come back to the review.
      </p>
    </div>
  )
}
