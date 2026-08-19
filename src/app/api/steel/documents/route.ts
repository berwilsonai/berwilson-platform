import { NextRequest } from 'next/server'
import { getViewer, canWorkSteel, forbiddenJson, actorAdminClient } from '@/lib/auth/viewer'

interface InsertBody {
  steel_deal_id?: string
  storage_path?: string
  file_name?: string
  file_size_bytes?: number
  mime_type?: string
  doc_type?: string
}

// Register a file already uploaded (via the signed URL) as a steel-deal
// document. Deal files are pure storage (plans, quotes, signed orders) — not
// AI-embedded (they carry no chunk scope; the deal record holds the data).
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  let body: InsertBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { steel_deal_id, storage_path, file_name, file_size_bytes, mime_type, doc_type } = body
  if (!steel_deal_id || !storage_path || !file_name) {
    return Response.json({ error: 'steel_deal_id, storage_path and file_name are required' }, { status: 400 })
  }

  const supabase = await actorAdminClient()
  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      steel_deal_id,
      storage_path,
      file_name,
      file_size_bytes: file_size_bytes ?? null,
      mime_type: mime_type ?? null,
      doc_type: doc_type ?? 'other',
      source: 'document',
      embedding_status: 'skipped',
    })
    .select()
    .single()

  if (error || !doc) {
    return Response.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }

  return Response.json({ document: doc })
}
