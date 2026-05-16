import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { embedDocument } from '@/lib/ai/embeddings'

interface ConfirmBody {
  session_id: string
  action: 'create_new' | 'link_to_existing' | 'add_to_existing'
  existing_project_id?: string
  project_fields: {
    name: string
    sector: string
    status?: string
    stage?: string
    description?: string
    estimated_value?: number | null
    contract_type?: string | null
    delivery_method?: string | null
    location?: string | null
    client_entity?: string | null
    solicitation_number?: string | null
    award_date?: string | null
    ntp_date?: string | null
    substantial_completion_date?: string | null
  }
  party_actions: Array<{
    extracted_index: number
    action: 'create_new' | 'link_existing' | 'skip'
    existing_party_id?: string
    role?: string
  }>
  entity_actions: Array<{
    extracted_index: number
    action: 'create_new' | 'link_existing' | 'skip'
    existing_entity_id?: string
  }>
}

const VALID_ENTITY_TYPES = ['llc', 'corp', 'jv', 'subsidiary', 'trust', 'fund', 'other'] as const
type EntityType = typeof VALID_ENTITY_TYPES[number]

export async function POST(request: NextRequest) {
  // Auth check
  const userSupabase = await createClient()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  let body: ConfirmBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, action, existing_project_id, project_fields, party_actions, entity_actions } = body

  // Load session
  const { data: session, error: sessionError } = await supabase
    .from('proposal_intake_sessions')
    .select('*')
    .eq('id', session_id)
    .eq('status', 'pending')
    .single()

  if (sessionError || !session) {
    return Response.json({ error: 'Session not found or already confirmed' }, { status: 404 })
  }

  const extraction = session.extraction_result as Record<string, unknown>
  const uploadedFiles = session.uploaded_files as Array<{
    temp_path: string
    file_name: string
    file_size_bytes: number
    mime_type: string
    is_primary: boolean
  }>

  let projectId: string

  // Determine project ID based on action
  if (action === 'create_new' || action === 'link_to_existing') {
    // Create a new project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        name: project_fields.name,
        sector: project_fields.sector as 'government' | 'infrastructure' | 'real_estate' | 'prefab' | 'institutional',
        status: (project_fields.status || 'active') as 'active' | 'on_hold' | 'won' | 'lost' | 'closed',
        stage: (project_fields.stage || 'pursuit') as 'pursuit' | 'capture' | 'bid' | 'award' | 'mobilization' | 'execution' | 'closeout',
        description: project_fields.description || null,
        estimated_value: project_fields.estimated_value || null,
        contract_type: project_fields.contract_type || null,
        delivery_method: project_fields.delivery_method || null,
        location: project_fields.location || null,
        client_entity: project_fields.client_entity || null,
        solicitation_number: project_fields.solicitation_number || null,
        award_date: project_fields.award_date || null,
        ntp_date: project_fields.ntp_date || null,
        substantial_completion_date: project_fields.substantial_completion_date || null,
      })
      .select()
      .single()

    if (projectError || !project) {
      return Response.json({ error: `Failed to create project: ${projectError?.message}` }, { status: 500 })
    }

    projectId = project.id

    // If linking to existing, store relationship in project description for now
    // (project_dependencies table will be available after type regen)
    if (action === 'link_to_existing' && existing_project_id) {
      const currentDesc = project.description || ''
      await supabase.from('projects').update({
        description: `${currentDesc}\n[Parent project: ${existing_project_id}]`.trim(),
      }).eq('id', projectId)
    }
  } else {
    // add_to_existing
    if (!existing_project_id) {
      return Response.json({ error: 'existing_project_id required for add_to_existing' }, { status: 400 })
    }
    projectId = existing_project_id
  }

  // Process parties
  const extractedParties = (extraction.parties || []) as Array<{
    name: string
    company: string | null
    role: string
    email: string | null
    phone: string | null
    is_organization: boolean
  }>

  for (const partyAction of party_actions || []) {
    if (partyAction.action === 'skip') continue

    const extracted = extractedParties[partyAction.extracted_index]
    if (!extracted) continue

    let partyId: string

    if (partyAction.action === 'link_existing' && partyAction.existing_party_id) {
      partyId = partyAction.existing_party_id
    } else {
      // Create new party
      const { data: newParty, error: partyError } = await supabase
        .from('parties')
        .insert({
          full_name: extracted.name,
          company: extracted.company || null,
          email: extracted.email || null,
          phone: extracted.phone || null,
          is_organization: extracted.is_organization || false,
        })
        .select()
        .single()

      if (partyError || !newParty) continue
      partyId = newParty.id
    }

    // Link party to project
    const role = partyAction.role || extracted.role || 'other'
    await supabase.from('project_players').upsert(
      {
        project_id: projectId,
        party_id: partyId,
        role,
        is_primary: false,
      },
      { onConflict: 'project_id,party_id,role' }
    )
  }

  // Process entities
  const extractedEntities = (extraction.entities || []) as Array<{
    name: string
    entity_type: string
    relationship: string
    jurisdiction: string | null
  }>

  for (const entityAction of entity_actions || []) {
    if (entityAction.action === 'skip') continue

    const extracted = extractedEntities[entityAction.extracted_index]
    if (!extracted) continue

    let entityId: string

    if (entityAction.action === 'link_existing' && entityAction.existing_entity_id) {
      entityId = entityAction.existing_entity_id
    } else {
      // Create new entity
      const entityType = VALID_ENTITY_TYPES.includes(extracted.entity_type as EntityType)
        ? (extracted.entity_type as EntityType)
        : 'other'

      const { data: newEntity, error: entityError } = await supabase
        .from('entities')
        .insert({
          name: extracted.name,
          entity_type: entityType,
          jurisdiction: extracted.jurisdiction || null,
        })
        .select()
        .single()

      if (entityError || !newEntity) continue
      entityId = newEntity.id
    }

    // Link entity to project
    await supabase.from('entity_projects').upsert(
      {
        entity_id: entityId,
        project_id: projectId,
        relationship: extracted.relationship || 'owner',
      },
      { onConflict: 'entity_id,project_id,relationship' }
    )
  }

  // Move files from temp to project path and create document records
  const documentIds: string[] = []
  for (const file of uploadedFiles) {
    const timestamp = Date.now()
    const safeName = file.file_name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const newPath = `projects/${projectId}/${timestamp}_${safeName}`

    // Move file in storage
    const { error: moveError } = await supabase.storage
      .from('documents')
      .move(file.temp_path, newPath)

    if (moveError) {
      // If move fails, try copy+delete
      const { data: fileData } = await supabase.storage
        .from('documents')
        .download(file.temp_path)

      if (fileData) {
        await supabase.storage
          .from('documents')
          .upload(newPath, fileData, { contentType: file.mime_type })
        await supabase.storage.from('documents').remove([file.temp_path])
      } else {
        continue
      }
    }

    // Infer doc_type from filename
    const lowerName = file.file_name.toLowerCase()
    let docType = 'proposal'
    if (lowerName.includes('drawing') || lowerName.includes('plan')) docType = 'drawing'
    else if (lowerName.includes('sow') || lowerName.includes('scope')) docType = 'sow'
    else if (lowerName.includes('contract')) docType = 'contract'
    else if (!file.is_primary) docType = 'other'

    // Create document record
    const { data: doc } = await supabase
      .from('documents')
      .insert({
        project_id: projectId,
        storage_path: newPath,
        file_name: file.file_name,
        file_size_bytes: file.file_size_bytes,
        mime_type: file.mime_type,
        doc_type: docType,
        source: 'document',
        uploaded_by: user.id,
        ai_summary: file.is_primary ? (extraction.description as string) || null : null,
        confidence: file.is_primary ? (extraction.confidence as number) || null : null,
      })
      .select()
      .single()

    if (doc) {
      documentIds.push(doc.id)
      // Embed primary document text for vector search (background)
      if (file.is_primary && extraction.scope_of_work) {
        const embedText = `${extraction.project_name || ''}\n${extraction.description || ''}\n${extraction.scope_of_work}`
        embedDocument(doc.id, projectId, embedText).catch(console.error)
      }
    }
  }

  // Update session status
  await supabase
    .from('proposal_intake_sessions')
    .update({
      status: 'confirmed',
      confirmed_action: action,
      confirmed_project_id: projectId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', session_id)

  return Response.json({
    project_id: projectId,
    action,
    documents_created: documentIds.length,
    parties_processed: party_actions?.filter((a) => a.action !== 'skip').length || 0,
    entities_processed: entity_actions?.filter((a) => a.action !== 'skip').length || 0,
  })
}
