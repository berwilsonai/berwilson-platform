import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30

// Accepts a single file chunk (≤4MB) and stores it in Supabase.
// The client splits large files into chunks and calls this repeatedly,
// then calls /api/proposals/intake with the chunk session ID.
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient()

    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return Response.json({ error: 'Invalid form data' }, { status: 400 })
    }

    const chunk = formData.get('chunk')
    const sessionId = formData.get('session_id') as string
    const chunkIndex = parseInt(formData.get('chunk_index') as string, 10)
    const totalChunks = parseInt(formData.get('total_chunks') as string, 10)
    const fileName = formData.get('file_name') as string
    const mimeType = formData.get('mime_type') as string

    if (!(chunk instanceof File) || !sessionId || isNaN(chunkIndex) || isNaN(totalChunks)) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const chunkBuffer = await chunk.arrayBuffer()
    const chunkPath = `proposals/chunks/${sessionId}/chunk_${String(chunkIndex).padStart(5, '0')}`

    const { error } = await supabase.storage
      .from('documents')
      .upload(chunkPath, chunkBuffer, {
        contentType: 'application/octet-stream',
        upsert: true,
      })

    if (error) {
      return Response.json({ error: `Failed to store chunk ${chunkIndex}: ${error.message}` }, { status: 500 })
    }

    return Response.json({
      ok: true,
      chunk_index: chunkIndex,
      total_chunks: totalChunks,
      session_id: sessionId,
      file_name: fileName,
      mime_type: mimeType,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: `Chunk upload failed: ${message}` }, { status: 500 })
  }
}
