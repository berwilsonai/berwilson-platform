'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Loader2,
  CheckCircle2,
  Circle,
  Trash2,
  ArrowUpRight,
  MapPin,
  MessageSquarePlus,
  Lightbulb,
  Target,
  Send,
  HandCoins,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { DatePicker } from '@/components/ui/date-picker'
import { formatCurrencyCompact } from '@/lib/utils/format'
import { SECTOR_LABELS } from '@/lib/utils/constants'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  type BoardTask,
  type TeamMember,
  type ProjectOption,
  type OpportunityOption,
  type InvestorOption,
  type ObjectiveOption,
  avatarClasses,
  initials,
  handleAuthError,
} from './task-utils'

interface ProjectContext {
  id: string
  name: string
  sector: string | null
  estimated_value: number | null
  location: string | null
  stage: string | null
  status: string | null
}

interface TaskNote {
  id: string
  body: string
  author: string | null
  created_at: string | null
}

interface Player {
  role: string
  name: string
  is_primary: boolean
}

interface TaskDetailSheetProps {
  taskId: string | null
  teamMembers: TeamMember[]
  projects: ProjectOption[]
  opportunities?: OpportunityOption[]
  investors?: InvestorOption[]
  objectives?: ObjectiveOption[]
  /** Hide the project picker when the sheet is opened inside a project. */
  lockProject?: boolean
  onClose: () => void
  onUpdated: (task: BoardTask) => void
  onDeleted: (id: string) => void
}

const fieldClass =
  'w-full rounded-md border border-input bg-background px-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function noteTime(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function TaskDetailSheet({
  taskId,
  teamMembers,
  projects,
  opportunities = [],
  investors = [],
  objectives = [],
  lockProject,
  onClose,
  onUpdated,
  onDeleted,
}: TaskDetailSheetProps) {
  const hasOpps = opportunities.length > 0
  const hasInvestors = investors.length > 0
  const hasObjectives = objectives.length > 0
  const [loading, setLoading] = useState(false)
  const [task, setTask] = useState<BoardTask | null>(null)
  const [project, setProject] = useState<ProjectContext | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [notes, setNotes] = useState<TaskNote[]>([])

  // local editable fields
  const [title, setTitle] = useState('')
  const [what, setWhat] = useState('')
  const [why, setWhy] = useState('')
  const [how, setHow] = useState('')
  const [newNote, setNewNote] = useState('')
  const [postingNote, setPostingNote] = useState(false)

  useEffect(() => {
    if (!taskId) return
    let active = true
    setLoading(true)
    fetch(`/api/tasks/${taskId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active || !data.task) return
        const t = data.task as BoardTask & { project: ProjectContext | null }
        setTask(t)
        setProject(t.project ?? null)
        setPlayers(data.players ?? [])
        setNotes(data.notes ?? [])
        setTitle(t.title ?? '')
        setWhat(t.what ?? '')
        setWhy(t.why ?? '')
        setHow(t.how ?? '')
      })
      .catch(() => toast.error('Could not load task'))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [taskId])

  async function patch(fields: Record<string, unknown>) {
    if (!task) return
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTask(data.task)
      onUpdated(data.task)
    } catch {
      toast.error('Failed to save')
    }
  }

  async function handleComplete() {
    if (!task) return
    const next = task.status === 'done' ? 'open' : 'done'
    await patch({ status: next })
    if (next === 'done') {
      toast.success('Task completed — moved to archive')
      onClose()
    }
  }

  async function handleDelete() {
    if (!task) return
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      onDeleted(task.id)
      toast.success('Task deleted')
      onClose()
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function handleAddNote() {
    if (!task || !newNote.trim()) return
    setPostingNote(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newNote.trim() }),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotes((prev) => [...prev, data.note])
      setNewNote('')
    } catch {
      toast.error('Failed to add note')
    } finally {
      setPostingNote(false)
    }
  }

  const done = task?.status === 'done'

  return (
    <Sheet open={!!taskId} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full sm:max-w-xl">
        {loading || !task ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader className="pr-12 border-b border-border">
              <div className="flex items-start gap-3">
                <button
                  onClick={handleComplete}
                  className="shrink-0 mt-0.5 transition-transform hover:scale-110"
                  aria-label={done ? 'Reopen task' : 'Mark complete'}
                >
                  {done ? (
                    <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground hover:text-emerald-500" />
                  )}
                </button>
                <SheetTitle className="sr-only">Task detail</SheetTitle>
                <textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() !== task.title && patch({ title })}
                  rows={1}
                  className={cn(
                    'flex-1 resize-none bg-transparent text-base font-semibold text-foreground focus:outline-none',
                    done && 'line-through text-muted-foreground',
                  )}
                />
              </div>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
              {/* Meta row */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Assignee</label>
                  <select
                    value={task.assignee_id ?? ''}
                    onChange={(e) => patch({ assignee_id: e.target.value || null })}
                    className={fieldClass}
                  >
                    <option value="">Unassigned</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Due date</label>
                  <DatePicker
                    value={task.due_date ?? ''}
                    onChange={(v) => patch({ due_date: v || null })}
                  />
                </div>
                {!lockProject && projects.length > 0 && (
                  <div className="space-y-1 col-span-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Project</label>
                    <select
                      value={task.project_id ?? ''}
                      onChange={(e) => patch({ project_id: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {hasOpps && (
                  <div className="space-y-1 col-span-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Opportunity</label>
                    <select
                      value={task.opportunity_id ?? ''}
                      onChange={(e) => patch({ opportunity_id: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">No opportunity</option>
                      {opportunities.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {hasInvestors && (
                  <div className="space-y-1 col-span-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Investor</label>
                    <select
                      value={task.investor_id ?? ''}
                      onChange={(e) => patch({ investor_id: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">No investor</option>
                      {investors.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {hasObjectives && (
                  <div className="space-y-1 col-span-2">
                    <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Objective</label>
                    <select
                      value={task.objective_id ?? ''}
                      onChange={(e) => patch({ objective_id: e.target.value || null })}
                      className={fieldClass}
                    >
                      <option value="">No objective</option>
                      {objectives.map((o) => (
                        <option key={o.id} value={o.id}>{o.title}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* What / Why / How */}
              {([
                ['What', what, setWhat, 'what', 'What needs to be done?'],
                ['Why', why, setWhy, 'why', 'Why does it matter?'],
                ['How', how, setHow, 'how', 'How should we approach it?'],
              ] as const).map(([label, val, setter, key, placeholder]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
                  <textarea
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    onBlur={() => {
                      const current = (task[key] ?? '') as string
                      if (val.trim() !== current) patch({ [key]: val })
                    }}
                    placeholder={placeholder}
                    rows={2}
                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                  />
                </div>
              ))}

              {/* Project context card */}
              {project && (
                <Link
                  href={`/projects/${project.id}`}
                  className="block rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{project.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                        {project.sector && (
                          <span>{SECTOR_LABELS[project.sector as keyof typeof SECTOR_LABELS] ?? project.sector}</span>
                        )}
                        {project.estimated_value != null && (
                          <span className="tnum font-medium text-foreground">{formatCurrencyCompact(project.estimated_value)}</span>
                        )}
                        {project.location && (
                          <span className="inline-flex items-center gap-0.5"><MapPin size={10} />{project.location}</span>
                        )}
                      </div>
                    </div>
                    <ArrowUpRight size={15} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  {players.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-x-3 gap-y-1">
                      {players.slice(0, 5).map((pl, i) => (
                        <span key={i} className="text-xs text-muted-foreground">
                          <span className="text-foreground font-medium">{pl.name}</span> · {pl.role}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
              )}

              {/* Opportunity context link */}
              {hasOpps && task.opportunity_id && (() => {
                const opp = opportunities.find((o) => o.id === task.opportunity_id)
                if (!opp) return null
                return (
                  <Link
                    href={`/opportunities/${opp.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/50 transition-colors group"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <Lightbulb size={14} className="shrink-0 text-muted-foreground" />
                      <p className="text-sm font-semibold text-foreground truncate">{opp.name}</p>
                    </div>
                    <ArrowUpRight size={15} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </Link>
                )
              })()}

              {/* Investor context link */}
              {hasInvestors && task.investor_id && (() => {
                const inv = investors.find((o) => o.id === task.investor_id)
                if (!inv) return null
                return (
                  <Link
                    href={`/investors/${inv.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/50 transition-colors group"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <HandCoins size={14} className="shrink-0 text-muted-foreground" />
                      <p className="text-sm font-semibold text-foreground truncate">{inv.name}</p>
                    </div>
                    <ArrowUpRight size={15} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </Link>
                )
              })()}

              {/* Objective context link */}
              {hasObjectives && task.objective_id && (() => {
                const obj = objectives.find((o) => o.id === task.objective_id)
                if (!obj) return null
                return (
                  <Link
                    href="/objectives"
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 hover:bg-muted/50 transition-colors group"
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <Target size={14} className="shrink-0 text-muted-foreground" />
                      <p className="text-sm font-semibold text-foreground truncate">{obj.title}</p>
                    </div>
                    <ArrowUpRight size={15} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </Link>
                )
              })()}

              {/* Notes feed */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <MessageSquarePlus size={13} /> Updates &amp; notes
                </div>
                <div className="space-y-2">
                  {notes.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">No notes yet. Add the first update below.</p>
                  )}
                  {notes.map((n) => (
                    <div key={n.id} className="rounded-md border border-border bg-card p-2.5">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{n.body}</p>
                      <p className="text-[11px] text-muted-foreground/70 mt-1">
                        {n.author ? `${n.author} · ` : ''}{noteTime(n.created_at)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex items-end gap-2 pt-1">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleAddNote() } }}
                    placeholder="Add an update or note…  (⌘↵ to post)"
                    rows={2}
                    className="flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
                  />
                  <button
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || postingNote}
                    className="shrink-0 inline-flex items-center justify-center size-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    aria-label="Add note"
                  >
                    {postingNote ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="border-t border-border p-3 flex items-center justify-between">
              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 size={13} /> Delete
              </button>
              {task.assignee && (
                <span className={cn('inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-xs font-medium', avatarClasses(task.assignee.color))}>
                  <span className="inline-flex items-center justify-center size-5 rounded-full bg-background/40 text-[10px] font-semibold">
                    {initials(task.assignee.name)}
                  </span>
                  {task.assignee.name}
                </span>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
