'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CheckSquare,
  Square,
  ListChecks,
  Plus,
  Loader2,
  Trash2,
  FolderKanban,
} from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'

export interface GlobalTask {
  updateId: string
  index: number
  text: string
  assignee?: string
  due_date?: string
  completed: boolean
  updateDate: string | null
  updateSource: string
  projectId: string
  projectName: string
}

interface AllTasksViewProps {
  initialTasks: GlobalTask[]
  projects: { id: string; name: string }[]
}

type FilterMode = 'open' | 'completed' | 'all'

function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getDueLabel(due: string): { label: string; urgent: boolean; overdue: boolean } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(due + 'T00:00:00')
  const diffMs = dueDate.getTime() - today.getTime()
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return { label: `${Math.abs(diffDays)}d overdue`, urgent: true, overdue: true }
  if (diffDays === 0) return { label: 'Due today', urgent: true, overdue: false }
  if (diffDays === 1) return { label: 'Due tomorrow', urgent: true, overdue: false }
  if (diffDays <= 7) return { label: `Due in ${diffDays}d`, urgent: true, overdue: false }
  return { label: `Due ${formatDate(due)}`, urgent: false, overdue: false }
}

export default function AllTasksView({ initialTasks, projects }: AllTasksViewProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [toggling, setToggling] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterMode>('open')
  const [projectFilter, setProjectFilter] = useState<string>('all')

  // Add task form
  const [showAddForm, setShowAddForm] = useState(false)
  const [newText, setNewText] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [newProjectId, setNewProjectId] = useState(projects[0]?.id ?? '')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const openCount = tasks.filter(t => !t.completed).length
  const completedCount = tasks.filter(t => t.completed).length

  async function handleAddTask() {
    if (!newText.trim() || !newProjectId) return
    setAdding(true)
    setAddError(null)

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: newProjectId,
          text: newText.trim(),
          assignee: newAssignee.trim() || undefined,
          due_date: newDueDate || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create task')
      }

      const data = await res.json()
      const project = projects.find(p => p.id === newProjectId)
      setTasks(prev => [
        {
          updateId: data.id,
          index: 0,
          text: newText.trim(),
          assignee: newAssignee.trim() || undefined,
          due_date: newDueDate || undefined,
          completed: false,
          updateDate: new Date().toISOString(),
          updateSource: 'manual_task',
          projectId: newProjectId,
          projectName: project?.name ?? 'Unknown Project',
        },
        ...prev,
      ])
      setNewText('')
      setNewAssignee('')
      setNewDueDate('')
      setShowAddForm(false)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(task: GlobalTask) {
    const key = `${task.updateId}-${task.index}`
    if (toggling !== null) return
    setToggling(key)
    const newCompleted = !task.completed

    setTasks(prev =>
      prev.map(t =>
        t.updateId === task.updateId && t.index === task.index
          ? { ...t, completed: newCompleted }
          : t
      )
    )

    try {
      const res = await fetch(`/api/updates/${task.updateId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: task.index, completed: newCompleted }),
      })
      if (!res.ok) {
        setTasks(prev =>
          prev.map(t =>
            t.updateId === task.updateId && t.index === task.index
              ? { ...t, completed: !newCompleted }
              : t
          )
        )
      }
    } catch {
      setTasks(prev =>
        prev.map(t =>
          t.updateId === task.updateId && t.index === task.index
            ? { ...t, completed: !newCompleted }
            : t
        )
      )
    } finally {
      setToggling(null)
    }
  }

  async function handleDelete(task: GlobalTask) {
    const key = `${task.updateId}-${task.index}`
    setDeleting(key)

    // Optimistic remove
    setTasks(prev => prev.filter(t => !(t.updateId === task.updateId && t.index === task.index)))

    try {
      const res = await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: task.updateId, index: task.index }),
      })
      if (!res.ok) {
        // Rollback
        setTasks(prev => [...prev, task])
      }
    } catch {
      setTasks(prev => [...prev, task])
    } finally {
      setDeleting(null)
    }
  }

  // Filter tasks
  let filtered = tasks
  if (filter === 'open') filtered = filtered.filter(t => !t.completed)
  if (filter === 'completed') filtered = filtered.filter(t => t.completed)
  if (projectFilter !== 'all') filtered = filtered.filter(t => t.projectId === projectFilter)

  // Sort: overdue first, then by due_date ascending (nulls last), then by creation date
  const sorted = [...filtered].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return (b.updateDate ?? '').localeCompare(a.updateDate ?? '')
  })

  // Group by project for display
  const uniqueProjects = [...new Set(tasks.map(t => t.projectId))]
  const projectOptions = uniqueProjects
    .map(id => ({ id, name: tasks.find(t => t.projectId === id)?.projectName ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const addTaskForm = (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <select
          value={newProjectId}
          onChange={(e) => setNewProjectId(e.target.value)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="What needs to be done?"
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddTask() } }}
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input
          type="text"
          value={newAssignee}
          onChange={(e) => setNewAssignee(e.target.value)}
          placeholder="Assignee (optional)"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {addError && <p className="text-sm text-red-600">{addError}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleAddTask}
          disabled={!newText.trim() || !newProjectId || adding}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-xs font-medium hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add Task
        </button>
        <button
          onClick={() => { setShowAddForm(false); setAddError(null) }}
          className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground">
            {openCount} open{completedCount > 0 ? ` / ${completedCount} completed` : ''} across all projects
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus size={12} />
          Add Task
        </button>
      </div>

      {showAddForm && addTaskForm}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center rounded-md border border-border overflow-hidden text-xs">
          {(['open', 'completed', 'all'] as FilterMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filter === mode
                  ? 'bg-foreground text-background'
                  : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All projects</option>
          {projectOptions.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Task list */}
      {sorted.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={filter === 'open' ? 'No open tasks' : filter === 'completed' ? 'No completed tasks' : 'No tasks yet'}
          description="Add a task above or paste updates on a project's Updates tab to extract action items."
        />
      ) : (
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          {sorted.map((task) => {
            const key = `${task.updateId}-${task.index}`
            const due = task.due_date ? getDueLabel(task.due_date) : null
            return (
              <div
                key={key}
                className={`flex items-start gap-3 px-4 py-3 group ${task.completed ? 'opacity-50' : ''}`}
              >
                <button
                  onClick={() => handleToggle(task)}
                  disabled={toggling === key}
                  className="shrink-0 mt-0.5 cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-40"
                  aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
                >
                  {task.completed ? (
                    <CheckSquare size={16} className="text-emerald-600" />
                  ) : (
                    <Square size={16} className="text-muted-foreground" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {task.text}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Link
                      href={`/projects/${task.projectId}/tasks`}
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-400 transition-colors"
                    >
                      <FolderKanban size={10} />
                      {task.projectName}
                    </Link>
                    {task.assignee && (
                      <span className="text-xs text-muted-foreground">[{task.assignee}]</span>
                    )}
                    {due && (
                      <span className={`text-xs font-medium ${
                        due.overdue ? 'text-red-500' : due.urgent ? 'text-amber-500' : 'text-muted-foreground'
                      }`}>
                        {due.label}
                      </span>
                    )}
                    {task.updateDate && (
                      <span className="text-xs text-muted-foreground/60">
                        added {formatDate(task.updateDate)}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(task)}
                  disabled={deleting === key}
                  className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all disabled:opacity-40"
                  aria-label="Delete task"
                >
                  {deleting === key ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
