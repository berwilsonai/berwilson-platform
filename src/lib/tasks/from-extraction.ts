/**
 * Write an intake extraction's follow-ups onto a record as tasks.
 *
 * ⚠ EXTRACTED, NOT WRITTEN (10-22). This is `applySession`'s step 3 verbatim,
 * lifted out so the Decide queue's new "Task on ⟨deal⟩" button can reach it.
 * §12 is explicit that the way this goes wrong is a SIBLING MODULE written days
 * apart — neither looks like a copy, and the one forked `runDocumentAiPass`
 * silently discarded 413,000 characters. A second function resolving assignees
 * against `team_members` would have been exactly that shape, so there is one.
 *
 * It does only the tasks. No record is created, no party is linked, no
 * attachment is promoted and nothing is embedded — which is the whole point of
 * the button: the answer *"that is not a project, that is a task on Steelton"*
 * had no destination before, so the row's only options were a whole record or
 * dismiss.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/types'
import type { TaskAction } from '@/lib/email-ingestion/defaults'

/** The repo convention — see apply-session.ts, queries.ts and eight others. */
type AdminClient = ReturnType<typeof createAdminClient>

/** Trim to null, so a model's empty string does not land as one. */
function str(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || null
}

export interface TaskApplyResult {
  taskIds: string[]
  /** Rows the insert refused, titled, so the caller can say what did not land. */
  failed: string[]
}

/**
 * ⚠ `projectId` AND `opportunityId` ARE BOTH NULLABLE AND BOTH MAY BE NULL.
 * `tasks` carries a nullable pointer to each (and to an objective, investor and
 * lead), with no exactly-one check — an unattached task is a legitimate row,
 * and §13 records three dated ones that had no owner for months. A caller that
 * wants to require a record enforces that itself; this writes what it is given.
 */
export async function createTasksForRecord({
  supabase,
  tasks,
  projectId,
  opportunityId,
}: {
  supabase: AdminClient
  tasks: TaskAction[]
  projectId: string | null
  opportunityId: string | null
}): Promise<TaskApplyResult> {
  const included = tasks.filter((t) => t.include && str(t.title))
  const result: TaskApplyResult = { taskIds: [], failed: [] }
  if (included.length === 0) return result

  const { data: members } = await supabase
    .from('team_members')
    .select('id, name')
    .eq('active', true)
  const memberByName = new Map((members ?? []).map((m) => [m.name.toLowerCase(), m.id]))

  for (const t of included) {
    const assigneeId = t.assignee ? (memberByName.get(t.assignee.toLowerCase()) ?? null) : null
    const row: TablesInsert<'tasks'> = {
      title: (t.title as string).trim(),
      what: str(t.what),
      why: str(t.why),
      how: str(t.how),
      assignee_id: assigneeId,
      project_id: projectId,
      due_date: str(t.due_date),
      status: 'open',
    }
    // ⚠ SET ONLY WHEN PRESENT. A field the caller never mentioned must be
    // OMITTED rather than nulled (§12) — this column has a default and an
    // explicit NULL does not fall back to it.
    if (opportunityId) row.opportunity_id = opportunityId

    const { data, error } = await supabase.from('tasks').insert(row).select('id').single()
    if (error) {
      // One bad row does not lose the others: a model-supplied due_date outside
      // the date type fails its own insert and the remaining follow-ups are
      // still worth having. The caller reports the count.
      console.error('Create task failed:', error)
      result.failed.push(row.title)
      continue
    }
    result.taskIds.push(data.id)
  }
  return result
}
