import { createAdminClient } from '@/lib/supabase/admin'
import { resolveRecordByName } from '@/lib/records/resolve'

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
  /**
   * Which table this candidate is in.
   *
   * ⚠ A DISCRIMINATOR, NEVER INFERRED FROM WHICH ID IS SET. §12: "a new record
   * type is a destination for the HUMAN, never a classification for the model —
   * carry the kind the MATCH came from." Seeding a target from the model's own
   * guess at a kind once sent an opportunity's uuid down the projects branch.
   */
  kind: 'project' | 'opportunity'
  project_id: string | null
  project_name: string | null
  opportunity_id: string | null
  opportunity_name: string | null
  score: number
  match_reasons: string[]
  extracted_project_index: number
}

/**
 * Find the existing records an extracted project might already BE.
 *
 * ⚠ RENAMED FROM findMatchingProjects 2026-10-17, because it no longer searches
 * only projects — and the old name was the bug. An opportunity could never be a
 * candidate here (MatchCandidate had no field for one), so the pre-decide model,
 * which may only choose a merge target from the closed list it is shown, had no
 * way to say "this is the GridEdge opportunity" and said `create` instead.
 * Measured 2026-10-16: 110 of 126 pending sessions proposed creating a new
 * record at 0.93 average confidence, against a register of 19 projects and 7
 * opportunities, with titles like "Steelton Letter-PPL" and "WES / GridEdge
 * Modular Data Center Partnership" among them. `resolveMergeTarget` had been
 * reading `opportunity_name` off these candidates since it was written — a
 * branch nothing could ever satisfy.
 *
 * `includeOpportunities` exists because the two callers want different things
 * and §12 says to add a target rather than fork the pass: the email intake path
 * needs both tables, while /proposals/intake attaches its result to a PROJECT by
 * id and has no opportunity branch in its wizard. Default is false, so a caller
 * that forgets gets the old, narrower behaviour rather than a candidate it
 * cannot render.
 */
export async function findMatchingRecords(
  projects: ExtractedProject[],
  opts: { includeOpportunities?: boolean } = {}
): Promise<MatchCandidate[]> {
  const supabase = createAdminClient()
  const allCandidates: MatchCandidate[] = []

  for (let i = 0; i < projects.length; i++) {
    const extraction = projects[i]
    const candidates: Map<string, MatchCandidate> = new Map()

    // 0. The record-name ladder shared with the meetings path
    //    (src/lib/records/resolve.ts): an exact name, then a single
    //    identity-bearing word. This runs FIRST and over BOTH tables because it
    //    is the only bar here that can reach an opportunity at all, and because
    //    it answers the cases trigram structurally cannot — "Steelton Site"
    //    scores 0.290 against Steelton — Cleveland-Cliffs (PA) and loses, while
    //    "Riverdale Site" scores 0.303 and wins (§12: two identically shaped
    //    names fall either side of any number you pick).
    //
    //    ⚠ FED THE NAME ONLY, not the location or the client. Those are already
    //    weak +0.2 signals against `projects` below, and a shared WORD test over
    //    a location would match a record name on the place in it — which is the
    //    right answer for "Delta, Utah" and the wrong one for a thread that
    //    merely mentions three sites (§12: a deal's location in a three-deal
    //    thread is incidental).
    if (opts.includeOpportunities && extraction.name) {
      const resolved = await resolveRecordByName([extraction.name]).catch(() => null)
      const hit = resolved?.target ?? resolved?.suggestion ?? null
      if (hit) {
        // An exact, unique name is strong enough to act on; a shared word is a
        // suggestion for a human and is deliberately scored below the 0.7 the
        // proposals wizard auto-attaches at.
        const exact = resolved?.via === 'exact_name'
        candidates.set(hit.id, {
          kind: hit.kind,
          project_id: hit.kind === 'project' ? hit.id : null,
          project_name: hit.kind === 'project' ? hit.name : null,
          opportunity_id: hit.kind === 'opportunity' ? hit.id : null,
          opportunity_name: hit.kind === 'opportunity' ? hit.name : null,
          score: exact ? 1.0 : 0.55,
          // Names the WORD, not just the bar: "record_name_shared_word:steelton"
          // is checkable by a reader, "0.55" is not (§12).
          match_reasons: [
            exact
              ? 'record_name_exact'
              : `record_name_shared_word:${(resolved?.matchedWords ?? []).join('+') || '?'}`,
          ],
          extracted_project_index: i,
        })
      }
    }

    // 1. Solicitation number exact match
    if (extraction.solicitation_number) {
      const { data: solMatches } = await supabase
        .from('projects')
        .select('id, name')
        .eq('solicitation_number', extraction.solicitation_number)

      if (solMatches?.length) {
        for (const p of solMatches) {
          candidates.set(p.id, {
            kind: 'project',
            project_id: p.id,
            project_name: p.name,
            opportunity_id: null,
            opportunity_name: null,
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
              kind: 'project',
              project_id: m.id,
              project_name: m.name,
              opportunity_id: null,
              opportunity_name: null,
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
              kind: 'project',
              project_id: p.id,
              project_name: p.name,
              opportunity_id: null,
              opportunity_name: null,
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
              kind: 'project',
              project_id: p.id,
              project_name: p.name,
              opportunity_id: null,
              opportunity_name: null,
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
