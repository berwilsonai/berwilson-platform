'use client'

import { useState } from 'react'
import { CheckSquare, Square, ListChecks } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'

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

  const openCount = tasks.filter(t => !t.completed).length

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

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="No tasks yet"
        description="Tasks are extracted automatically when you paste updates. Go to the Updates tab to paste project correspondence."
      />
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-foreground">
        Tasks ({openCount} open)
      </h2>

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
