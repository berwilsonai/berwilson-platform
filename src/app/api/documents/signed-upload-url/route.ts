import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let body: { storage_path: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { storage_path } = body
  if (!storage_path) {
    return Response.json({ error: 'storage_path is required' }, { status: 400 })
  }

  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUploadUrl(storage_path)

  if (error || !data) {
    return Response.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  }

  return Response.json({ signedUrl: data.signedUrl, token: data.token, path: data.path })
}
