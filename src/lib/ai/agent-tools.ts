/**
 * Agent tool definitions and execution for the Construction Executive Agent.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from './perplexity'
import type { AgentContext } from './agent'

// ---------------------------------------------------------------------------
// Tool Declarations (Gemini function-calling format)
// ---------------------------------------------------------------------------

export const agentTools = [
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

      // Text search via ilike on summary (simple but effective for now)
      const keywords = query.split(/\s+/).slice(0, 3).map(k => `%${k}%`)
      if (keywords.length > 0) {
        q = q.or(keywords.map(k => `summary.ilike.${k}`).join(','))
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

    default:
      return { error: `Unknown tool: ${toolName}` }
  }
}
