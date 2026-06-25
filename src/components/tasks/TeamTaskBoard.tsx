'use client'

import { useMemo, useState } from 'react'
import {
  Plus,
  Loader2,
  Circle,
  CheckCircle2,
  ListChecks,
  FolderKanban,
  Archive,
  UserPlus,
  X,
} from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { DatePicker } from '@/components/ui/date-picker'
import TaskDetailSheet from './TaskDetailSheet'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  type BoardTask,
  type TeamMember,
  type ProjectOption,
  getDueLabel,
  avatarClasses,
  initials,
} from './task-utils'

interface TeamTaskBoardProps {
  initialTasks: BoardTask[]
  teamMembers: TeamMember[]
  projects: ProjectOption[]
  /** When set, the board is scoped to a single project (project tab mode). */
  scopeProjectId?: string
}

type StatusFilter = 'open' | 'done'

const fieldClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

export default function TeamTaskBoard({
  initialTasks,
  teamMembers,
  projects,
  scopeProjectId,
}: TeamTaskBoardProps) {
  const scoped = !!scopeProjectId
  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks)
  const [members, setMembers] = useState<TeamMember[]>(teamMembers)

  // filters
  const [status, setStatus] = useState<StatusFilter>('open')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')

  // detail sheet
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  // add form
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState(scopeProjectId ?? '')
  const [dueDate, setDueDate] = useState('')
  const [adding, setAdding] = useState(false)

  // quick-add teammate
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')

  const openCount = tasks.filter((t) => t.status !== 'done').length

  async function handleAddTask() {
    if (!title.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          assignee_id: assigneeId || undefined,
          project_id: (scopeProjectId ?? projectId) || undefined,
          due_date: dueDate || undefined,
        }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks((prev) => [data.task, ...prev])
      setTitle('')
      setAssigneeId('')
      setDueDate('')
      if (!scoped) setProjectId('')
      setShowAdd(false)
      toast.success('Task added')
    } catch {
      toast.error('Failed to add task')
    } finally {
      setAdding(false)
    }
  }

  async function handleAddMember() {
    if (!newMemberName.trim()) return
    try {
      const res = await fetch('/api/team-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMemberName.trim() }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMembers((prev) => [...prev, data.member])
      setAssigneeId(data.member.id)
      setNewMemberName('')
      setAddingMember(false)
    } catch {
      toast.error('Failed to add teammate')
    }
  }

  async function handleComplete(task: BoardTask, e: React.MouseEvent) {
    e.stopPropagation()
    const next = task.status === 'done' ? 'open' : 'done'
    // optimistic
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)))
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error()
      if (next === 'done') toast.success('Completed — moved to archive')
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)))
      toast.error('Failed to update')
    }
  }

  const filtered = useMemo(() => {
    let list = tasks.filter((t) => (status === 'done' ? t.status === 'done' : t.status !== 'done'))
    if (assigneeFilter !== 'all') {
      list = list.filter((t) =>
        assigneeFilter === 'unassigned' ? !t.assignee_id : t.assignee_id === assigneeFilter,
      )
    }
    if (!scoped && projectFilter !== 'all') {
      list = list.filter((t) =>
        projectFilter === 'none' ? !t.project_id : t.project_id === projectFilter,
      )
    }
    return [...list].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }, [tasks, status, assigneeFilter, projectFilter, scoped])

  return (
    <div className={cn('space-y-5', !scoped && 'max-w-4xl')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className={cn('font-semibold text-foreground', scoped ? 'text-base' : 'text-xl')}>
            {scoped ? 'Tasks' : 'Team Tasks'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {openCount} open{scoped ? '' : ' across the team'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd((s) => !s)}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all elev-1"
        >
          <Plus size={15} /> New task
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 elev-2 animate-fade-in-up">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTask() } }}
            placeholder="What needs to be done?"
            autoFocus
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm font-medium placeholder:text-muted-foreground placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className={cn('grid gap-3', scoped ? 'grid-cols-2' : 'grid-cols-3')}>
            {/* Assignee + quick add */}
            {addingMember ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddMember() } }}
                  placeholder="Name…"
                  autoFocus
                  className={cn(fieldClass, 'flex-1 min-w-0')}
                />
                <button onClick={handleAddMember} className="shrink-0 inline-flex items-center justify-center size-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90" aria-label="Save teammate">
                  <Plus size={15} />
                </button>
                <button onClick={() => { setAddingMember(false); setNewMemberName('') }} className="shrink-0 inline-flex items-center justify-center size-9 rounded-md border border-input hover:bg-muted" aria-label="Cancel">
                  <X size={15} />
                </button>
              </div>
            ) : (
              <select
                value={assigneeId}
                onChange={(e) => {
                  if (e.target.value === '__add__') { setAddingMember(true); return }
                  setAssigneeId(e.target.value)
                }}
                className={fieldClass}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
                <option value="__add__">+ Add teammate…</option>
              </select>
            )}

            {!scoped && (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={fieldClass}
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}

            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Due date" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddTask}
              disabled={!title.trim() || adding}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add task
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-muted transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          <button
            onClick={() => setStatus('open')}
            className={cn('px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors',
              status === 'open' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted')}
          >
            <ListChecks size={14} /> Open
          </button>
          <button
            onClick={() => setStatus('done')}
            className={cn('px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors border-l border-border',
              status === 'done' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted')}
          >
            <Archive size={14} /> Archive
          </button>
        </div>

        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>

        {!scoped && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">No project</option>
          </select>
        )}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={status === 'done' ? Archive : ListChecks}
          title={status === 'done' ? 'Nothing archived yet' : 'No open tasks'}
          description={status === 'done' ? 'Completed tasks land here for reference.' : 'Add a task to get the team moving.'}
        />
      ) : (
        <div className="space-y-2 stagger-children">
          {filtered.map((task) => {
            const due = task.due_date ? getDueLabel(task.due_date) : null
            const done = task.status === 'done'
            return (
              <div
                key={task.id}
                onClick={() => setOpenTaskId(task.id)}
                className={cn(
                  'group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 cursor-pointer lift',
                  done && 'opacity-60',
                )}
              >
                <button
                  onClick={(e) => handleComplete(task, e)}
                  className="shrink-0 transition-transform hover:scale-110"
                  aria-label={done ? 'Reopen' : 'Complete'}
                >
                  {done ? (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium truncate', done ? 'line-through text-muted-foreground' : 'text-foreground')}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {!scoped && task.project && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FolderKanban size={11} /> {task.project.name}
                      </span>
                    )}
                    {due && (
                      <span className={cn('text-xs font-medium tnum',
                        due.overdue ? 'text-red-500 dark:text-red-400' : due.urgent ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                        {due.label}
                      </span>
                    )}
                  </div>
                </div>

                {task.assignee && (
                  <span
                    title={task.assignee.name}
                    className={cn('shrink-0 inline-flex items-center justify-center size-7 rounded-full text-[11px] font-semibold', avatarClasses(task.assignee.color))}
                  >
                    {initials(task.assignee.name)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <TaskDetailSheet
        taskId={openTaskId}
        teamMembers={members}
        projects={projects}
        lockProject={scoped}
        onClose={() => setOpenTaskId(null)}
        onUpdated={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))}
        onDeleted={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  )
}
