import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'

export const maxDuration = 300

// Accepts a single file (multipart) and stores it in Supabase Storage via the
// admin client. Browser-side uploads with the anon key fail against the
// self-hosted stack (no storage RLS policies) — see CLAUDE.md §8. Small
// proposal files route through here instead; large files use /upload-chunk.
export async function POST(request: NextRequest) {
  try {
    const supabase = await actorAdminClient()

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return Response.json({ error: 'Invalid form data' }, { status: 400 })
    }

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return Response.json({ error: 'Missing file' }, { status: 400 })
    }

    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `proposals/pending/${timestamp}_${safeName}`
    const buffer = await file.arrayBuffer()

    const { error } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
        upsert: false,
      })

    if (error) {
      return Response.json({ error: `Failed to store ${file.name}: ${error.message}` }, { status: 500 })
    }

    return Response.json({
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `Upload failed: ${message}` }, { status: 500 })
  }
}
