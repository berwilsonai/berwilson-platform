/**
 * Convert extraction action items into real `tasks` rows.
 *
 * The extraction prompt still returns `action_items` ({text, assignee, due_date}),
 * but nothing persists that JSON onto `updates` anymore — human-confirmed items
 * become tasks on the board instead. Assignees are resolved by name against
 * `team_members` (same rule as email-ingestion confirm); unmatched names stay
 * unassigned rather than silently creating members.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TablesInsert } from '@/lib/supabase/types'

export interface ActionItemLike {
  text?: string | null
  assignee?: string | null
  due_date?: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function createTasksFromActionItems(
  supabase: SupabaseClient<Database>,
  items: ActionItemLike[],
  { projectId }: { projectId: string | null },
): Promise<number> {
  const usable = items.filter((i) => typeof i?.text === 'string' && i.text.trim())
  if (usable.length === 0) return 0

  const { data: members } = await supabase
    .from('team_members')
    .select('id, name')
    .eq('active', true)
  const memberByName = new Map((members ?? []).map((m) => [m.name.toLowerCase(), m.id]))

  let created = 0
  for (const item of usable) {
    const assignee = item.assignee?.trim().toLowerCase()
    const dueDate = item.due_date && ISO_DATE.test(item.due_date) ? item.due_date : null
    const row: TablesInsert<'tasks'> = {
      title: item.text!.trim(),
      assignee_id: assignee ? memberByName.get(assignee) ?? null : null,
      project_id: projectId,
      due_date: dueDate,
      status: 'open',
    }
    const { error } = await supabase.from('tasks').insert(row)
    if (error) {
      console.error('Create task from action item failed:', error)
      continue
    }
    created++
  }
  return created
}
