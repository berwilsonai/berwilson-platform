'use client'

import { useState, useRef } from 'react'
import { Camera, X, Star, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { Media } from '@/lib/supabase/types'

const MAX_PHOTOS = 25
const ACCEPTED = '.jpg,.jpeg,.png,.webp'

export type MediaScope =
  | { projectId: string }
  | { entityId: string }
  | { partyId: string }
  | { isCompany: true }

function scopeToFormFields(scope: MediaScope): Record<string, string> {
  if ('projectId' in scope) return { project_id: scope.projectId }
  if ('entityId' in scope) return { entity_id: scope.entityId }
  if ('partyId' in scope) return { party_id: scope.partyId }
  return { is_company: 'true' }
}

function getPublicUrl(storagePath: string): string {
  const supabase = createClient()
  const { data } = supabase.storage.from('media').getPublicUrl(storagePath)
  return data.publicUrl
}

interface Props {
  initialPhotos: Media[]
  scope: MediaScope
}

export default function MediaGallery({ initialPhotos, scope }: Props) {
  const [photos, setPhotos] = useState<Media[]>(
    [...initialPhotos].sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
  )
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const primary = photos.find((p) => p.is_primary) ?? photos[0] ?? null
  const thumbnails = photos.filter((p) => p.id !== primary?.id)
  const atLimit = photos.length >= MAX_PHOTOS

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length || uploading || atLimit) return
    setUploading(true)
    const fields = scopeToFormFields(scope)
    try {
      for (const file of Array.from(files)) {
        if (photos.length + 1 > MAX_PHOTOS) break
        const fd = new FormData()
        fd.append('file', file)
        for (const [k, v] of Object.entries(fields)) fd.append(k, v)
        // Auto-set first uploaded photo as primary if none exist
        if (photos.length === 0) fd.append('is_primary', 'true')

        const res = await fetch('/api/media/upload', { method: 'POST', body: fd })
        if (res.ok) {
          const { photo } = await res.json() as { photo: Media }
          setPhotos((prev) => {
            const next = [...prev, photo]
            return next.sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
          })
        }
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(photo: Media) {
    setDeletingId(photo.id)
    try {
      const res = await fetch(`/api/media/${photo.id}`, { method: 'DELETE' })
      if (res.ok) {
        setPhotos((prev) => {
          const next = prev.filter((p) => p.id !== photo.id)
          // If deleted was primary, promote first remaining
          if (photo.is_primary && next.length > 0 && !next.some((p) => p.is_primary)) {
            next[0] = { ...next[0], is_primary: true }
          }
          return next
        })
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSetPrimary(photo: Media) {
    if (photo.is_primary || settingPrimaryId) return
    setSettingPrimaryId(photo.id)
    try {
      const res = await fetch(`/api/media/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_primary: true }),
      })
      if (res.ok) {
        setPhotos((prev) =>
          prev
            .map((p) => ({ ...p, is_primary: p.id === photo.id }))
            .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0))
        )
      }
    } finally {
      setSettingPrimaryId(null)
    }
  }

  // Empty state
  if (photos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex flex-col items-center gap-2 py-10 text-muted-foreground hover:text-foreground transition-colors"
        >
          {uploading ? (
            <Loader2 size={24} className="animate-spin" />
          ) : (
            <Camera size={24} />
          )}
          <span className="text-sm font-medium">
            {uploading ? 'Uploading…' : 'Add photos'}
          </span>
          <span className="text-xs">JPEG, PNG, or WebP · up to 10 MB each · max {MAX_PHOTOS}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Hero / primary photo */}
      {primary && (
        <div className="relative rounded-xl overflow-hidden bg-muted aspect-video w-full group">
          <img
            src={getPublicUrl(primary.storage_path)}
            alt={primary.caption ?? ''}
            className="w-full h-full object-cover"
          />
          {/* Primary badge */}
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 text-white rounded-full px-2 py-0.5 text-xs font-medium">
            <Star size={9} className="fill-amber-400 text-amber-400" />
            Cover
          </div>
          {/* Delete button */}
          <button
            type="button"
            onClick={() => handleDelete(primary)}
            disabled={deletingId === primary.id}
            className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove photo"
          >
            {deletingId === primary.id ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <X size={12} />
            )}
          </button>
          {primary.caption && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
              <p className="text-white text-xs">{primary.caption}</p>
            </div>
          )}
        </div>
      )}

      {/* Thumbnails + upload button */}
      <div className="flex items-center gap-2 flex-wrap">
        {thumbnails.map((photo) => (
          <div
            key={photo.id}
            className="relative w-20 h-20 rounded-lg overflow-hidden bg-muted shrink-0 group"
          >
            <img
              src={getPublicUrl(photo.storage_path)}
              alt={photo.caption ?? ''}
              className="w-full h-full object-cover"
            />
            {/* Set primary */}
            <button
              type="button"
              onClick={() => handleSetPrimary(photo)}
              disabled={!!settingPrimaryId}
              className="absolute inset-0 bg-black/0 hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
              title="Set as cover photo"
            >
              {settingPrimaryId === photo.id ? (
                <Loader2 size={14} className="text-white animate-spin" />
              ) : (
                <Star size={14} className="text-white" />
              )}
            </button>
            {/* Delete */}
            <button
              type="button"
              onClick={() => handleDelete(photo)}
              disabled={deletingId === photo.id}
              className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove photo"
            >
              {deletingId === photo.id ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <X size={10} />
              )}
            </button>
          </div>
        ))}

        {/* Upload button */}
        {!atLimit && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-20 h-20 rounded-lg border border-dashed border-border bg-muted/30 hover:bg-muted/60 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title={`Add photos (${photos.length}/${MAX_PHOTOS})`}
          >
            {uploading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Camera size={16} />
            )}
            <span className="text-xs">{photos.length}/{MAX_PHOTOS}</span>
          </button>
        )}

        {atLimit && (
          <span className="text-xs text-muted-foreground px-2">
            {MAX_PHOTOS}/{MAX_PHOTOS} photos
          </span>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  )
}
