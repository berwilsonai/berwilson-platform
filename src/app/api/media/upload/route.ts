import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_PHOTOS = 25

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const project_id = formData.get('project_id') as string | null
  const entity_id = formData.get('entity_id') as string | null
  const party_id = formData.get('party_id') as string | null
  const is_company = formData.get('is_company') === 'true'
  const is_primary = formData.get('is_primary') === 'true'
  const caption = (formData.get('caption') as string | null) ?? null

  if (!file) {
    return Response.json({ error: 'file is required' }, { status: 400 })
  }

  const scopeCount = [project_id, entity_id, party_id, is_company || null].filter(Boolean).length
  if (scopeCount !== 1) {
    return Response.json({ error: 'Exactly one scope required: project_id, entity_id, party_id, or is_company' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'Only JPEG, PNG, and WebP images are allowed' }, { status: 400 })
  }

  if (file.size > MAX_SIZE_BYTES) {
    return Response.json({ error: 'File exceeds 10 MB limit' }, { status: 400 })
  }

  // Enforce 25-photo cap per scope
  let countQuery = supabase.from('media').select('id', { count: 'exact', head: true })
  if (project_id) countQuery = countQuery.eq('project_id', project_id)
  else if (entity_id) countQuery = countQuery.eq('entity_id', entity_id)
  else if (party_id) countQuery = countQuery.eq('party_id', party_id)
  else countQuery = countQuery.eq('is_company', true)

  const { count } = await countQuery
  if ((count ?? 0) >= MAX_PHOTOS) {
    return Response.json({ error: `Maximum of ${MAX_PHOTOS} photos allowed` }, { status: 400 })
  }

  // Build storage path
  const timestamp = Date.now()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  let folder: string
  if (project_id) folder = `projects/${project_id}`
  else if (entity_id) folder = `entities/${entity_id}`
  else if (party_id) folder = `parties/${party_id}`
  else folder = 'company'
  const storagePath = `${folder}/${timestamp}_${safeName}`

  // Upload to media bucket
  const fileBuffer = await file.arrayBuffer()
  const { error: storageError } = await supabase.storage
    .from('media')
    .upload(storagePath, fileBuffer, {
      contentType: file.type,
      cacheControl: '31536000', // 1 year — images don't change
      upsert: false,
    })

  if (storageError) {
    return Response.json({ error: storageError.message }, { status: 500 })
  }

  // If this will be primary, unset any existing primary first
  if (is_primary) {
    let unsetQuery = supabase.from('media').update({ is_primary: false }).eq('is_primary', true)
    if (project_id) unsetQuery = unsetQuery.eq('project_id', project_id)
    else if (entity_id) unsetQuery = unsetQuery.eq('entity_id', entity_id)
    else if (party_id) unsetQuery = unsetQuery.eq('party_id', party_id)
    else unsetQuery = unsetQuery.eq('is_company', true)
    await unsetQuery
  }

  // Insert media record
  const { data: photo, error: insertError } = await supabase
    .from('media')
    .insert({
      project_id: project_id ?? null,
      entity_id: entity_id ?? null,
      party_id: party_id ?? null,
      is_company,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
      caption,
      is_primary,
      sort_order: count ?? 0,
    })
    .select()
    .single()

  if (insertError || !photo) {
    // Clean up storage on DB failure
    await supabase.storage.from('media').remove([storagePath])
    return Response.json({ error: insertError?.message ?? 'Insert failed' }, { status: 500 })
  }

  return Response.json({ photo })
}
