/**
 * Agent tool definitions and execution for the Construction Executive Agent.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from './research'
import { matchChunks } from './match-chunks'
import { embedQuery } from './embeddings'
import { fetchOpenTasks } from '@/lib/tasks/queries'
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
    description: 'Get open tasks (from the team task system), waiting-on blockers, and active risks. Use when asked: "what are our open action items", "what are we waiting on", "what are the active risks", "who owes us a response", or "what needs to happen next". Can scope to one project or pull portfolio-wide.',
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
    description: 'Semantic search across all indexed content — project updates, documents, vendor data, contact enrichment, AND the Ber Wilson company knowledge base (capability statements, past performance, credentials, key personnel). When scoped to a project the company knowledge base is automatically included, so use this to evaluate an RFP/opportunity against what Ber Wilson can actually do. Returns the most relevant passages with source attribution.',
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
    description: 'Get Ber Wilson company profile, certifications, licenses, bonding capacity, diversity status, capabilities, AND the pursuit profile (target sectors, project size range, geographies, delivery methods, contract vehicles, differentiators, and hard disqualifiers). Use this when asked: (1) what certifications or licenses Ber Wilson holds, (2) whether Ber Wilson qualifies for or should pursue a specific RFP/opportunity, (3) Ber Wilson\'s bonding capacity, DBE/MBE/WBE/SBE status, NAICS codes, or trade capabilities, (4) what kind of work Ber Wilson goes after or avoids, (5) due diligence questions about Ber Wilson itself.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'draft_email',
    description: 'Draft a professional email on behalf of the executive. Use when asked to "draft an email", "write a follow-up", "send a message to", or "compose a response". Returns a ready-to-send email with subject line and body.',
    parameters: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'What the email should say or accomplish (e.g. "follow up with Turner about the schedule slip and reference the Davis-Bacon delay")' },
        project_id: { type: 'string', description: 'Optional: project ID for context' },
        recipients: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names or emails of recipients',
        },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'draft_agenda',
    description: 'Draft a meeting agenda. Use when asked to "create an agenda", "prep for a meeting", or "outline talking points". Returns a structured agenda with topics, time allocations, and discussion points.',
    parameters: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'Meeting topic and any specific items to cover' },
        project_id: { type: 'string', description: 'Optional: project ID for context' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Names of attendees',
        },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'draft_status_report',
    description: 'Draft a status report for stakeholders, board members, or partners. Use when asked to "write a status update", "generate a report", or "summarize progress". Returns a formatted report with project summaries, risks, and upcoming milestones.',
    parameters: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'Who the report is for and what it should cover' },
        project_id: { type: 'string', description: 'Optional: scope to a specific project. Omit for portfolio-wide report.' },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'get_attention_items',
    description: 'Get items falling through the cracks — overdue action items, stale waiting-on blockers, approaching milestones, critical DD items, expiring compliance, unfollowed decisions, and cross-project dependency risks. Use when asked: "what am I forgetting", "what\'s falling through the cracks", "what needs attention", "what\'s overdue".',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['all', 'overdue_action', 'stale_waiting', 'approaching_milestone', 'critical_dd', 'expiring_compliance', 'stale_decision', 'dependency_risk'],
          description: 'Filter by category (default: all)',
        },
      },
    },
  },
  {
    name: 'get_cross_project_dependencies',
    description: 'Get active cross-project dependencies and risks. Use when asked about project interdependencies, blocking relationships, or how delays in one project affect others.',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Optional: show dependencies for a specific project (both upstream and downstream)' },
      },
    },
  },
  {
    name: 'list_opportunities',
    description: 'List strategic opportunities (acquisitions, partnerships, JVs, investments, mergers, teaming, market entry) — the non-project deal pipeline. Use when asked "what opportunities are we pursuing", "what acquisitions are in diligence", or to compare/scan the deal pipeline. Returns names, types, statuses, targets, values, and next steps.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['identified', 'evaluating', 'in_discussion', 'due_diligence', 'negotiating', 'agreement', 'closed_won', 'closed_passed'],
          description: 'Filter by pipeline status',
        },
        opp_type: {
          type: 'string',
          enum: ['acquisition', 'partnership', 'joint_venture', 'investment', 'merger', 'divestiture', 'teaming', 'market_entry', 'other'],
          description: 'Filter by opportunity type',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Filter by priority',
        },
      },
    },
  },
  {
    name: 'query_opportunity',
    description: 'Get the full record for one strategic opportunity: all deal fields (objective, thesis, target, counterparty, value, structure, probability, dates, next step), the latest progress notes, and attached document metadata (white papers, CIMs, teasers). Use whenever asked about a specific named opportunity or deal.',
    parameters: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string', description: 'UUID of the opportunity (if known)' },
        name: { type: 'string', description: 'Opportunity or target name to look up (fuzzy match). Provide this when the UUID is unknown.' },
      },
    },
  },
  {
    name: 'search_tasks',
    description: 'Search the team task system. Returns tasks with title, what/why/how, assignee, due date, status, linked project or opportunity, and the latest note. Use when asked "what is Eric working on", "what tasks are open on X", "what is overdue", or anything about to-dos and assignments.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional keyword to match against task title/description' },
        assignee_name: { type: 'string', description: 'Optional: filter by team member name (e.g. "Richard", "Eric")' },
        project_id: { type: 'string', description: 'Optional: filter to a project' },
        opportunity_id: { type: 'string', description: 'Optional: filter to an opportunity' },
        status: {
          type: 'string',
          enum: ['open', 'done', 'all'],
          description: 'Task status filter (default: open)',
        },
        due_before: { type: 'string', description: 'Optional ISO date — only tasks due on/before this date' },
      },
    },
  },
  {
    name: 'get_document_content',
    description: 'Fetch the stored full text of an uploaded document so you can quote or analyze its actual contents (proposals, contracts, RFPs, CIMs). Use after search_knowledge_base or query_opportunity surfaces a relevant document. Returns the file name, AI summary, and extracted text.',
    parameters: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'UUID of the document' },
        source: {
          type: 'string',
          enum: ['project', 'opportunity'],
          description: 'Which document store: "project" for the main documents table (projects/vendors/company), "opportunity" for opportunity documents (default: project)',
        },
      },
      required: ['document_id'],
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
        .select('id, project_id, summary, risks, decisions, waiting_on, source, created_at, confidence')
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
          .select('id, project_id, summary, risks, decisions, created_at')
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
      try {
        const queryEmbedding = await embedQuery(query)

        // Vector search via RPC. When scoped to a project, union in the
        // company knowledge base (project filter alone would exclude it since
        // company chunks carry no project_id). Portfolio scope (empty filter)
        // already returns company chunks.
        const { data: chunks, error: rpcError } = await matchChunks(supabase, {
          query_embedding: `[${queryEmbedding.join(',')}]`,
          filter_project_ids: projectId ? [projectId] : [],
          filter_after: '2000-01-01T00:00:00.000Z',
          match_count: 8,
          filter_entity_ids: [],
          filter_include_company: !!projectId,
        })

        if (rpcError) return { error: rpcError.message }

        // Get project + opportunity names for context (opportunity_id only
        // exists once migration 20260703000001 is applied; undefined before)
        type KBChunk = {
          content: string
          project_id: string | null
          opportunity_id?: string | null
          source_type?: string | null
          is_company?: boolean
          similarity: number
          created_at: string
        }
        const kbChunks = (chunks ?? []) as KBChunk[]
        const projectIds = [...new Set(kbChunks.map((c) => c.project_id).filter(Boolean))]
        const projectNames: Record<string, string> = {}
        if (projectIds.length > 0) {
          const { data: projects } = await supabase.from('projects').select('id, name').in('id', projectIds as string[])
          for (const p of projects ?? []) projectNames[p.id] = p.name
        }
        const oppIds = [...new Set(kbChunks.map((c) => c.opportunity_id).filter(Boolean))]
        const oppNames: Record<string, string> = {}
        if (oppIds.length > 0) {
          try {
            const { data: opps } = await supabase.from('opportunities').select('id, name').in('id', oppIds as string[])
            for (const o of opps ?? []) oppNames[o.id] = o.name
          } catch { /* opportunities table may not exist yet */ }
        }

        return {
          results: kbChunks.slice(0, 8).map((c, i) => ({
            index: i + 1,
            content: c.content.slice(0, 500),
            source: c.is_company
              ? 'Ber Wilson (company knowledge base)'
              : c.opportunity_id
              ? `Opportunity: ${oppNames[c.opportunity_id] ?? 'Unknown'}${c.source_type ? ` (${c.source_type.replace(/_/g, ' ')})` : ''}`
              : c.project_id
              ? projectNames[c.project_id] ?? 'Unknown'
              : 'General',
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
          annual_revenue: profile.annual_revenue,
        },
        pursuit_profile: {
          target_sectors: profile.target_sectors,
          target_geographies: profile.target_geographies,
          delivery_methods: profile.delivery_methods,
          contract_types: profile.contract_types,
          min_project_value: profile.min_project_value,
          sweet_spot_value: profile.sweet_spot_value,
          max_project_value: profile.max_project_value,
          differentiators: profile.differentiators,
          disqualifiers: profile.disqualifiers,
          past_performance: profile.past_performance,
          pursuit_notes: profile.pursuit_notes,
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
        .select('id, project_id, summary, waiting_on, risks, decisions, created_at, projects(name)')
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
        // Open tasks come from the real task system (tasks table)
        const openTasks = await fetchOpenTasks(supabase, projectId ? { projectId } : {})
        result.action_items = openTasks.map(t => ({
          task_id: t.id,
          text: t.title,
          assignee: t.assignee,
          due_date: t.due_date,
          project: t.project_name ?? 'Unassigned',
        }))
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

    case 'draft_email':
    case 'draft_agenda':
    case 'draft_status_report': {
      const typeMap: Record<string, string> = {
        draft_email: 'email',
        draft_agenda: 'agenda',
        draft_status_report: 'report',
      }
      const draftType = typeMap[toolName]
      const instructions = args.instructions as string
      const projectId = (args.project_id as string) || context.projectId
      const recipients = args.recipients as string[] | undefined
      const attendees = args.attendees as string[] | undefined

      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/api/ai/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: draftType,
            context: instructions,
            project_id: projectId,
            recipients: recipients ?? attendees,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string }
          return { error: err.error ?? `Draft failed (${res.status})` }
        }

        const data = await res.json() as { draft: string }
        return { draft: data.draft, type: draftType }
      } catch (err) {
        return { error: `Draft failed: ${err instanceof Error ? err.message : 'unknown'}` }
      }
    }

    case 'get_attention_items': {
      const category = args.category as string | undefined

      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/api/attention`)
        if (!res.ok) return { error: 'Failed to fetch attention items' }

        const data = await res.json() as { items: Record<string, unknown>[]; summary: Record<string, number> }

        let items = data.items
        if (category && category !== 'all') {
          items = items.filter(i => i.category === category)
        }

        return {
          summary: data.summary,
          total_items: items.length,
          items: items.slice(0, 15).map(i => ({
            category: i.category,
            urgency: i.urgency,
            title: i.title,
            detail: i.detail,
            project_name: i.project_name,
          })),
        }
      } catch {
        return { error: 'Failed to fetch attention items' }
      }
    }

    case 'get_cross_project_dependencies': {
      const projectId = (args.project_id as string) || context.projectId

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = (supabase as any)
        .from('project_dependencies')
        .select('id, upstream_project_id, downstream_project_id, dependency_type, description, severity, status, created_at, resolved_at')
        .eq('status', 'active')
        .order('severity')

      if (projectId) {
        q = q.or(`upstream_project_id.eq.${projectId},downstream_project_id.eq.${projectId}`)
      }

      const { data: deps, error: depError } = await q

      if (depError) return { error: depError.message }

      if (!deps || deps.length === 0) {
        return { message: projectId ? 'No active dependencies for this project.' : 'No active cross-project dependencies.' }
      }

      // Get project names
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = [...new Set(deps.flatMap((d: any) => [d.upstream_project_id, d.downstream_project_id]))] as string[]
      const { data: projects } = await supabase.from('projects').select('id, name').in('id', ids)
      const nameMap: Record<string, string> = {}
      for (const p of projects ?? []) nameMap[p.id] = p.name

      return {
        count: deps.length,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dependencies: deps.map((d: any) => ({
          upstream: nameMap[d.upstream_project_id] ?? 'Unknown',
          downstream: nameMap[d.downstream_project_id] ?? 'Unknown',
          type: d.dependency_type,
          description: d.description,
          severity: d.severity,
          age_days: Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86_400_000),
        })),
      }
    }

    case 'list_opportunities': {
      let q = supabase
        .from('opportunities')
        .select('id, name, opp_type, status, priority, target_name, counterparty, sector, estimated_value, probability, lead, next_step, target_close_date, updated_at')
        .order('updated_at', { ascending: false })
        .limit(25)

      if (args.status) q = q.eq('status', args.status as string)
      if (args.opp_type) q = q.eq('opp_type', args.opp_type as string)
      if (args.priority) q = q.eq('priority', args.priority as string)

      const { data: opps, error } = await q
      if (error) return { error: `Opportunities unavailable: ${error.message}` }
      if (!opps || opps.length === 0) return { message: 'No opportunities match those filters.' }

      return {
        count: opps.length,
        opportunities: opps.map((o) => ({
          id: o.id,
          name: o.name,
          type: o.opp_type,
          status: o.status,
          priority: o.priority,
          target: o.target_name,
          counterparty: o.counterparty,
          sector: o.sector,
          estimated_value: o.estimated_value,
          probability: o.probability,
          lead: o.lead,
          next_step: o.next_step,
          target_close_date: o.target_close_date,
          last_activity: o.updated_at,
        })),
      }
    }

    case 'query_opportunity': {
      let oppId = (args.opportunity_id as string) || null

      if (!oppId && args.name) {
        const { data: matches, error } = await supabase
          .from('opportunities')
          .select('id, name, target_name, status')
          .or(`name.ilike.%${(args.name as string).replace(/[%,]/g, '')}%,target_name.ilike.%${(args.name as string).replace(/[%,]/g, '')}%`)
          .limit(5)
        if (error) return { error: `Opportunities unavailable: ${error.message}` }
        if (!matches || matches.length === 0) return { error: `No opportunity found matching "${args.name}". Try list_opportunities.` }
        if (matches.length > 1) {
          return {
            message: 'Multiple opportunities match — call query_opportunity again with the opportunity_id.',
            candidates: matches,
          }
        }
        oppId = matches[0].id
      }
      if (!oppId) return { error: 'Provide opportunity_id or name' }

      const [oppRes, notesRes, docsRes] = await Promise.all([
        supabase.from('opportunities').select('*').eq('id', oppId).single(),
        supabase.from('opportunity_notes').select('body, author, created_at').eq('opportunity_id', oppId).order('created_at', { ascending: false }).limit(10),
        supabase.from('opportunity_documents').select('id, file_name, doc_type, ai_summary, uploaded_at').eq('opportunity_id', oppId).order('uploaded_at', { ascending: false }),
      ])

      if (oppRes.error || !oppRes.data) return { error: `Opportunity not found: ${oppRes.error?.message ?? oppId}` }

      return {
        opportunity: oppRes.data,
        recent_notes: notesRes.data ?? [],
        documents: (docsRes.data ?? []).map((d) => ({
          id: d.id,
          file_name: d.file_name,
          doc_type: d.doc_type,
          ai_summary: d.ai_summary,
          uploaded_at: d.uploaded_at,
          hint: 'Use get_document_content with source="opportunity" to read the full text.',
        })),
      }
    }

    case 'search_tasks': {
      const status = (args.status as string) || 'open'
      let q = supabase
        .from('tasks')
        .select('id, title, what, why, how, assignee_id, project_id, due_date, status, completed_at, created_at')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(25)

      if (status !== 'all') q = q.eq('status', status)
      if (args.project_id) q = q.eq('project_id', args.project_id as string)
      if (args.opportunity_id) q = q.eq('opportunity_id', args.opportunity_id as string)
      if (args.due_before) q = q.lte('due_date', args.due_before as string)
      if (args.query) {
        const term = (args.query as string).replace(/[%,]/g, '')
        q = q.or(`title.ilike.%${term}%,what.ilike.%${term}%,why.ilike.%${term}%,how.ilike.%${term}%`)
      }

      const { data: tasks, error } = await q
      if (error) return { error: `Tasks unavailable: ${error.message}` }

      // Resolve names via separate lookups (dual-schema tolerant — no embeds)
      const { data: members } = await supabase.from('team_members').select('id, name')
      const memberName = new Map((members ?? []).map((m) => [m.id, m.name]))

      let filtered = tasks ?? []
      if (args.assignee_name) {
        const needle = (args.assignee_name as string).toLowerCase()
        const matchIds = new Set((members ?? []).filter((m) => m.name.toLowerCase().includes(needle)).map((m) => m.id))
        filtered = filtered.filter((t) => t.assignee_id && matchIds.has(t.assignee_id))
      }
      if (filtered.length === 0) return { message: 'No tasks match those filters.' }

      const projIds = [...new Set(filtered.map((t) => t.project_id).filter(Boolean))] as string[]
      const projName = new Map<string, string>()
      if (projIds.length > 0) {
        const { data: projects } = await supabase.from('projects').select('id, name').in('id', projIds)
        for (const p of projects ?? []) projName.set(p.id, p.name)
      }

      // Latest note per task (single query, newest first)
      const taskIds = filtered.map((t) => t.id)
      const latestNote = new Map<string, string>()
      if (taskIds.length > 0) {
        const { data: notes } = await supabase
          .from('task_notes')
          .select('task_id, body, created_at')
          .in('task_id', taskIds)
          .order('created_at', { ascending: false })
        for (const n of notes ?? []) {
          if (!latestNote.has(n.task_id)) latestNote.set(n.task_id, n.body)
        }
      }

      return {
        count: filtered.length,
        tasks: filtered.map((t) => ({
          id: t.id,
          title: t.title,
          what: t.what,
          why: t.why,
          how: t.how,
          assignee: t.assignee_id ? memberName.get(t.assignee_id) ?? 'Unknown' : 'Unassigned',
          project: t.project_id ? projName.get(t.project_id) ?? null : null,
          due_date: t.due_date,
          status: t.status,
          completed_at: t.completed_at,
          latest_note: latestNote.get(t.id) ?? null,
        })),
      }
    }

    case 'get_document_content': {
      const docId = args.document_id as string
      if (!docId) return { error: 'document_id is required' }
      const table = args.source === 'opportunity' ? 'opportunity_documents' : 'documents'

      // extracted_text only exists post-migration 20260703000001 — retry without it
      type DocContent = {
        file_name: string
        doc_type: string | null
        ai_summary: string | null
        extracted_text?: string | null
      }
      let doc: DocContent | null = null
      const full = await supabase
        .from(table)
        .select('file_name, doc_type, ai_summary, extracted_text')
        .eq('id', docId)
        .maybeSingle()
      if (!full.error) {
        doc = full.data
      } else if (full.error.code === '42703' || /extracted_text/i.test(full.error.message)) {
        const partial = await supabase
          .from(table)
          .select('file_name, doc_type, ai_summary')
          .eq('id', docId)
          .maybeSingle()
        if (partial.error) return { error: `Document lookup failed: ${partial.error.message}` }
        doc = partial.data
      } else {
        return { error: `Document lookup failed: ${full.error.message}` }
      }
      if (!doc) return { error: `Document not found: ${docId}` }

      const raw = doc.extracted_text ?? ''
      const text = raw.slice(0, 20000)
      return {
        file_name: doc.file_name,
        doc_type: doc.doc_type,
        ai_summary: doc.ai_summary,
        extracted_text: text || null,
        truncated: raw.length > 20000,
        note: text
          ? undefined
          : 'No stored full text for this document (uploaded before full-text indexing, or extraction failed). The ai_summary above is all that is indexed.',
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
