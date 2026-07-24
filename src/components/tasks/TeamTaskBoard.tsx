'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Plus,
  FileText,
  Loader2,
  Circle,
  CheckCircle2,
  ListChecks,
  FolderKanban,
  Lightbulb,
  Target,
  Archive,
  X,
  HandCoins,
  Hourglass,
  Users2,
} from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { DatePicker } from '@/components/ui/date-picker'
import TaskDetailSheet from './TaskDetailSheet'
import ManageTeamDialog from './ManageTeamDialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  type BoardTask,
  type TeamMember,
  type ProjectOption,
  type OpportunityOption,
  type InvestorOption,
  type ObjectiveOption,
  getDueLabel,
  avatarClasses,
  initials,
  waitingAge,
  handleAuthError,
} from './task-utils'

interface TeamTaskBoardProps {
  initialTasks: BoardTask[]
  teamMembers: TeamMember[]
  projects: ProjectOption[]
  opportunities?: OpportunityOption[]
  investors?: InvestorOption[]
  objectives?: ObjectiveOption[]
  /** When set, the board is scoped to a single project (project tab mode). */
  scopeProjectId?: string
  /** When set, the board is scoped to a single opportunity (opportunity detail mode). */
  scopeOpportunityId?: string
  /** When set, the board is scoped to a single investor (investor detail mode). */
  scopeInvestorId?: string
  /** Hide the board's own heading (the host page provides a section title). */
  embedded?: boolean
  /** Show the weekly-report link (admin-only — /reports is admin-gated by default-deny). */
  showWeeklyReport?: boolean
  /** Open this task's detail sheet on mount (deep link from search: /tasks?task=<id>). */
  initialOpenTaskId?: string | null
}

type StatusFilter = 'open' | 'done'

const fieldClass =
  'h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

const filterFieldClass =
  'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring'

export default function TeamTaskBoard({
  initialTasks,
  teamMembers,
  projects,
  opportunities = [],
  investors = [],
  objectives = [],
  scopeProjectId,
  scopeOpportunityId,
  scopeInvestorId,
  embedded = false,
  showWeeklyReport = false,
  initialOpenTaskId = null,
}: TeamTaskBoardProps) {
  const scopedToProject = !!scopeProjectId
  const scopedToOpportunity = !!scopeOpportunityId
  const scopedToInvestor = !!scopeInvestorId
  // "scoped" = pinned to a single parent record (project tab, opportunity or investor detail).
  const scoped = scopedToProject || scopedToOpportunity || scopedToInvestor
  // Which pickers/filters to render (hidden when locked to that parent or when there's nothing to pick).
  const showProjectControls = !scopedToProject && projects.length > 0
  const showOpportunityControls = !scopedToOpportunity && opportunities.length > 0
  const showInvestorControls = !scopedToInvestor && investors.length > 0
  const showObjectiveControls = objectives.length > 0
  const oppName = (id: string | null) =>
    id ? opportunities.find((o) => o.id === id)?.name ?? null : null
  const investorName = (id: string | null) =>
    id ? investors.find((o) => o.id === id)?.name ?? null : null
  const objectiveTitle = (id: string | null) =>
    id ? objectives.find((o) => o.id === id)?.title ?? null : null
  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks)
  const [members, setMembers] = useState<TeamMember[]>(teamMembers)

  // filters
  const [status, setStatus] = useState<StatusFilter>('open')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [opportunityFilter, setOpportunityFilter] = useState('all')
  const [investorFilter, setInvestorFilter] = useState('all')
  const [objectiveFilter, setObjectiveFilter] = useState('all')
  const [blockedOnly, setBlockedOnly] = useState(false)

  // detail sheet
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialOpenTaskId)

  // add form
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState(scopeProjectId ?? '')
  const [opportunityId, setOpportunityId] = useState(scopeOpportunityId ?? '')
  const [investorId, setInvestorId] = useState(scopeInvestorId ?? '')
  const [objectiveId, setObjectiveId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [adding, setAdding] = useState(false)

  // quick-add teammate
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  // manage-team dialog (add / remove people)
  const [manageOpen, setManageOpen] = useState(false)

  const openCount = tasks.filter((t) => t.status !== 'done').length
  const blockedCount = tasks.filter((t) => t.status !== 'done' && t.waiting_on_id).length
  const memberName = (id: string | null) =>
    id ? members.find((m) => m.id === id)?.name ?? null : null

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
          opportunity_id: (scopeOpportunityId ?? opportunityId) || undefined,
          investor_id: (scopeInvestorId ?? investorId) || undefined,
          objective_id: objectiveId || undefined,
          due_date: dueDate || undefined,
        }),
      })
      if (handleAuthError(res)) return
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks((prev) => [data.task, ...prev])
      setTitle('')
      setAssigneeId('')
      setDueDate('')
      setObjectiveId('')
      if (!scopedToOpportunity) setOpportunityId('')
      if (!scopedToInvestor) setInvestorId('')
      if (!scopedToProject) setProjectId('')
      setShowAdd(false)
      toast.success('Task added')
    } catch {
      toast.error('Failed to add task')
    } finally {
      setAdding(false)
    }
  }

  function addMemberToState(member: TeamMember) {
    setMembers((prev) => (prev.some((m) => m.id === member.id) ? prev : [...prev, member]))
  }

  async function handleAddMember() {
    const trimmed = newMemberName.trim()
    if (!trimmed) return
    try {
      const res = await fetch('/api/team-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (handleAuthError(res)) return
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Failed to add teammate')
      addMemberToState(data.member)
      setAssigneeId(data.member.id)
      setNewMemberName('')
      setAddingMember(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add teammate')
    }
  }

  function handleMemberRemoved(removedId: string, reassignTo: string | null) {
    // members still holds the pre-removal list here, so we can resolve the target's chip.
    const target = reassignTo ? members.find((m) => m.id === reassignTo) ?? null : null
    setMembers((prev) => prev.filter((m) => m.id !== removedId))
    setTasks((prev) =>
      prev.map((t) =>
        t.status !== 'done' && t.assignee_id === removedId
          ? {
              ...t,
              assignee_id: reassignTo,
              assignee: target ? { id: target.id, name: target.name, color: target.color } : null,
            }
          : t,
      ),
    )
    if (assigneeFilter === removedId) setAssigneeFilter('all')
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
      if (handleAuthError(res)) {
        // revert optimistic change before we navigate away
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: task.status } : t)))
        return
      }
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
    if (showProjectControls && projectFilter !== 'all') {
      list = list.filter((t) =>
        projectFilter === 'none' ? !t.project_id : t.project_id === projectFilter,
      )
    }
    if (showOpportunityControls && opportunityFilter !== 'all') {
      list = list.filter((t) =>
        opportunityFilter === 'none' ? !t.opportunity_id : t.opportunity_id === opportunityFilter,
      )
    }
    if (showInvestorControls && investorFilter !== 'all') {
      list = list.filter((t) =>
        investorFilter === 'none' ? !t.investor_id : t.investor_id === investorFilter,
      )
    }
    if (showObjectiveControls && objectiveFilter !== 'all') {
      list = list.filter((t) =>
        objectiveFilter === 'none' ? !t.objective_id : t.objective_id === objectiveFilter,
      )
    }
    if (blockedOnly) list = list.filter((t) => t.waiting_on_id)
    return [...list].sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }, [tasks, status, assigneeFilter, projectFilter, opportunityFilter, investorFilter, objectiveFilter, blockedOnly, showProjectControls, showOpportunityControls, showInvestorControls, showObjectiveControls])

  // Per-person workload (the old Capacity view, folded in) — open + overdue,
  // plus how many other people's tasks this person is holding up. That last
  // number is the follow-up list: it's what they owe the rest of the team.
  const workload = useMemo(() => {
    if (scoped) return []
    const today = new Date().toISOString().split('T')[0]
    const openTasks = tasks.filter((t) => t.status !== 'done')
    return members.map((m) => {
      const open = openTasks.filter((t) => t.assignee_id === m.id)
      return {
        member: m,
        open: open.length,
        overdue: open.filter((t) => t.due_date && t.due_date < today).length,
        blocking: openTasks.filter((t) => t.waiting_on_id === m.id).length,
      }
    })
  }, [tasks, members, scoped])

  return (
    <div className={cn('space-y-5', !scoped && 'max-w-4xl')}>
      {/* Header */}
      <div className={cn('flex items-center gap-3', embedded ? 'justify-end' : 'justify-between')}>
        {!embedded && (
          <div>
            <h1 className={cn('font-semibold text-foreground', scoped ? 'text-base' : 'text-xl')}>
              {scoped ? 'Tasks' : 'Team Tasks'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {openCount} open{scoped ? '' : ' across the team'}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {!scoped && (
            <button
              onClick={() => setManageOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Add or remove people who can be assigned tasks"
            >
              <Users2 size={14} /> Manage team
            </button>
          )}
          {showWeeklyReport && !scoped && (
            <Link
              href="/reports/weekly/print"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="The week as a printable document — send it to the team"
            >
              <FileText size={14} /> Weekly report
            </Link>
          )}
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all elev-1"
          >
            <Plus size={14} /> New task
          </button>
        </div>
      </div>

      {/* Team workload — tap a person to filter the board to them */}
      {!scoped && workload.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {workload.map(({ member, open, overdue, blocking }) => {
            const active = assigneeFilter === member.id
            return (
              <button
                key={member.id}
                onClick={() => setAssigneeFilter(active ? 'all' : member.id)}
                className={cn(
                  'inline-flex items-center gap-2 h-9 pl-1.5 pr-3 rounded-full border text-sm transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
                title={`${member.name}: ${open} open${overdue ? `, ${overdue} overdue` : ''}${blocking ? ` · holding up ${blocking} task${blocking === 1 ? '' : 's'} for others` : ''}`}
              >
                <span className={cn('flex items-center justify-center size-6 rounded-full text-[10px] font-semibold', avatarClasses(member.color))}>
                  {initials(member.name)}
                </span>
                <span className="font-medium">{member.name}</span>
                <span className="tnum text-xs text-muted-foreground">{open}</span>
                {overdue > 0 && (
                  <span className="tnum text-[11px] font-semibold text-red-600 dark:text-red-400">
                    {overdue} late
                  </span>
                )}
                {blocking > 0 && (
                  <span className="inline-flex items-center gap-0.5 tnum text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    <Hourglass size={10} /> {blocking}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="relative rounded-xl border border-border bg-card p-4 pt-4 space-y-3 elev-2 animate-fade-in-up">
          <button
            onClick={() => setShowAdd(false)}
            className="absolute right-3 top-3 inline-flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTask() } }}
            placeholder="What needs to be done?"
            autoFocus
            className="w-full h-10 rounded-md border border-input bg-background pl-3 pr-9 text-sm font-medium placeholder:text-muted-foreground placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div
            className={cn(
              'grid gap-3 grid-cols-2',
              // assignee + due are always present; add a column for each picker that's shown
              (() => {
                const n =
                  2 +
                  (showProjectControls ? 1 : 0) +
                  (showOpportunityControls ? 1 : 0) +
                  (showInvestorControls ? 1 : 0) +
                  (showObjectiveControls ? 1 : 0)
                return n === 2 ? 'sm:grid-cols-2' : n === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'
              })(),
            )}
          >
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
                <button onClick={handleAddMember} className="shrink-0 inline-flex items-center justify-center size-8 rounded-md bg-primary text-primary-foreground hover:bg-primary/90" aria-label="Save teammate">
                  <Plus size={15} />
                </button>
                <button onClick={() => { setAddingMember(false); setNewMemberName('') }} className="shrink-0 inline-flex items-center justify-center size-8 rounded-md border border-input hover:bg-muted" aria-label="Cancel">
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

            {showProjectControls && (
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

            {showOpportunityControls && (
              <select
                value={opportunityId}
                onChange={(e) => setOpportunityId(e.target.value)}
                className={fieldClass}
              >
                <option value="">No opportunity</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}

            {showInvestorControls && (
              <select
                value={investorId}
                onChange={(e) => setInvestorId(e.target.value)}
                className={fieldClass}
              >
                <option value="">No investor</option>
                {investors.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}

            {showObjectiveControls && (
              <select
                value={objectiveId}
                onChange={(e) => setObjectiveId(e.target.value)}
                className={fieldClass}
              >
                <option value="">No objective</option>
                {objectives.map((o) => (
                  <option key={o.id} value={o.id}>{o.title}</option>
                ))}
              </select>
            )}

            <DatePicker value={dueDate} onChange={setDueDate} placeholder="Due date" />
          </div>
          <button
            onClick={handleAddTask}
            disabled={!title.trim() || adding}
            className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors active:scale-[0.99]"
          >
            {adding && <Loader2 size={14} className="animate-spin" />}
            Save task
          </button>
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

        {blockedCount > 0 && (
          <button
            onClick={() => setBlockedOnly((b) => !b)}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-xs font-medium transition-colors',
              blockedOnly
                ? 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/40 dark:text-amber-200'
                : 'border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title="Tasks waiting on someone"
          >
            <Hourglass size={12} /> Blocked <span className="tnum">{blockedCount}</span>
          </button>
        )}

        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={filterFieldClass}>
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>

        {showProjectControls && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={filterFieldClass}>
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">No project</option>
          </select>
        )}

        {showOpportunityControls && (
          <select value={opportunityFilter} onChange={(e) => setOpportunityFilter(e.target.value)} className={filterFieldClass}>
            <option value="all">All opportunities</option>
            {opportunities.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="none">No opportunity</option>
          </select>
        )}

        {showInvestorControls && (
          <select value={investorFilter} onChange={(e) => setInvestorFilter(e.target.value)} className={filterFieldClass}>
            <option value="all">All investors</option>
            {investors.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            <option value="none">No investor</option>
          </select>
        )}

        {showObjectiveControls && (
          <select value={objectiveFilter} onChange={(e) => setObjectiveFilter(e.target.value)} className={filterFieldClass}>
            <option value="all">All objectives</option>
            {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
            <option value="none">No objective</option>
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
        <div className="space-y-2">
          {filtered.map((task) => {
            const due = task.due_date ? getDueLabel(task.due_date) : null
            const done = task.status === 'done'
            return (
              <div
                key={task.id}
                onClick={() => setOpenTaskId(task.id)}
                className={cn(
                  'group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 cursor-pointer lift',
                  due?.overdue && !done && 'border-l-[3px] border-l-red-400 dark:border-l-red-500/70',
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
                    {!scopedToProject && task.project && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <FolderKanban size={11} /> {task.project.name}
                      </span>
                    )}
                    {!scopedToOpportunity && oppName(task.opportunity_id) && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lightbulb size={11} /> {oppName(task.opportunity_id)}
                      </span>
                    )}
                    {!scopedToInvestor && investorName(task.investor_id) && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <HandCoins size={11} /> {investorName(task.investor_id)}
                      </span>
                    )}
                    {objectiveTitle(task.objective_id) && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Target size={11} /> {objectiveTitle(task.objective_id)}
                      </span>
                    )}
                    {due && (
                      <span className={cn('text-xs font-medium tnum',
                        due.overdue ? 'text-red-500 dark:text-red-400' : due.urgent ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                        {due.label}
                      </span>
                    )}
                    {task.waiting_on_id && !done && (() => {
                      const age = waitingAge(task.waiting_on_since)
                      return (
                        <span
                          title={task.waiting_on_what ?? undefined}
                          className={cn(
                            'inline-flex items-center gap-1 text-xs font-medium rounded-full px-1.5 py-0.5',
                            age.stale
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          <Hourglass size={10} />
                          {memberName(task.waiting_on_id) ?? 'Someone'}
                          {age.label && <span className="tnum opacity-70">· {age.label}</span>}
                        </span>
                      )
                    })()}
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

      {!scoped && (
        <ManageTeamDialog
          open={manageOpen}
          onOpenChange={setManageOpen}
          members={members}
          tasks={tasks}
          onAdded={addMemberToState}
          onRemoved={handleMemberRemoved}
        />
      )}

      <TaskDetailSheet
        taskId={openTaskId}
        teamMembers={members}
        projects={projects}
        opportunities={opportunities}
        investors={investors}
        objectives={objectives}
        lockProject={scopedToProject}
        onClose={() => setOpenTaskId(null)}
        onUpdated={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))}
        onDeleted={(id) => setTasks((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  )
}
