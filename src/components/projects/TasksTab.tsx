'use client'

import { useState } from 'react'
import { CheckSquare, Square, ListChecks, Plus, Loader2 } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import AssigneeInput from '@/components/shared/AssigneeInput'

export interface FlatTask {
  updateId: string
  index: number
  text: string
  assignee?: string
  due_date?: string
  completed: boolean
  updateDate: string | null
  updateSource: string
}

function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface TasksTabProps {
  projectId: string
  initialTasks: FlatTask[]
}

export default function TasksTab({ projectId, initialTasks }: TasksTabProps) {
  const [tasks, setTasks] = useState(initialTasks)
  const [toggling, setToggling] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newText, setNewText] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newAssigneePartyId, setNewAssigneePartyId] = useState<string | null>(null)
  const [newDueDate, setNewDueDate] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const openCount = tasks.filter(t => !t.completed).length

  async function handleAddTask() {
    if (!newText.trim()) return
    setAdding(true)
    setAddError(null)

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          text: newText.trim(),
          assignee: newAssignee.trim() || undefined,
          assignee_party_id: newAssigneePartyId || undefined,
          due_date: newDueDate || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to create task')
      }

      const data = await res.json()
      setTasks(prev => [
        ...prev,
        {
          updateId: data.id,
          index: 0,
          text: newText.trim(),
          assignee: newAssignee.trim() || undefined,
          due_date: newDueDate || undefined,
          completed: false,
          updateDate: new Date().toISOString(),
          updateSource: 'manual_task',
        },
      ])
      setNewText('')
      setNewAssignee('')
      setNewAssigneePartyId(null)
      setNewDueDate('')
      setShowAddForm(false)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to create task')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(task: FlatTask) {
    const key = `${task.updateId}-${task.index}`
    if (toggling !== null) return
    setToggling(key)
    const newCompleted = !task.completed

    // Optimistic update
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
        // Rollback
        setTasks(prev =>
          prev.map(t =>
            t.updateId === task.updateId && t.index === task.index
              ? { ...t, completed: !newCompleted }
              : t
          )
        )
      }
    } catch {
      // Rollback
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

  // Sort: incomplete first, then by due_date ascending (nulls last)
  const sorted = [...tasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })

  const addTaskForm = (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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
        <AssigneeInput value={newAssignee} onChange={setNewAssignee} onPartyChange={setNewAssigneePartyId} />
        <input
          type="date"
          value={newDueDate}
          onChange={(e) => setNewDueDate(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {addError && <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={handleAddTask}
          disabled={!newText.trim() || adding}
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

  if (tasks.length === 0 && !showAddForm) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Tasks</h2>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <Plus size={12} />
            Add Task
          </button>
        </div>
        <EmptyState
          icon={ListChecks}
          title="No tasks yet"
          description="Add a task manually or paste an update on the Updates tab to extract action items."
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          Tasks ({openCount} open)
        </h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
        >
          <Plus size={12} />
          Add Task
        </button>
      </div>

      {showAddForm && addTaskForm}

      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {sorted.map((task) => {
          const key = `${task.updateId}-${task.index}`
          return (
            <div
              key={key}
              className={`flex items-start gap-3 px-4 py-3 ${task.completed ? 'opacity-50' : ''}`}
            >
              <button
                onClick={() => handleToggle(task)}
                disabled={toggling === key}
                className="shrink-0 mt-0.5 cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-40"
                aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
              >
                {task.completed ? (
                  <CheckSquare size={16} className="text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Square size={16} className="text-muted-foreground" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p className={`text-sm ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {task.text}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {task.assignee && (
                    <span className="text-xs text-muted-foreground">[{task.assignee}]</span>
                  )}
                  {task.due_date && (
                    <span className="text-xs text-muted-foreground">due {task.due_date}</span>
                  )}
                  {task.updateDate && (
                    <span className="text-xs text-muted-foreground/60">
                      from {formatDate(task.updateDate)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
