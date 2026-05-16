import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { embedDocument } from '@/lib/ai/embeddings'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

const VALID_ENTITY_TYPES = ['llc', 'corp', 'jv', 'subsidiary', 'trust', 'fund', 'other'] as const
type EntityType = typeof VALID_ENTITY_TYPES[number]

interface ProjectToCreate {
  name: string
  sector: string
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
  parent_project_id?: string | null
  attach_to_existing_id?: string | null
}

interface ConfirmBody {
  session_id: string
  projects_to_create: ProjectToCreate[]
  create_developer_contact: boolean
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

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  // Get user if logged in — not a hard gate
  let userId = SYSTEM_USER_ID
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (user?.id) userId = user.id
  } catch {
    // continue as system user
  }

  let body: ConfirmBody
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { session_id, projects_to_create, create_developer_contact, party_actions, entity_actions } = body

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

  const createdProjects: Array<{ id: string; name: string }> = []
  const attachedProjects: Array<{ id: string; name: string }> = []

  // Create or attach all selected projects
  for (const projectFields of projects_to_create) {
    if (!projectFields.name || !projectFields.sector) continue

    // If attaching to an existing project, skip creation
    if (projectFields.attach_to_existing_id) {
      const { data: existing } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', projectFields.attach_to_existing_id)
        .single()
      if (existing) {
        attachedProjects.push({ id: existing.id, name: existing.name })
      }
      continue
    }

    const { data: project } = await supabase
      .from('projects')
      .insert({
        name: projectFields.name,
        sector: projectFields.sector as 'government' | 'infrastructure' | 'real_estate' | 'prefab' | 'institutional',
        status: 'active',
        stage: (projectFields.stage || 'pursuit') as 'pursuit' | 'capture' | 'bid' | 'award' | 'mobilization' | 'execution' | 'closeout',
        description: projectFields.description || null,
        estimated_value: projectFields.estimated_value || null,
        contract_type: projectFields.contract_type || null,
        delivery_method: projectFields.delivery_method || null,
        location: projectFields.location || null,
        client_entity: projectFields.client_entity || null,
        solicitation_number: projectFields.solicitation_number || null,
        award_date: projectFields.award_date || null,
        ntp_date: projectFields.ntp_date || null,
        substantial_completion_date: projectFields.substantial_completion_date || null,
        parent_project_id: projectFields.parent_project_id || null,
      })
      .select()
      .single()

    if (project) {
      createdProjects.push({ id: project.id, name: project.name })
    }
  }

  // All projects that documents/parties should be linked to (created + attached)
  const allTargetProjects = [...createdProjects, ...attachedProjects]

  // Create developer company as vendor/entity (not a contact)
  let developerEntityId: string | null = null
  const developerCompany = extraction.developer_company as { name: string; description: string | null; location: string | null; website: string | null } | null
  if (create_developer_contact && developerCompany?.name) {
    // Check for existing entity with same name first
    const { data: existingEntity } = await supabase
      .from('entities')
      .select('id')
      .ilike('name', developerCompany.name)
      .limit(1)
      .single()

    if (existingEntity) {
      developerEntityId = existingEntity.id
    } else {
      const { data: newEntity } = await supabase
        .from('entities')
        .insert({
          name: developerCompany.name,
          entity_type: 'corp' as const,
          description: developerCompany.description || null,
          headquarters: developerCompany.location || null,
          website_url: developerCompany.website || null,
        })
        .select()
        .single()

      if (newEntity) {
        developerEntityId = newEntity.id
      }
    }

    // Link developer entity to all target projects
    if (developerEntityId) {
      for (const proj of allTargetProjects) {
        await supabase.from('entity_projects').upsert(
          { entity_id: developerEntityId, project_id: proj.id, relationship: 'owner' },
          { onConflict: 'entity_id,project_id,relationship' }
        )
      }
    }
  }

  // Process parties — route organizations to entities, individuals to parties
  const extractedParties = (extraction.parties || []) as Array<{
    name: string; company: string | null; role: string; email: string | null; phone: string | null; is_organization: boolean
  }>
  let partiesCreated = 0
  let partiesLinked = 0
  let orgEntitiesCreated = 0

  for (const partyAction of party_actions || []) {
    if (partyAction.action === 'skip') continue
    const extracted = extractedParties[partyAction.extracted_index]
    if (!extracted) continue

    // Organizations → entities table (vendors/partners)
    if (extracted.is_organization) {
      const roleToRelationship: Record<string, string> = {
        developer: 'owner', client: 'owner', architect: 'sub_entity',
        engineer: 'sub_entity', sub_gc: 'sub_entity', consultant: 'sub_entity',
        pe_partner: 'jv_partner', surety: 'sub_entity', legal: 'sub_entity',
      }
      const relationship = roleToRelationship[extracted.role] || 'sub_entity'

      // Check for existing entity
      const { data: existingEnt } = await supabase
        .from('entities')
        .select('id')
        .ilike('name', extracted.name)
        .limit(1)
        .single()

      const entityId = existingEnt?.id || (await supabase
        .from('entities')
        .insert({
          name: extracted.name,
          entity_type: 'corp' as const,
          description: null,
          headquarters: null,
          website_url: null,
        })
        .select('id')
        .single()
        .then(r => r.data?.id)) || null

      if (entityId) {
        if (!existingEnt) orgEntitiesCreated++
        for (const proj of allTargetProjects) {
          await supabase.from('entity_projects').upsert(
            { entity_id: entityId, project_id: proj.id, relationship },
            { onConflict: 'entity_id,project_id,relationship' }
          )
        }
      }
      continue
    }

    // Individuals → parties table (contacts)
    let partyId: string
    if (partyAction.action === 'link_existing' && partyAction.existing_party_id) {
      partyId = partyAction.existing_party_id
      partiesLinked++
    } else {
      const { data: newParty } = await supabase
        .from('parties')
        .insert({
          full_name: extracted.name,
          company: extracted.company || null,
          email: extracted.email || null,
          phone: extracted.phone || null,
          is_organization: false,
        })
        .select()
        .single()
      if (!newParty) continue
      partyId = newParty.id
      partiesCreated++
    }

    // Link individual to all target projects
    for (const proj of allTargetProjects) {
      await supabase.from('project_players').upsert(
        { project_id: proj.id, party_id: partyId, role: partyAction.role || extracted.role || 'other', is_primary: false },
        { onConflict: 'project_id,party_id,role' }
      )
    }
  }

  // Process entities
  const extractedEntities = (extraction.entities || []) as Array<{
    name: string; entity_type: string; relationship: string; jurisdiction: string | null
  }>
  let entitiesCreated = 0

  for (const entityAction of entity_actions || []) {
    if (entityAction.action === 'skip') continue
    const extracted = extractedEntities[entityAction.extracted_index]
    if (!extracted) continue

    let entityId: string
    if (entityAction.action === 'link_existing' && entityAction.existing_entity_id) {
      entityId = entityAction.existing_entity_id
    } else {
      const entityType = VALID_ENTITY_TYPES.includes(extracted.entity_type as EntityType) ? (extracted.entity_type as EntityType) : 'other'
      const { data: newEntity } = await supabase
        .from('entities')
        .insert({ name: extracted.name, entity_type: entityType, jurisdiction: extracted.jurisdiction || null })
        .select()
        .single()
      if (!newEntity) continue
      entityId = newEntity.id
      entitiesCreated++
    }

    for (const proj of allTargetProjects) {
      await supabase.from('entity_projects').upsert(
        { entity_id: entityId, project_id: proj.id, relationship: extracted.relationship || 'owner' },
        { onConflict: 'entity_id,project_id,relationship' }
      )
    }
  }

  // Move files from temp to first project (or keep generic if multi-project)
  const primaryProjectId = allTargetProjects[0]?.id || null
  const documentIds: string[] = []

  for (const file of uploadedFiles) {
    const timestamp = Date.now()
    const safeName = file.file_name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const newPath = primaryProjectId
      ? `projects/${primaryProjectId}/${timestamp}_${safeName}`
      : `proposals/ingested/${timestamp}_${safeName}`

    const { error: moveError } = await supabase.storage.from('documents').move(file.temp_path, newPath)
    if (moveError) {
      const { data: fileData } = await supabase.storage.from('documents').download(file.temp_path)
      if (fileData) {
        await supabase.storage.from('documents').upload(newPath, fileData, { contentType: file.mime_type })
        await supabase.storage.from('documents').remove([file.temp_path])
      } else continue
    }

    if (primaryProjectId) {
      const { data: doc } = await supabase
        .from('documents')
        .insert({
          project_id: primaryProjectId,
          storage_path: newPath,
          file_name: file.file_name,
          file_size_bytes: file.file_size_bytes,
          mime_type: file.mime_type,
          doc_type: 'proposal',
          source: 'document',
          uploaded_by: userId,
          ai_summary: file.is_primary ? (extraction.intake_summary as string) || null : null,
          confidence: file.is_primary ? (extraction.confidence as number) || null : null,
        })
        .select()
        .single()

      if (doc) {
        documentIds.push(doc.id)
        if (file.is_primary && extraction.intake_summary) {
          const embedText = [extraction.intake_summary, ...(extraction.projects as Array<{ name?: string; scope_of_work?: string }>|| []).map((p) => `${p.name || ''}: ${p.scope_of_work || ''}`).filter(Boolean)].join('\n\n')
          embedDocument(doc.id, primaryProjectId, embedText).catch(console.error)
        }
      }
    }
  }

  // If multi-project, also attach the doc to all other target projects as a reference
  if (allTargetProjects.length > 1 && documentIds.length > 0) {
    for (const proj of allTargetProjects.slice(1)) {
      await supabase.from('documents').update({ project_id: proj.id }).eq('id', documentIds[0])
      // Known limitation: the source doc lives on project 1
    }
  }

  // Update session status
  await supabase
    .from('proposal_intake_sessions')
    .update({
      status: 'confirmed',
      confirmed_action: 'create_new',
      confirmed_project_id: primaryProjectId,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', session_id)

  return Response.json({
    created_projects: createdProjects,
    attached_projects: attachedProjects,
    developer_entity_id: developerEntityId,
    documents_created: documentIds.length,
    parties_created: partiesCreated,
    parties_linked: partiesLinked,
    entities_created: entitiesCreated + orgEntitiesCreated,
  })
}
