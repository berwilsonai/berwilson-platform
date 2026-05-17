import { createAdminClient } from '@/lib/supabase/admin'

export interface ExtractedProject {
  name: string | null
  description: string | null
  sector: string | null
  stage: string | null
  estimated_value: number | null
  contract_type: string | null
  delivery_method: string | null
  location: string | null
  client_entity: string | null
  solicitation_number: string | null
  award_date: string | null
  ntp_date: string | null
  substantial_completion_date: string | null
  scope_of_work: string | null
  key_facts?: string[]
  confidence: number
}

export interface ProposalExtraction {
  document_type: 'single_project_proposal' | 'developer_portfolio' | 'master_plan' | 'plans_drawings' | 'market_research' | 'investment_pitch' | 'other'
  intake_summary: string
  is_master_plan?: boolean
  master_plan_name?: string | null
  developer_company: {
    name: string
    description: string | null
    location: string | null
    website: string | null
  } | null
  projects: ExtractedProject[]
  parties: Array<{
    name: string
    company: string | null
    role: string
    email: string | null
    phone: string | null
    is_organization: boolean
  }>
  entities: Array<{
    name: string
    entity_type: string
    relationship: string
    jurisdiction: string | null
  }>
  risks: Array<{ text: string; severity: string }>
  compliance_requirements: string[]
  bonding_required: boolean | null
  confidence: number
  field_confidences: Record<string, number>
}

export interface MatchCandidate {
  project_id: string
  project_name: string
  score: number
  match_reasons: string[]
  extracted_project_index: number
}

export async function findMatchingProjects(
  projects: ExtractedProject[]
): Promise<MatchCandidate[]> {
  const supabase = createAdminClient()
  const allCandidates: MatchCandidate[] = []

  for (let i = 0; i < projects.length; i++) {
    const extraction = projects[i]
    const candidates: Map<string, MatchCandidate> = new Map()

    // 1. Solicitation number exact match
    if (extraction.solicitation_number) {
      const { data: solMatches } = await supabase
        .from('projects')
        .select('id, name')
        .eq('solicitation_number', extraction.solicitation_number)

      if (solMatches?.length) {
        for (const p of solMatches) {
          candidates.set(p.id, {
            project_id: p.id,
            project_name: p.name,
            score: 1.0,
            match_reasons: ['solicitation_number_exact'],
            extracted_project_index: i,
          })
        }
        allCandidates.push(...Array.from(candidates.values()))
        continue
      }
    }

    // 2. Trigram name similarity
    if (extraction.name) {
      const { data: nameMatches } = await supabase.rpc('match_projects_by_name', {
        search_name: extraction.name,
        threshold: 0.3,
      }) as unknown as { data: Array<{ id: string; name: string; similarity: number }> | null }

      if (nameMatches?.length) {
        for (const m of nameMatches) {
          const existing = candidates.get(m.id)
          const nameScore = Math.min(m.similarity * 1.2, 0.9)
          if (existing) {
            existing.score = Math.min(existing.score + nameScore, 1.0)
            existing.match_reasons.push('name_similarity')
          } else {
            candidates.set(m.id, {
              project_id: m.id,
              project_name: m.name,
              score: nameScore,
              match_reasons: ['name_similarity'],
              extracted_project_index: i,
            })
          }
        }
      }
    }

    // 3. Location match
    if (extraction.location) {
      const city = extraction.location.split(',')[0].trim()
      const { data: locMatches } = await supabase
        .from('projects')
        .select('id, name')
        .ilike('location', `%${city}%`)

      if (locMatches?.length) {
        for (const p of locMatches) {
          const existing = candidates.get(p.id)
          if (existing) {
            existing.score = Math.min(existing.score + 0.2, 1.0)
            existing.match_reasons.push('location_match')
          } else {
            candidates.set(p.id, {
              project_id: p.id,
              project_name: p.name,
              score: 0.2,
              match_reasons: ['location_match'],
              extracted_project_index: i,
            })
          }
        }
      }
    }

    // 4. Client entity match
    if (extraction.client_entity) {
      const { data: clientMatches } = await supabase
        .from('projects')
        .select('id, name')
        .ilike('client_entity', `%${extraction.client_entity}%`)

      if (clientMatches?.length) {
        for (const p of clientMatches) {
          const existing = candidates.get(p.id)
          if (existing) {
            existing.score = Math.min(existing.score + 0.2, 1.0)
            existing.match_reasons.push('client_entity_match')
          } else {
            candidates.set(p.id, {
              project_id: p.id,
              project_name: p.name,
              score: 0.2,
              match_reasons: ['client_entity_match'],
              extracted_project_index: i,
            })
          }
        }
      }
    }

    const projectCandidates = Array.from(candidates.values())
      .filter((c) => c.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)

    allCandidates.push(...projectCandidates)
  }

  return allCandidates
}

export interface PartyMatch {
  extracted_index: number
  extracted_name: string
  matched_party_id: string | null
  matched_party_name: string | null
  match_type: 'exact_email' | 'exact_name' | 'fuzzy_name' | 'none'
  confidence: number
}

export async function matchExtractedParties(
  parties: ProposalExtraction['parties']
): Promise<PartyMatch[]> {
  const supabase = createAdminClient()
  const results: PartyMatch[] = []

  for (let i = 0; i < parties.length; i++) {
    const party = parties[i]

    // 1. Exact email match
    if (party.email) {
      const { data } = await supabase
        .from('parties')
        .select('id, full_name')
        .eq('email', party.email)
        .limit(1)
        .single()

      if (data) {
        results.push({ extracted_index: i, extracted_name: party.name, matched_party_id: data.id, matched_party_name: data.full_name, match_type: 'exact_email', confidence: 1.0 })
        continue
      }
    }

    // 2. Exact name match
    let query = supabase.from('parties').select('id, full_name').ilike('full_name', party.name)
    if (party.company) query = query.ilike('company', party.company)
    const { data: exactMatch } = await query.limit(1).single()

    if (exactMatch) {
      results.push({ extracted_index: i, extracted_name: party.name, matched_party_id: exactMatch.id, matched_party_name: exactMatch.full_name, match_type: 'exact_name', confidence: 0.95 })
      continue
    }

    // 3. Fuzzy name match
    const { data: fuzzyMatches } = await supabase.rpc('match_parties_by_name', {
      search_name: party.name,
      threshold: 0.4,
    }) as unknown as { data: Array<{ id: string; full_name: string; similarity: number }> | null }

    if (fuzzyMatches?.length) {
      results.push({ extracted_index: i, extracted_name: party.name, matched_party_id: fuzzyMatches[0].id, matched_party_name: fuzzyMatches[0].full_name, match_type: 'fuzzy_name', confidence: fuzzyMatches[0].similarity })
      continue
    }

    results.push({ extracted_index: i, extracted_name: party.name, matched_party_id: null, matched_party_name: null, match_type: 'none', confidence: 0 })
  }

  return results
}
