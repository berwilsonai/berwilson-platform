/**
 * Agent tool definitions and execution for the Construction Executive Agent.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from './research'
import type { AgentContext } from './agent'

// ---------------------------------------------------------------------------
// Tool Declarations (Gemini function-calling format)
// ---------------------------------------------------------------------------

export const agentTools = [
  {
    name: 'list_projects',
    description: 'List projects with optional filters. Use when the user asks "which projects are...", "show me all projects in X stage/sector/status", or needs to find or compare projects by characteristics. Returns project names, values, stages, statuses, sectors, and locations.',
    parameters: {
      type: 'object',
      properties: {
        sector: {
          type: 'string',
          enum: ['government', 'infrastructure', 'real_estate', 'prefab', 'institutional'],
          description: 'Filter by sector',
        },
        stage: {
          type: 'string',
          enum: ['pursuit', 'capture', 'bid', 'award', 'mobilization', 'execution', 'closeout'],
          description: 'Filter by project stage',
        },
        status: {
          type: 'string',
          enum: ['active', 'on_hold', 'won', 'lost', 'closed'],
          description: 'Filter by project status (default: all statuses)',
        },
        programs_only: {
          type: 'boolean',
          description: 'If true, return only parent-level programs (projects with sub-projects)',
        },
      },
    },
  },
  {
    name: 'get_financing_overview',
    description: 'Get the capital stack and financing details for a specific project. Returns senior debt, equity, mezzanine, LTV, interest rates, lender names, PE partners, draw schedule, and waterfall notes. Use whenever asked about how a project is financed, the capital stack, who is lending, or draw status.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'UUID of the project' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_open_items',
    description: 'Get open action items, waiting-on blockers, and active risks from approved project updates. Use when asked: "what are our open action items", "what are we waiting on", "what are the active risks", "who owes us a response", or "what needs to happen next". Can scope to one project or pull portfolio-wide.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Optional: limit to a specific project. Omit for portfolio-wide.' },
        item_type: {
          type: 'string',
          enum: ['action_items', 'waiting_on', 'risks', 'decisions', 'all'],
          description: 'Which type of items to return (default: all)',
        },
        min_severity: {
          type: 'string',
          enum: ['info', 'watch', 'critical', 'blocker'],
          description: 'For risks: minimum severity to include (default: info = all)',
        },
        days_back: {
          type: 'number',
          description: 'How many days of history to scan (default: 30)',
        },
      },
    },
  },
  {
    name: 'get_stakeholders',
    description: 'Get stakeholder relationships and their political temperature for a portfolio site. Returns stakeholder names, roles, temperature (champion/supportive/neutral/concerned/opposed), last interaction summary, and next scheduled contact. Use when asked about political landscape, community support, who is a champion or opponent, or stakeholder engagement.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'UUID of the portfolio site' },
        temperature: {
          type: 'string',
          enum: ['champion', 'supportive', 'neutral', 'concerned', 'opposed', 'unknown'],
          description: 'Optional: filter by stakeholder temperature',
        },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'get_funding_sources',
    description: 'Get the funding stack for a portfolio site — federal grants, state grants, local funding, private equity, debt, tax credits, revenue share, etc. Returns source names, amounts, categories, status, agency contacts, and drawdown notes. Use when asked about how a site is funded, grant status, or capital sourcing.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'UUID of the portfolio site' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'query_project_data',
    description: 'Fetch specific fields from a project record. Use this to get project details like value, dates, status, stage, contract type, delivery method, etc.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'UUID of the project' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of field names to retrieve (e.g. ["name", "estimated_value", "stage", "ntp_date"])',
        },
      },
      required: ['project_id', 'fields'],
    },
  },
  {
    name: 'search_updates',
    description: 'Search project updates using semantic similarity and/or text matching. Returns relevant update summaries, action items, risks, and decisions.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        project_id: { type: 'string', description: 'Optional: limit to a specific project' },
        include_children: { type: 'boolean', description: 'If true and project_id is a program, also search updates from all sub-projects' },
        date_range: {
          type: 'object',
          properties: {
            after: { type: 'string', description: 'ISO date string — only updates after this date' },
            before: { type: 'string', description: 'ISO date string — only updates before this date' },
          },
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_parties',
    description: 'Search people and organizations in the platform by name, company, or role. Returns contact details and relationship information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, company, or keyword to search' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_research',
    description: 'Run an external web research query using Google Search grounding. Use for market data, regulatory updates, competitor info, or anything not in the internal database.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Research question to answer using web sources' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_program_summary',
    description: 'Get a full summary of a program (parent project) and all its sub-projects. Returns aggregated value, per-child status, combined risks, action items, and open DD items across all sub-projects. Use this whenever the user asks about a project that has sub-projects.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'UUID of the parent/program project' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_portfolio_summary',
    description: 'Get a cross-project portfolio overview: project counts by status/stage/sector, total estimated value, upcoming milestones, open risks, and program counts.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_compliance_status',
    description: 'Get compliance and due diligence item status. Returns open items, overdue requirements, and severity breakdown.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Optional: limit to a specific project. Omit for portfolio-wide view.' },
      },
    },
  },
  {
    name: 'search_knowledge_base',
    description: 'Semantic search across all indexed content — updates, documents, vendor data, and contact enrichment. Use for questions about specific facts, meeting notes, document content, or historical information that might be in the knowledge base. Returns the most relevant passages with source attribution.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' },
        project_id: { type: 'string', description: 'Optional: limit to a specific project' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_company_qualifications',
    description: 'Get Ber Wilson company profile, certifications, licenses, bonding capacity, diversity status, and capabilities. Use this when asked: (1) what certifications or licenses Ber Wilson holds, (2) whether Ber Wilson qualifies for a specific RFP or contract requirement, (3) Ber Wilson\'s bonding capacity, DBE/MBE/WBE/SBE status, NAICS codes, or trade capabilities, (4) due diligence questions about Ber Wilson itself.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<unknown> {
  const supabase = createAdminClient()

  switch (toolName) {
    case 'query_project_data': {
      const projectId = (args.project_id as string) || context.projectId
      if (!projectId) return { error: 'No project_id provided or available in context' }

      const fields = args.fields as string[]
      const validFields = [
        'id', 'name', 'sector', 'status', 'stage', 'description', 'location',
        'client_entity', 'estimated_value', 'contract_type', 'delivery_method',
        'solicitation_number', 'award_date', 'ntp_date', 'substantial_completion_date',
        'created_at', 'updated_at', 'parent_project_id',
      ]
      const safeFields = fields.filter(f => validFields.includes(f))
      if (safeFields.length === 0) return { error: 'No valid fields requested' }

      const { data, error } = await supabase
        .from('projects')
        .select(safeFields.join(', '))
        .eq('id', projectId)
        .single()

      if (error) return { error: error.message }
      return data
    }

    case 'search_updates': {
      const query = args.query as string
      const projectId = (args.project_id as string) || context.projectId
      const includeChildren = args.include_children as boolean | undefined
      const dateRange = args.date_range as { after?: string; before?: string } | undefined

      let q = supabase
        .from('updates')
        .select('id, project_id, summary, action_items, risks, decisions, waiting_on, source, created_at, confidence')
        .eq('review_state', 'approved')
        .order('created_at', { ascending: false })
        .limit(10)

      if (projectId) {
        if (includeChildren) {
          // Expand to include child project IDs
          const { data: children } = await supabase
            .from('projects')
            .select('id')
            .eq('parent_project_id', projectId)
          const allIds = [projectId, ...(children ?? []).map((c) => c.id)]
          q = q.in('project_id', allIds)
        } else {
          q = q.eq('project_id', projectId)
        }
      }
      if (dateRange?.after) q = q.gte('created_at', dateRange.after)
      if (dateRange?.before) q = q.lte('created_at', dateRange.before)

      // Text search via ilike across summary and raw_content (raw_content has full email body)
      const keywords = query.split(/\s+/).slice(0, 3).map(k => `%${k}%`)
      if (keywords.length > 0) {
        const conditions = keywords.flatMap(k => [
          `summary.ilike.${k}`,
          `raw_content.ilike.${k}`,
        ])
        q = q.or(conditions.join(','))
      }

      const { data, error } = await q

      if (error) return { error: error.message }
      return { count: data?.length ?? 0, updates: data ?? [] }
    }

    case 'search_parties': {
      const query = args.query as string
      const pattern = `%${query}%`

      const { data, error } = await supabase
        .from('parties')
        .select('id, full_name, company, title, email, phone, is_organization, relationship_notes, government_contract_history')
        .or(`full_name.ilike.${pattern},company.ilike.${pattern},title.ilike.${pattern}`)
        .limit(10)

      if (error) return { error: error.message }

      // Also fetch their project roles
      if (data && data.length > 0) {
        const partyIds = data.map(p => p.id)
        const { data: roles } = await supabase
          .from('project_players')
          .select('party_id, project_id, role, is_primary, projects(name)')
          .in('party_id', partyIds)

        return {
          parties: data.map(p => ({
            ...p,
            project_roles: roles?.filter(r => r.party_id === p.id) ?? [],
          })),
        }
      }

      return { parties: [] }
    }

    case 'run_research': {
      const query = args.query as string
      try {
        const result = await researchQuery(query)
        return {
          text: result.text,
          sources: result.sources,
          model: result.model,
        }
      } catch (err) {
        return { error: `Research failed: ${err instanceof Error ? err.message : 'unknown error'}` }
      }
    }

    case 'get_program_summary': {
      const programId = (args.project_id as string) || context.projectId
      if (!programId) return { error: 'No project_id provided' }

      const [{ data: parent }, { data: children }] = await Promise.all([
        supabase.from('projects').select('*').eq('id', programId).single(),
        supabase.from('projects').select('id, name, sector, status, stage, estimated_value, location').eq('parent_project_id', programId).order('name'),
      ])

      if (!parent) return { error: 'Program project not found' }

      const childList = children ?? []
      const allIds = [programId, ...childList.map((c) => c.id)]

      const [{ data: recentUpdates }, { data: openDdItems }, { data: openCompliance }] = await Promise.all([
        supabase
          .from('updates')
          .select('id, project_id, summary, action_items, risks, decisions, created_at')
          .eq('review_state', 'approved')
          .in('project_id', allIds)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('dd_items')
          .select('id, category, item, severity, status, project_id')
          .in('project_id', allIds)
          .neq('status', 'resolved'),
        supabase
          .from('compliance_items')
          .select('id, framework, requirement, status, due_date, project_id')
          .in('project_id', allIds)
          .not('status', 'in', '("compliant","waived")'),
      ])

      const aggregatedValue =
        (parent.estimated_value ?? 0) +
        childList.reduce((sum, c) => sum + (c.estimated_value ?? 0), 0)

      return {
        program: {
          id: parent.id,
          name: parent.name,
          status: parent.status,
          stage: parent.stage,
          estimated_value: parent.estimated_value,
        },
        sub_projects: childList.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          stage: c.stage,
          estimated_value: c.estimated_value,
          location: c.location,
        })),
        aggregated_value: aggregatedValue,
        sub_project_count: childList.length,
        recent_updates: recentUpdates ?? [],
        open_dd_items: openDdItems ?? [],
        open_compliance_items: openCompliance ?? [],
      }
    }

    case 'get_portfolio_summary': {
      const [projects, milestones, ddItems] = await Promise.all([
        supabase.from('projects').select('id, name, sector, status, stage, estimated_value, parent_project_id'),
        supabase
          .from('milestones')
          .select('id, label, target_date, stage, project_id, projects(name)')
          .is('completed_at', null)
          .gte('target_date', new Date().toISOString().split('T')[0])
          .order('target_date')
          .limit(10),
        supabase
          .from('dd_items')
          .select('id, item, severity, status, project_id')
          .neq('status', 'resolved')
          .in('severity', ['critical', 'blocker']),
      ])

      const allProjects = projects.data ?? []
      const totalValue = allProjects.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0)

      // Identify programs (projects that have children)
      const parentIds = new Set(allProjects.map((p) => p.parent_project_id).filter(Boolean))
      const programs = allProjects.filter((p) => parentIds.has(p.id))
      const standaloneCount = allProjects.filter((p) => !p.parent_project_id && !parentIds.has(p.id)).length

      const byStatus: Record<string, number> = {}
      const byStage: Record<string, number> = {}
      const bySector: Record<string, number> = {}
      for (const p of allProjects) {
        byStatus[p.status ?? 'active'] = (byStatus[p.status ?? 'active'] ?? 0) + 1
        byStage[p.stage ?? 'pursuit'] = (byStage[p.stage ?? 'pursuit'] ?? 0) + 1
        bySector[p.sector] = (bySector[p.sector] ?? 0) + 1
      }

      return {
        project_count: allProjects.length,
        program_count: programs.length,
        standalone_count: standaloneCount,
        total_estimated_value: totalValue,
        by_status: byStatus,
        by_stage: byStage,
        by_sector: bySector,
        upcoming_milestones: milestones.data ?? [],
        open_critical_items: ddItems.data ?? [],
      }
    }

    case 'get_compliance_status': {
      const projectId = (args.project_id as string) || context.projectId

      let complianceQuery = supabase
        .from('compliance_items')
        .select('id, framework, requirement, status, due_date, responsible_party, project_id, projects(name)')
        .order('due_date', { ascending: true })

      let ddQuery = supabase
        .from('dd_items')
        .select('id, category, item, severity, status, assigned_to, project_id, projects(name)')
        .neq('status', 'resolved')
        .order('severity')

      if (projectId) {
        complianceQuery = complianceQuery.eq('project_id', projectId)
        ddQuery = ddQuery.eq('project_id', projectId)
      }

      const [compliance, dd] = await Promise.all([complianceQuery, ddQuery])

      const complianceItems = compliance.data ?? []
      const overdue = complianceItems.filter(
        c => c.due_date && c.status !== 'compliant' && c.status !== 'waived' && new Date(c.due_date) < new Date()
      )

      return {
        compliance: {
          total: complianceItems.length,
          overdue: overdue.length,
          by_status: complianceItems.reduce((acc, c) => {
            const s = c.status ?? 'not_started'
            acc[s] = (acc[s] ?? 0) + 1
            return acc
          }, {} as Record<string, number>),
          overdue_items: overdue.slice(0, 5),
        },
        due_diligence: {
          open_items: dd.data?.length ?? 0,
          by_severity: (dd.data ?? []).reduce((acc, d) => {
            const s = d.severity ?? 'info'
            acc[s] = (acc[s] ?? 0) + 1
            return acc
          }, {} as Record<string, number>),
          critical_items: (dd.data ?? []).filter(d => d.severity === 'critical' || d.severity === 'blocker'),
        },
      }
    }

    case 'search_knowledge_base': {
      const query = args.query as string
      const projectId = (args.project_id as string) || context.projectId

      // Embed the query
      const EMBEDDING_API = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent`
      try {
        const embedRes = await fetch(`${EMBEDDING_API}?key=${process.env.GEMINI_API_KEY!}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text: query }] },
            outputDimensionality: 768,
          }),
        })

        if (!embedRes.ok) return { error: 'Failed to embed query' }

        const embedData = await embedRes.json() as { embedding: { values: number[] } }
        const queryEmbedding = embedData.embedding.values

        // Vector search via RPC
        const { data: chunks, error: rpcError } = await supabase.rpc('match_chunks', {
          query_embedding: `[${queryEmbedding.join(',')}]`,
          filter_project_ids: projectId ? [projectId] : [],
          filter_after: '2000-01-01T00:00:00.000Z',
          match_count: 8,
          filter_entity_ids: [],
        })

        if (rpcError) return { error: rpcError.message }

        // Get project names for context
        const projectIds = [...new Set((chunks ?? []).map((c: { project_id: string | null }) => c.project_id).filter(Boolean))]
        let projectNames: Record<string, string> = {}
        if (projectIds.length > 0) {
          const { data: projects } = await supabase.from('projects').select('id, name').in('id', projectIds as string[])
          for (const p of projects ?? []) projectNames[p.id] = p.name
        }

        return {
          results: (chunks ?? []).slice(0, 8).map((c: { content: string; project_id: string | null; similarity: number; created_at: string }, i: number) => ({
            index: i + 1,
            content: c.content.slice(0, 500),
            project: c.project_id ? projectNames[c.project_id] ?? 'Unknown' : 'General',
            similarity: c.similarity,
            date: c.created_at,
          })),
        }
      } catch (err) {
        return { error: `Knowledge base search failed: ${err instanceof Error ? err.message : 'unknown'}` }
      }
    }

    case 'get_company_qualifications': {
      const [profileRes, certsRes] = await Promise.all([
        supabase.from('company_profile').select('*').limit(1).single(),
        supabase.from('certifications').select('*').order('is_active', { ascending: false }).order('expiration_date', { ascending: true, nullsFirst: false }).order('name'),
      ])

      if (!profileRes.data) return { error: 'Company profile not found — populate /company first' }
      const profile = profileRes.data
      const today = new Date().toISOString().split('T')[0]

      const certs = (certsRes.data ?? []).map(c => {
        const daysUntilExpiry = c.expiration_date
          ? Math.ceil((new Date(c.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
          : null
        const status = !c.is_active ? 'inactive'
          : !c.expiration_date ? 'active (no expiry)'
          : c.expiration_date < today ? 'EXPIRED'
          : daysUntilExpiry !== null && daysUntilExpiry <= 90 ? `active — EXPIRING IN ${daysUntilExpiry} DAYS`
          : 'active'
        return {
          name: c.name,
          issuing_body: c.issuing_body,
          cert_number: c.cert_number,
          issued_date: c.issued_date,
          expiration_date: c.expiration_date,
          status,
          has_document_scan: !!c.document_id,
          notes: c.notes,
        }
      })

      return {
        company: {
          legal_name: profile.legal_name,
          dba_name: profile.dba_name,
          founded_year: profile.founded_year,
          hq_address: profile.hq_address,
          about: profile.about,
          capabilities: profile.capabilities,
          naics_codes: profile.naics_codes,
          sic_codes: profile.sic_codes,
          dbe_certified: profile.dbe_certified,
          mbe_certified: profile.mbe_certified,
          wbe_certified: profile.wbe_certified,
          sbe_certified: profile.sbe_certified,
          bonding_single_project: profile.bonding_capacity,
          bonding_aggregate: profile.aggregate_bonding,
          bonding_company: profile.bonding_company,
        },
        certifications: certs,
        summary: {
          total_certs: certs.length,
          active: certs.filter(c => c.status.startsWith('active')).length,
          expired: certs.filter(c => c.status === 'EXPIRED').length,
          expiring_within_90_days: certs.filter(c => c.status.includes('EXPIRING')).length,
          inactive: certs.filter(c => c.status === 'inactive').length,
        },
      }
    }

    case 'list_projects': {
      let q = supabase
        .from('projects')
        .select('id, name, sector, status, stage, estimated_value, location, client_entity, parent_project_id, solicitation_number')
        .order('name')

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.sector) q = q.eq('sector', args.sector as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.stage) q = q.eq('stage', args.stage as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (args.status) q = q.eq('status', args.status as any)

      const { data: allProjects, error } = await q
      if (error) return { error: error.message }

      let projects = allProjects ?? []

      if (args.programs_only) {
        const parentIds = new Set(projects.map(p => p.parent_project_id).filter(Boolean))
        projects = projects.filter(p => parentIds.has(p.id))
      }

      const totalValue = projects.reduce((sum, p) => sum + (p.estimated_value ?? 0), 0)

      return {
        count: projects.length,
        total_estimated_value: totalValue,
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          sector: p.sector,
          status: p.status,
          stage: p.stage,
          estimated_value: p.estimated_value,
          location: p.location,
          client_entity: p.client_entity,
          solicitation_number: p.solicitation_number,
          is_sub_project: !!p.parent_project_id,
        })),
      }
    }

    case 'get_financing_overview': {
      const projectId = (args.project_id as string) || context.projectId
      if (!projectId) return { error: 'No project_id provided' }

      const [{ data: project }, { data: financing }] = await Promise.all([
        supabase.from('projects').select('name, estimated_value').eq('id', projectId).single(),
        supabase
          .from('financing_structures')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false }),
      ])

      if (!financing || financing.length === 0) {
        return { project: project?.name ?? 'Unknown', message: 'No financing structures recorded for this project.' }
      }

      return {
        project: project?.name ?? 'Unknown',
        estimated_value: project?.estimated_value ?? null,
        structures: financing.map(f => {
          const total = (f.senior_debt ?? 0) + (f.mezzanine ?? 0) + (f.equity_amount ?? 0)
          return {
            structure_type: f.structure_type,
            senior_debt: f.senior_debt,
            mezzanine: f.mezzanine,
            equity_amount: f.equity_amount,
            equity_pct: f.equity_pct,
            ltv: f.ltv,
            interest_rate: f.interest_rate,
            lender: f.lender,
            pe_partner: f.pe_partner,
            total_structured: total,
            draw_schedule: f.draw_schedule,
            waterfall_notes: f.waterfall_notes,
            notes: f.notes,
          }
        }),
      }
    }

    case 'get_open_items': {
      const projectId = (args.project_id as string) || context.projectId
      const itemType = (args.item_type as string) || 'all'
      const daysBack = (args.days_back as number) || 30
      const minSeverity = args.min_severity as string | undefined

      const severityRank: Record<string, number> = { info: 0, watch: 1, critical: 2, blocker: 3 }
      const minRank = minSeverity ? (severityRank[minSeverity] ?? 0) : 0

      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

      let q = supabase
        .from('updates')
        .select('id, project_id, summary, action_items, waiting_on, risks, decisions, created_at, projects(name)')
        .eq('review_state', 'approved')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(50)

      if (projectId) q = q.eq('project_id', projectId)

      const { data: updates, error } = await q
      if (error) return { error: error.message }

      const rows = updates ?? []
      const result: Record<string, unknown[]> = {}

      type JsonObj = Record<string, unknown>
      const projectName = (u: { projects: unknown }) =>
        (u.projects as { name: string } | null)?.name ?? 'Unknown'

      if (itemType === 'all' || itemType === 'action_items') {
        result.action_items = rows.flatMap(u => {
          const items = Array.isArray(u.action_items) ? (u.action_items as JsonObj[]) : []
          return items.map(item => ({
            ...item,
            project: projectName(u),
            update_id: u.id,
            update_date: u.created_at,
          }))
        })
      }

      if (itemType === 'all' || itemType === 'waiting_on') {
        result.waiting_on = rows.flatMap(u => {
          const items = Array.isArray(u.waiting_on) ? (u.waiting_on as JsonObj[]) : []
          return items.map(item => ({
            ...item,
            project: projectName(u),
            update_id: u.id,
            update_date: u.created_at,
          }))
        })
      }

      if (itemType === 'all' || itemType === 'risks') {
        result.risks = rows.flatMap(u => {
          const items = Array.isArray(u.risks) ? (u.risks as JsonObj[]) : []
          return items
            .filter(item => (severityRank[item.severity as string] ?? 0) >= minRank)
            .map(item => ({
              ...item,
              project: projectName(u),
              update_id: u.id,
              update_date: u.created_at,
            }))
        })
      }

      if (itemType === 'all' || itemType === 'decisions') {
        result.decisions = rows.flatMap(u => {
          const items = Array.isArray(u.decisions) ? (u.decisions as JsonObj[]) : []
          return items.map(item => ({
            ...item,
            project: projectName(u),
            update_id: u.id,
            update_date: u.created_at,
          }))
        })
      }

      return {
        scoped_to: projectId ? 'single project' : 'portfolio',
        days_scanned: daysBack,
        updates_scanned: rows.length,
        ...result,
      }
    }

    case 'get_stakeholders': {
      const siteId = args.site_id as string
      if (!siteId) return { error: 'site_id is required' }

      const [{ data: site }, { data: relationships }] = await Promise.all([
        supabase.from('sites').select('name, city, state').eq('id', siteId).single(),
        supabase
          .from('stakeholder_relationships')
          .select(`
            id, role, temperature, notes, next_scheduled, updated_at,
            party:parties ( id, full_name, company, title, email, phone )
          `)
          .eq('site_id', siteId)
          .order('temperature'),
      ])

      if (!relationships || relationships.length === 0) {
        return { site: site?.name ?? 'Unknown', message: 'No stakeholders recorded for this site.' }
      }

      // Filter by temperature if requested
      const filtered = args.temperature
        ? relationships.filter(r => r.temperature === args.temperature)
        : relationships

      // Fetch most recent interaction per relationship
      const relIds = filtered.map(r => r.id)
      type InteractionRow = { relationship_id: string; summary: string; interaction_date: string; medium: string | null; follow_up: string | null }
      let interactions: InteractionRow[] = []
      if (relIds.length > 0) {
        const { data } = await supabase
          .from('stakeholder_interactions')
          .select('relationship_id, summary, interaction_date, medium, follow_up')
          .in('relationship_id', relIds)
          .order('interaction_date', { ascending: false })
        interactions = (data ?? []) as InteractionRow[]
      }

      const latestInteraction = new Map<string, InteractionRow>()
      for (const i of interactions) {
        if (!latestInteraction.has(i.relationship_id)) latestInteraction.set(i.relationship_id, i)
      }

      // Summarize by temperature
      const byTemp: Record<string, number> = {}
      for (const r of filtered) {
        byTemp[r.temperature] = (byTemp[r.temperature] ?? 0) + 1
      }

      return {
        site: site ? `${site.name}${site.city ? `, ${site.city}` : ''}${site.state ? `, ${site.state}` : ''}` : 'Unknown',
        stakeholder_count: filtered.length,
        by_temperature: byTemp,
        stakeholders: filtered.map(r => {
          const party = r.party as { full_name: string; company: string | null; title: string | null; email: string | null; phone: string | null } | null
          const latest = latestInteraction.get(r.id)
          return {
            name: party?.full_name ?? 'Unknown',
            company: party?.company,
            title: party?.title,
            role: r.role,
            temperature: r.temperature,
            notes: r.notes,
            next_scheduled: r.next_scheduled,
            last_interaction: latest ? {
              date: latest.interaction_date,
              summary: latest.summary,
              medium: latest.medium,
              follow_up: latest.follow_up,
            } : null,
          }
        }),
      }
    }

    case 'get_funding_sources': {
      const siteId = args.site_id as string
      if (!siteId) return { error: 'site_id is required' }

      const [{ data: site }, { data: funding }] = await Promise.all([
        supabase.from('sites').select('name, city, state').eq('id', siteId).single(),
        supabase
          .from('funding_sources')
          .select(`
            id, source_name, category, status, amount, percent_of_stack,
            agency, conditions, drawdown_notes, notes,
            contact_party:parties ( full_name, email, phone )
          `)
          .eq('site_id', siteId)
          .order('category'),
      ])

      if (!funding || funding.length === 0) {
        return { site: site?.name ?? 'Unknown', message: 'No funding sources recorded for this site.' }
      }

      const totalFunded = funding.reduce((sum, f) => sum + (f.amount ?? 0), 0)

      // Summary by category
      const byCategory: Record<string, { count: number; total: number }> = {}
      for (const f of funding) {
        const cat = f.category
        if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 }
        byCategory[cat].count++
        byCategory[cat].total += f.amount ?? 0
      }

      // Summary by status
      const byStatus: Record<string, number> = {}
      for (const f of funding) {
        byStatus[f.status] = (byStatus[f.status] ?? 0) + 1
      }

      return {
        site: site ? `${site.name}${site.city ? `, ${site.city}` : ''}` : 'Unknown',
        total_funded: totalFunded,
        source_count: funding.length,
        by_category: byCategory,
        by_status: byStatus,
        sources: funding.map(f => {
          const contact = f.contact_party as { full_name: string; email: string | null; phone: string | null } | null
          return {
            source_name: f.source_name,
            category: f.category,
            status: f.status,
            amount: f.amount,
            percent_of_stack: f.percent_of_stack,
            agency: f.agency,
            conditions: f.conditions,
            drawdown_notes: f.drawdown_notes,
            notes: f.notes,
            contact: contact ? `${contact.full_name}${contact.email ? ` <${contact.email}>` : ''}` : null,
          }
        }),
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
