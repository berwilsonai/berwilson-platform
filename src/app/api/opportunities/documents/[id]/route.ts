import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data: doc, error: fetchError } = await admin
    .from('opportunity_documents')
    .select('id, storage_path')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  const { error: storageError } = await admin.storage
    .from('documents')
    .remove([doc.storage_path])

  if (storageError) {
    console.error('Storage delete failed:', storageError.message)
  }

  const { error: dbError } = await admin
    .from('opportunity_documents')
    .delete()
    .eq('id', id)

  if (dbError) {
    return Response.json({ error: dbError.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
