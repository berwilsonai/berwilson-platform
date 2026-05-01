import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = createAdminClient()

  // Fetch the document to get its storage path
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('id, storage_path')
    .eq('id', id)
    .single()

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  // Remove from Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('documents')
    .remove([doc.storage_path])

  if (storageError) {
    // Log but don't block — still delete the DB record
    console.error('Storage delete failed:', storageError.message)
  }

  // Delete DB record (triggers activity_log via trigger)
  const { error: dbError } = await supabase
    .from('documents')
    .delete()
    .eq('id', id)

  if (dbError) {
    return Response.json({ error: dbError.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
