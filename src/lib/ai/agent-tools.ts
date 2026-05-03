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
    name: 'get_portfolio_summary',
    description: 'Get a cross-project portfolio overview: project counts by status/stage/sector, total estimated value, upcoming milestones, and open risks.',
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
        'created_at', 'updated_at',
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
      const dateRange = args.date_range as { after?: string; before?: string } | undefined

      let q = supabase
        .from('updates')
        .select('id, project_id, summary, action_items, risks, decisions, waiting_on, source, created_at, confidence')
        .eq('review_state', 'approved')
        .order('created_at', { ascending: false })
        .limit(10)

      if (projectId) q = q.eq('project_id', projectId)
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

    case 'get_portfolio_summary': {
      const [projects, milestones, ddItems] = await Promise.all([
        supabase.from('projects').select('id, name, sector, status, stage, estimated_value'),
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
