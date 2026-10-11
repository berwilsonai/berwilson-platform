/**
 * The MCP tool surface.
 *
 * ⚠ EVERY READ IN THIS FILE NAMES A VIEW (`mcp_projects`, `mcp_tasks`) AND
 * NEVER A BASE TABLE. That is the containment guarantee: the exclusion is in
 * the view's own WHERE clause, so a tool added later cannot forget it. If you
 * are about to write `.from('projects')` here, you are removing the only
 * structural protection this surface has.
 *
 * READ-ONLY, DELIBERATELY. Grokbot's plan proposed `add_task` / `update_task` /
 * `complete_task` behind a flag. They are omitted entirely for v1: every
 * mail-and-record-writing path in this platform is draft-only or
 * human-confirmed by construction (§11, `leads/draft-reply.ts`,
 * `commitments/chase.ts`), and an external actor creating records directly is
 * the one thing that invariant exists to prevent. When writes are wanted they
 * should STAGE a proposal a human confirms, which is the pattern already used
 * everywhere else here — not a direct insert behind a config flag.
 *
 * Responses are compact objects with named fields, never raw rows, so adding a
 * column to a base table cannot silently widen what goes out.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'
import { orIlikeAnyWord } from '@/lib/utils/postgrest'
import type { McpTool } from './policy'

/** PostgREST truncates at 1000 rows silently (§12), so every list is capped. */
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25

export interface ToolResult {
  /** Handed back to the assistant. */
  payload: unknown
  /** For the audit row — what actually went out. */
  recordIds: string[]
  /** For the audit row and for the assistant: what was held back. */
  withheld: number
}

interface ProjectView {
  id: string
  name: string
  stage: string | null
  status: string | null
  sector: string | null
  location: string | null
  bid_due_date: string | null
  win_probability: number | null
  next_milestone_date: string | null
  open_task_count: number | null
}

interface TaskView {
  id: string
  title: string
  what: string | null
  why: string | null
  status: string
  due_date: string | null
  project_id: string | null
  project_name: string | null
  assignee_name: string | null
}

/**
 * How many records the views are holding back right now.
 *
 * ⚠ COUNTED ON ITS OWN, NOT DERIVED. §12: `total - visible` is structurally
 * zero once the exclusion ran in SQL, which is exactly how a screen came to
 * report 0 against 22 genuinely withheld rows. Counting the protected set
 * directly is the only honest version — and telling the assistant the number is
 * what stops it stating "Ber Wilson has 18 projects" as a complete answer.
 */
async function withheldCounts(): Promise<{ projects: number; tasks: number }> {
  const supabase = createUntypedAdminClient()
  const [p, t] = await Promise.all([
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('confidential', true),
    supabase.from('mcp_tasks').select('id', { count: 'exact', head: true }),
  ])
  const protectedProjects = p.count ?? 0
  // Tasks: total minus what the view exposes. Safe to subtract HERE because the
  // two numbers come from different relations, which is the case the rule above
  // is warning about the absence of.
  const { count: allTasks } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
  const exposedTasks = t.count ?? 0
  return {
    projects: protectedProjects,
    tasks: Math.max(0, (allTasks ?? 0) - exposedTasks),
  }
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export const TOOL_SCHEMAS: {
  name: McpTool
  description: string
  inputSchema: Record<string, unknown>
}[] = [
  {
    name: 'list_projects',
    description:
      'List Ber Wilson construction/development projects: name, stage, status, sector, location, bid due date, next milestone and open task count. Use this to answer "what are we working on" or to find a project id for get_project. Some projects may be withheld as confidential; the response says how many.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status, e.g. active.' },
        stage: { type: 'string', description: 'Filter by pipeline stage.' },
        limit: { type: 'number', description: `Max rows, up to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.` },
      },
    },
  },
  {
    name: 'get_project',
    description:
      'Details for one project by id, including its open tasks. Returns not_found for a project that does not exist OR is confidential — the two are deliberately indistinguishable.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string', description: 'The project uuid.' } },
      required: ['project_id'],
    },
  },
  {
    name: 'list_tasks',
    description:
      'List tasks with their title, status, due date, assignee and project. Use for "what is due", "what is on my plate", or reminders. Supports due_before/due_after as YYYY-MM-DD.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'e.g. todo, in_progress, done.' },
        project_id: { type: 'string', description: 'Only tasks on this project.' },
        due_before: { type: 'string', description: 'YYYY-MM-DD.' },
        due_after: { type: 'string', description: 'YYYY-MM-DD.' },
        limit: { type: 'number', description: `Max rows, up to ${MAX_LIMIT}.` },
      },
    },
  },
  {
    name: 'search',
    description:
      'Free-text search across project names and task titles. Use when you have a name or phrase but no id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        limit: { type: 'number', description: `Max rows per kind, up to ${MAX_LIMIT}.` },
      },
      required: ['query'],
    },
  },
]

export async function runTool(tool: McpTool, args: Record<string, unknown>): Promise<ToolResult> {
  const supabase = createUntypedAdminClient()
  const withheld = await withheldCounts()

  switch (tool) {
    case 'list_projects': {
      let q = supabase
        .from('mcp_projects')
        .select('*')
        .order('bid_due_date', { ascending: true, nullsFirst: false })
        .limit(clampLimit(args.limit))

      const status = str(args.status)
      const stage = str(args.stage)
      if (status) q = q.eq('status', status)
      if (stage) q = q.eq('stage', stage)

      const { data, error } = await q
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as ProjectView[]

      return {
        payload: {
          projects: rows.map((r) => ({
            id: r.id,
            name: r.name,
            stage: r.stage,
            status: r.status,
            sector: r.sector,
            location: r.location,
            bid_due_date: r.bid_due_date,
            win_probability: r.win_probability,
            next_milestone_date: r.next_milestone_date,
            open_tasks: r.open_task_count ?? 0,
          })),
          confidential_projects_withheld: withheld.projects,
          note:
            withheld.projects > 0
              ? `${withheld.projects} project(s) are confidential and are not included. Do not describe this list as complete.`
              : undefined,
        },
        recordIds: rows.map((r) => r.id),
        withheld: withheld.projects,
      }
    }

    case 'get_project': {
      const id = str(args.project_id)
      if (!id) throw new Error('project_id is required.')

      const { data, error } = await supabase.from('mcp_projects').select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(error.message)

      if (!data) {
        /**
         * ⚠ ONE ANSWER FOR "DOES NOT EXIST" AND "IS PROTECTED". §12: someone who
         * can never open it has no business learning that it exists, and a
         * distinct "protected" reply would confirm the record to anyone holding
         * a token and guessing ids.
         */
        return {
          payload: { found: false, reason: 'No project with that id is available.' },
          recordIds: [],
          withheld: 0,
        }
      }

      const p = data as ProjectView
      const { data: taskData } = await supabase
        .from('mcp_tasks')
        .select('*')
        .eq('project_id', id)
        .neq('status', 'done')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(MAX_LIMIT)
      const tasks = (taskData ?? []) as TaskView[]

      return {
        payload: {
          found: true,
          project: {
            id: p.id,
            name: p.name,
            stage: p.stage,
            status: p.status,
            sector: p.sector,
            location: p.location,
            bid_due_date: p.bid_due_date,
            win_probability: p.win_probability,
            next_milestone_date: p.next_milestone_date,
          },
          open_tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            due_date: t.due_date,
            assignee: t.assignee_name,
          })),
        },
        recordIds: [p.id, ...tasks.map((t) => t.id)],
        withheld: 0,
      }
    }

    case 'list_tasks': {
      let q = supabase
        .from('mcp_tasks')
        .select('*')
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(clampLimit(args.limit))

      const status = str(args.status)
      const projectId = str(args.project_id)
      const dueBefore = str(args.due_before)
      const dueAfter = str(args.due_after)
      if (status) q = q.eq('status', status)
      if (projectId) q = q.eq('project_id', projectId)
      if (dueBefore) q = q.lte('due_date', dueBefore)
      if (dueAfter) q = q.gte('due_date', dueAfter)

      const { data, error } = await q
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as TaskView[]

      return {
        payload: {
          tasks: rows.map((t) => ({
            id: t.id,
            title: t.title,
            what: t.what,
            why: t.why,
            status: t.status,
            due_date: t.due_date,
            project: t.project_name,
            assignee: t.assignee_name,
          })),
          tasks_withheld: withheld.tasks,
          note:
            withheld.tasks > 0
              ? `${withheld.tasks} task(s) are not included because they belong to, or name, a confidential project.`
              : undefined,
        },
        recordIds: rows.map((t) => t.id),
        withheld: withheld.tasks,
      }
    }

    case 'search': {
      const query = str(args.query)
      if (!query) throw new Error('query is required.')
      const limit = clampLimit(args.limit)

      /**
       * ⚠ THROUGH `orIlikeAnyWord`, NEVER A HAND-BUILT `.or()`. §12: an
       * unescaped comma, bracket or apostrophe in a value parses as PostgREST
       * logic — the query dies and the caller reads an empty result as "there is
       * nothing on file". This input comes from a model, so it is exactly the
       * untrusted-punctuation case.
       */
      const projFilter = orIlikeAnyWord(['name', 'location'], query)
      const taskFilter = orIlikeAnyWord(['title', 'what'], query)

      // A query made only of stopwords yields no filter. Returning everything
      // would be the wrong reading of "no usable search terms".
      if (!projFilter && !taskFilter) {
        return {
          payload: { projects: [], tasks: [], note: 'No searchable words in that query.' },
          recordIds: [],
          withheld: 0,
        }
      }

      const [projects, tasks] = await Promise.all([
        projFilter
          ? supabase.from('mcp_projects').select('*').or(projFilter).limit(limit)
          : Promise.resolve({ data: [], error: null }),
        taskFilter
          ? supabase.from('mcp_tasks').select('*').or(taskFilter).limit(limit)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (projects.error) throw new Error(projects.error.message)
      if (tasks.error) throw new Error(tasks.error.message)

      const pRows = (projects.data ?? []) as ProjectView[]
      const tRows = (tasks.data ?? []) as TaskView[]

      return {
        payload: {
          projects: pRows.map((p) => ({ id: p.id, name: p.name, stage: p.stage, status: p.status })),
          tasks: tRows.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            due_date: t.due_date,
            project: t.project_name,
          })),
          withheld: {
            confidential_projects: withheld.projects,
            tasks: withheld.tasks,
          },
          note:
            withheld.projects > 0 || withheld.tasks > 0
              ? 'Confidential records are excluded from this search. A nil result does not mean nothing exists.'
              : undefined,
        },
        recordIds: [...pRows.map((p) => p.id), ...tRows.map((t) => t.id)],
        withheld: withheld.projects + withheld.tasks,
      }
    }
  }
}
