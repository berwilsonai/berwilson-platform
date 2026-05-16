import { createAdminClient } from '@/lib/supabase/admin'

export interface ProposalExtraction {
  project_name: string | null
  description: string | null
  sector: string | null
  estimated_value: number | null
  contract_type: string | null
  delivery_method: string | null
  location: string | null
  client_entity: string | null
  solicitation_number: string | null
  award_date: string | null
  ntp_date: string | null
  substantial_completion_date: string | null
  proposal_due_date: string | null
  scope_of_work: string | null
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
  key_dates: Array<{ label: string; date: string; type: string }>
  risks: Array<{ text: string; severity: string }>
  compliance_requirements: string[]
  bonding_required: boolean | null
  naics_code: string | null
  set_aside: string | null
  confidence: number
  field_confidences: Record<string, number>
}

export interface MatchCandidate {
  project_id: string
  project_name: string
  score: number
  match_reasons: string[]
}

export async function findMatchingProjects(
  extraction: ProposalExtraction
): Promise<MatchCandidate[]> {
  const supabase = createAdminClient()
  const candidates: Map<string, MatchCandidate> = new Map()

  // 1. Solicitation number exact match — definitive
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
        })
      }
      // Definitive match — return immediately
      return Array.from(candidates.values())
    }
  }

  // 2. Trigram name similarity
  if (extraction.project_name) {
    const { data: nameMatches } = await supabase.rpc('match_projects_by_name', {
      search_name: extraction.project_name,
      threshold: 0.3,
    }) as unknown as { data: Array<{ id: string; name: string; similarity: number }> | null }

    if (nameMatches?.length) {
      for (const m of nameMatches) {
        const existing = candidates.get(m.id)
        const nameScore = Math.min(m.similarity * 1.2, 0.9) // Scale up but cap
        if (existing) {
          existing.score = Math.min(existing.score + nameScore, 1.0)
          existing.match_reasons.push('name_similarity')
        } else {
          candidates.set(m.id, {
            project_id: m.id,
            project_name: m.name,
            score: nameScore,
            match_reasons: ['name_similarity'],
          })
        }
      }
    }
  }

  // 3. Location match
  if (extraction.location) {
    const locationLower = extraction.location.toLowerCase()
    const { data: locMatches } = await supabase
      .from('projects')
      .select('id, name')
      .ilike('location', `%${locationLower.split(',')[0].trim()}%`)

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
          })
        }
      }
    }
  }

  // 5. Party overlap — check if extracted parties appear in existing projects
  const partyNames = extraction.parties.map((p) => p.name).filter(Boolean)
  if (partyNames.length > 0) {
    const { data: partyMatches } = await supabase
      .from('project_players')
      .select('project_id, projects!inner(id, name), parties!inner(full_name)')
      .in('parties.full_name', partyNames)

    if (partyMatches?.length) {
      // Count overlaps per project
      const projectOverlaps: Map<string, { name: string; count: number }> = new Map()
      for (const row of partyMatches) {
        const pid = row.project_id
        const proj = row.projects as unknown as { id: string; name: string }
        const existing = projectOverlaps.get(pid)
        if (existing) {
          existing.count++
        } else {
          projectOverlaps.set(pid, { name: proj.name, count: 1 })
        }
      }

      for (const [pid, { name, count }] of projectOverlaps) {
        if (count >= 2) {
          const existing = candidates.get(pid)
          if (existing) {
            existing.score = Math.min(existing.score + 0.3, 1.0)
            existing.match_reasons.push('party_overlap')
          } else {
            candidates.set(pid, {
              project_id: pid,
              project_name: name,
              score: 0.3,
              match_reasons: ['party_overlap'],
            })
          }
        }
      }
    }
  }

  // Filter to score > 0.3 and return top 3
  return Array.from(candidates.values())
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
}

/**
 * Find existing parties that match extracted contacts
 */
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
        results.push({
          extracted_index: i,
          extracted_name: party.name,
          matched_party_id: data.id,
          matched_party_name: data.full_name,
          match_type: 'exact_email',
          confidence: 1.0,
        })
        continue
      }
    }

    // 2. Exact name + company match
    let query = supabase.from('parties').select('id, full_name').ilike('full_name', party.name)
    if (party.company) {
      query = query.ilike('company', party.company)
    }
    const { data: exactMatch } = await query.limit(1).single()

    if (exactMatch) {
      results.push({
        extracted_index: i,
        extracted_name: party.name,
        matched_party_id: exactMatch.id,
        matched_party_name: exactMatch.full_name,
        match_type: 'exact_name',
        confidence: 0.95,
      })
      continue
    }

    // 3. Check contact_aliases
    const { data: aliasMatch } = await supabase
      .from('contact_aliases')
      .select('party_id, parties!inner(id, full_name)')
      .ilike('alias_name', party.name)
      .limit(1)
      .single()

    if (aliasMatch) {
      const p = aliasMatch.parties as unknown as { id: string; full_name: string }
      results.push({
        extracted_index: i,
        extracted_name: party.name,
        matched_party_id: p.id,
        matched_party_name: p.full_name,
        match_type: 'exact_name',
        confidence: 0.9,
      })
      continue
    }

    // 4. Fuzzy name match via trigram
    const { data: fuzzyMatches } = await supabase.rpc('match_parties_by_name', {
      search_name: party.name,
      threshold: 0.4,
    }) as unknown as { data: Array<{ id: string; full_name: string; similarity: number }> | null }

    if (fuzzyMatches?.length) {
      results.push({
        extracted_index: i,
        extracted_name: party.name,
        matched_party_id: fuzzyMatches[0].id,
        matched_party_name: fuzzyMatches[0].full_name,
        match_type: 'fuzzy_name',
        confidence: fuzzyMatches[0].similarity,
      })
      continue
    }

    // No match found
    results.push({
      extracted_index: i,
      extracted_name: party.name,
      matched_party_id: null,
      matched_party_name: null,
      match_type: 'none',
      confidence: 0,
    })
  }

  return results
}
