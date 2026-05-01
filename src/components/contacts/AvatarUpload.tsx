'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Camera, Loader2, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface AvatarUploadProps {
  partyId: string
  avatarUrl: string | null
  isOrganization?: boolean | null
  size?: 'sm' | 'md'
}

export default function AvatarUpload({
  partyId,
  avatarUrl,
  isOrganization,
  size = 'md',
}: AvatarUploadProps) {
  const [preview, setPreview] = useState<string | null>(avatarUrl)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const sizeClasses = size === 'md' ? 'size-14' : 'size-10'
  const iconSize = size === 'md' ? 24 : 18

  async function handleFile(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2 MB')
      return
    }

    setUploading(true)
    setError('')

    try {
      const supabase = createClient()

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(partyId, file, { upsert: true, contentType: file.type })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(partyId)

      // Add cache-bust to force re-render
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`

      // Update party record
      const res = await fetch(`/api/parties/${partyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: publicUrl }),
      })

      if (!res.ok) throw new Error('Failed to save avatar URL')

      setPreview(publicUrl)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative inline-block">
      <div
        className={`${sizeClasses} rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden`}
      >
        {preview ? (
          <img
            src={preview}
            alt="Profile"
            className={`${sizeClasses} object-cover`}
          />
        ) : isOrganization ? (
          <Building2 size={iconSize} className="text-muted-foreground" />
        ) : (
          <User size={iconSize} className="text-muted-foreground" />
        )}
      </div>

      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="absolute -bottom-0.5 -right-0.5 size-6 rounded-full bg-foreground text-background flex items-center justify-center hover:bg-foreground/80 transition-colors disabled:opacity-50"
        aria-label="Upload photo"
      >
        {uploading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Camera size={12} />
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      {error && (
        <p className="absolute top-full mt-1 text-[10px] text-destructive whitespace-nowrap">
          {error}
        </p>
      )}
    </div>
  )
}
