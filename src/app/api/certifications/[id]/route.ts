import { NextRequest } from 'next/server'
import { actorAdminClient } from '@/lib/auth/viewer'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params
  const supabase = await actorAdminClient()

  // Fetch cert to find linked document
  const { data: cert } = await supabase
    .from('certifications')
    .select('document_id')
    .eq('id', id)
    .single()

  if (!cert) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Clean up linked document if any
  if (cert.document_id) {
    const { data: doc } = await supabase
      .from('documents')
      .select('storage_path')
      .eq('id', cert.document_id)
      .single()
    if (doc) {
      await supabase.storage.from('documents').remove([doc.storage_path])
      await supabase.from('documents').delete().eq('id', cert.document_id)
    }
  }

  const { error } = await supabase.from('certifications').delete().eq('id', id)
  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
