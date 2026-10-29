'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUrlState } from '@/hooks/use-url-state'
import {
  DUE_FILTERS,
  DUE_FILTER_LABELS,
  dueWindowFrom,
  matchesDue,
  type DueFilter,
} from '@/lib/tasks/due-filter'
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
  Users2,
  SlidersHorizontal,
  Table2,
  Trash2,
} from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import { PageHeader, HeaderMetrics } from '@/components/ui/page-header'
import { DatePicker } from '@/components/ui/date-picker'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import TaskDetailSheet from './TaskDetailSheet'
import ManageTeamDialog from './ManageTeamDialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  useBoardDnd,
  BoardLiveRegion,
  DragHandle,
  BoardHint,
  type Lane,
} from '@/components/ui/board'
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
  handleAuthError,
} from './task-utils'
import {
  taskTier,
  tierRank,
  TIER_BORDER,
  TIER_CHIP,
  TIER_LABELS,
  LIVE_CORRESPONDENCE_DAYS,
} from '@/lib/tasks/priority'

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
  /**
   * The Google Sheet this board is published to, or null when the sync has
   * never run. A link, not a copy: the sheet IS this board, rebuilt whole every
   * 15 minutes by `/api/cron/task-sheet`, and its Done checkbox settles the
   * task here. Null renders no button at all rather than a dead one — §12: a
   * control that cannot work is worse than an absent one.
   */
  sheetUrl?: string | null
  /** Open this task's detail sheet on mount (deep link from search: /tasks?task=<id>). */
  initialOpenTaskId?: string | null
  /** Open the add form on mount — a record's header Log menu arriving at `?new=1`. */
  startAdd?: boolean
  /**
   * Records and commitments whose conversations have moved inside
   * LIVE_CORRESPONDENCE_DAYS. Arrays rather than Sets because this crosses the
   * server/client boundary, where a Set does not survive serialization.
   */
  liveRecordIds?: string[]
  liveCommitmentIds?: string[]
  /** Why the ranking is unavailable, when it is. Named, never silently empty. */
  liveError?: string | null
}

/** ⚠ The array is the source: `useUrlState` validates against it, because a
 *  query string is user input that reaches a database filter. */
const STATUS_FILTERS = ['open', 'done'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]


const fieldClass =
  'h-8 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

// A `<select>` sizes itself to its WIDEST option, so a project list holding
// "DUBHES Helper / Giovanni Resilience Campus" stretched the control to half
// the row and the four filters wrapped onto three lines of ragged widths.
// Bound them and let the native control truncate its own label.
const filterFieldClass =
  'h-[2.75rem] sm:h-8 w-[10.5rem] sm:w-[9.5rem] max-w-full rounded-md border border-input bg-background px-2 text-sm sm:text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

// 44px on touch (Apple HIG / WCAG 2.5.5 target size), the tighter 32px on
// pointer devices. `whitespace-nowrap` keeps a two-word label off two lines.
const headerButtonClass =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[2.75rem] sm:h-9 px-3.5 rounded-lg border border-border bg-card text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'

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
  sheetUrl = null,
  initialOpenTaskId = null,
  startAdd = false,
  liveRecordIds = [],
  liveCommitmentIds = [],
  liveError = null,
}: TeamTaskBoardProps) {
  // Rebuilt only when the arrays change identity, which is once per server
  // render. Building a Set inside the render body on every keystroke of the
  // search filter would destabilise the memo below for no reason.
  const live = useMemo(
    () => ({
      liveRecordIds: new Set(liveRecordIds),
      liveCommitmentIds: new Set(liveCommitmentIds),
    }),
    [liveRecordIds, liveCommitmentIds],
  )
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
  const router = useRouter()
  const [tasks, setTasks] = useState<BoardTask[]>(initialTasks)
  const [members, setMembers] = useState<TeamMember[]>(teamMembers)

  /*
   * Filters, in the URL. ⚠ All six were `useState`, so a filtered board was
   * not a link — "Eric's overdue Weirton tasks" could not be sent to the other
   * executive, could not be bookmarked, and was wiped by a refresh. §12: a
   * filter kept only in component state is not a view.
   *
   * The default is absent from the URL rather than written into it, so a bare
   * /tasks is the default board and a shared link carries only what differs.
   */
  const [status, setStatus] = useUrlState<StatusFilter>('status', 'open', STATUS_FILTERS)
  const [assigneeFilter, setAssigneeFilter] = useUrlState<string>('assignee', 'all')
  const [projectFilter, setProjectFilter] = useUrlState<string>('project', 'all')
  const [opportunityFilter, setOpportunityFilter] = useUrlState<string>('opportunity', 'all')
  const [investorFilter, setInvestorFilter] = useUrlState<string>('investor', 'all')
  const [objectiveFilter, setObjectiveFilter] = useUrlState<string>('objective', 'all')
  const [dueFilter, setDueFilter] = useUrlState<DueFilter>('due', 'all', DUE_FILTERS)
  /*
    The clock the due filter reads, captured ONCE at mount.

    ⚠ NOT READ DURING RENDER. A `new Date()` inside the `filtered` memo makes
    the React Compiler give up preserving it ("existing memoization could not be
    preserved") and `Date.now()` trips `react-hooks/purity` outright — both are
    lint ERRORS, and §9's baseline is deliberately frozen at 22 problems, so
    adding one is a regression that makes the frozen number meaningless.
    `/decide` captures its clock the same way and for the same reason.

    The cost is that a board left open past midnight slices against yesterday
    until it is reloaded. That is the accepted trade everywhere else in this
    app, and the list re-sorts on the same stale `today` already.
  */
  const [dueWindow] = useState(() => dueWindowFrom(new Date()))
  // Record filters are collapsed on phones; `sm:flex` re-reveals them regardless.
  const [filtersOpen, setFiltersOpen] = useState(false)

  // detail sheet
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialOpenTaskId)
  /** The row awaiting a delete confirmation, if any. */
  const [pendingDelete, setPendingDelete] = useState<BoardTask | null>(null)

  // add form
  const [showAdd, setShowAdd] = useState(startAdd)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState(scopeProjectId ?? '')
  const [opportunityId, setOpportunityId] = useState(scopeOpportunityId ?? '')
  const [investorId, setInvestorId] = useState(scopeInvestorId ?? '')
  const [objectiveId, setObjectiveId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [adding, setAdding] = useState(false)
  // Optional why/what/how, collapsed by default so fast entry stays fast.
  const [showDetails, setShowDetails] = useState(false)
  const [why, setWhy] = useState('')
  const [what, setWhat] = useState('')
  const [how, setHow] = useState('')

  // quick-add teammate
  const [addingMember, setAddingMember] = useState(false)
  const [newMemberName, setNewMemberName] = useState('')
  // manage-team dialog (add / remove people)
  const [manageOpen, setManageOpen] = useState(false)

  /*
    ── Bulk editing ──────────────────────────────────────────────────────────

    ⚠ WHY A BOARD OF 41 NEEDED THIS. 37 of those carry no due date and 13 no
    owner, and every one of the three fixes — date it, own it, close it — cost
    opening the detail sheet, changing one field and closing it again. At that
    price a backlog is never drained; it is scrolled past. The /decide queue hit
    the same wall and the same measurement (5 intake sessions confirmed ever
    against 136 decided), and its answer is the one copied here.

    ⚠ EVERY BULK ACTION LOOPS THE EXISTING `PATCH /api/tasks/[id]`, DELIBERATELY.
    A bulk route would have to re-implement `guardTask`, the non-executive
    retag check, `settleCommitmentForTask` (ticking a promoted task settles its
    obligation) and `queueTaskSheetRefresh` — §12: never fork a shared pass. One
    request per row is the cost of not owning a second copy of all four, and the
    rows here number tens, not thousands.
  */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** Progress through a running batch; null when none is. */
  const [bulk, setBulk] = useState<{ total: number; done: number; failed: number } | null>(null)
  /** Which bulk field is being chosen, so one bar can carry three actions. */
  const [bulkMode, setBulkMode] = useState<'assign' | 'date' | null>(null)

  const hasRecordFilters =
    showProjectControls || showOpportunityControls || showInvestorControls || showObjectiveControls
  const activeRecordFilters = [
    showProjectControls && projectFilter !== 'all',
    showOpportunityControls && opportunityFilter !== 'all',
    showInvestorControls && investorFilter !== 'all',
    showObjectiveControls && objectiveFilter !== 'all',
  ].filter(Boolean).length

  const openCount = tasks.filter((t) => t.status !== 'done').length
  // The same "past its date" test the per-person chips use, totalled — so the
  // masthead and the chips below it can never disagree about what is late.
  const overdueCount = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return tasks.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today).length
  }, [tasks])

  async function handleAddTask() {
    if (!title.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          why: why.trim() || undefined,
          what: what.trim() || undefined,
          how: how.trim() || undefined,
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
      setWhy('')
      setWhat('')
      setHow('')
      setShowDetails(false)
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

  /**
   * Write a task's status, optimistically. Split out of the click handler so the
   * Undo action on the completion toast can run the exact same path in reverse.
   */
  async function setTaskStatus(task: BoardTask, next: 'open' | 'done'): Promise<boolean> {
    const previous = task.status
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: next } : t)))
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (handleAuthError(res)) {
        // revert optimistic change before we navigate away
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: previous } : t)))
        return false
      }
      if (!res.ok) throw new Error()
      return true
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: previous } : t)))
      toast.error('Failed to update')
      return false
    }
  }

  /**
   * Delete a task from the row, rather than from inside the detail sheet.
   *
   * ⚠ COMPLETING AND DELETING ARE DIFFERENT CLAIMS AND ONLY ONE OF THEM WAS
   * REACHABLE HERE. Richard, 10-20: *"I suppose i can just mark complete but if
   * we are tracking the activity, I don't want to mark complete a task that
   * really just needs to be deleted."* He is right that it matters: ticking the
   * circle stamps `completed_at`, writes a `done` row into `activity_log`, and
   * — where the task came from a commitment — calls `settleCommitmentForTask`,
   * which settles the obligation on the counterparty's thread as though the
   * work had happened. A task that should never have existed must not leave
   * that trail. Delete was already built; it was three interactions away,
   * behind opening the sheet and scrolling to the bottom.
   *
   * ⚠ CONFIRMED, UNLIKE COMPLETE, AND THE ASYMMETRY IS DELIBERATE. Completing
   * is one tap with an Undo toast because the row survives it. This destroys
   * the task and its notes; the only way back is `to_jsonb(old)` in
   * `activity_log` (§4), which is not a button. So the dialog NAMES the task
   * before it goes, and no Undo is offered that could not honour itself — §12:
   * a destination that does not carry what the act carries reads as losing the
   * work, and a promised undo that cannot restore the same row is worse.
   */
  async function deleteTask(task: BoardTask) {
    const previous = tasks
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      if (handleAuthError(res)) {
        setTasks(previous)
        return
      }
      if (!res.ok) throw new Error()
      toast.success('Task deleted')
    } catch {
      setTasks(previous)
      toast.error('Failed to delete')
    }
  }

  /**
   * Apply one patch to every selected task.
   *
   * ⚠ OPTIMISTIC, THEN RECONCILED FROM THE RESPONSE. The row is updated from
   * what the server actually returned rather than from what was sent, because
   * `status` is not the only thing a PATCH changes — setting it to `done`
   * stamps `completed_at` server-side, and a row that disagreed with the
   * database about that would re-sort itself on the next render.
   *
   * ⚠ AND THE FAILURES ARE NAMED, NOT COUNTED AWAY. A batch that silently
   * half-applied is worse than one that refused: §12, a refusal reported as an
   * absence is how the caller carries on as though the work was done.
   */
  async function applyToSelected(
    patch: Record<string, unknown>,
    describe: (n: number) => string
  ) {
    const ids = visible.filter((t) => selected.has(t.id)).map((t) => t.id)
    if (ids.length === 0) return
    setBulk({ total: ids.length, done: 0, failed: 0 })
    let done = 0
    let failed = 0

    for (const id of ids) {
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (handleAuthError(res)) {
          setBulk(null)
          return
        }
        if (!res.ok) throw new Error()
        const { task: updated } = (await res.json()) as { task: BoardTask }
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)))
        done++
      } catch {
        failed++
      }
      setBulk({ total: ids.length, done, failed })
    }

    setBulk(null)
    setSelected(new Set())
    setBulkMode(null)
    if (failed > 0) toast.error(`${describe(done)} — ${failed} failed`)
    else toast.success(describe(done))

    /*
      ⚠ ONE REFRESH, ON THE TRAILING EDGE. §12: an optimistic client mutation
      with no `router.refresh()` leaves every server-rendered count lying until
      the tab is reloaded — the sidebar badge read 248 against a database saying
      1. Once after the batch, never once per row.
    */
    router.refresh()
  }

  async function handleComplete(task: BoardTask, e: React.MouseEvent) {
    e.stopPropagation()
    const next = task.status === 'done' ? 'open' : 'done'
    const ok = await setTaskStatus(task, next)
    if (!ok || next !== 'done') return
    // Completing pulls the row out of the list and everything below jumps up, so
    // a mis-tap on a phone is easy and its consequence is invisible. Undo makes
    // that a one-tap recovery instead of a trip through Archive.
    toast.success('Completed — moved to archive', {
      action: {
        label: 'Undo',
        onClick: () => { void setTaskStatus({ ...task, status: 'done' }, 'open') },
      },
    })
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
    /**
     * TIER FIRST, THEN THE DATE.
     *
     * ⚠ WHY THE DATE CANNOT LEAD. Sorting strictly by due date is what made
     * this board unreadable: every unsolicited RFP carries a hard bid deadline
     * and most real work does not, so the top of the list was always whichever
     * stranger's solicitation closed soonest while "Review JV Brief and
     * Counteroffer" sat at the bottom for having no date at all. Measured
     * 2026-10-12: 11 of 22 open rows were bid deadlines and the live deals had
     * none. Those rows are gone now, and this is the ordering that stops the
     * shape coming back.
     *
     * Overdue is lifted out of its tier, because being late is a different and
     * more urgent fact than being important — a missed commitment on a quiet
     * project still needs answering today.
     */
    const today = new Date().toISOString().slice(0, 10)
    const rank = (t: BoardTask): number => {
      if (t.status !== 'done' && t.due_date && t.due_date < today) return -1
      return tierRank(taskTier(t, live))
    }
    return [...list].sort((a, b) => {
      const byRank = rank(a) - rank(b)
      if (byRank !== 0) return byRank
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return (b.created_at ?? '').localeCompare(a.created_at ?? '')
    })
  }, [tasks, status, assigneeFilter, projectFilter, opportunityFilter, investorFilter, objectiveFilter, showProjectControls, showOpportunityControls, showInvestorControls, showObjectiveControls, live])

  /**
   * The due-date slice, taken over `filtered` and NOT inside it.
   *
   * ⚠ A MEASURED CONSTRAINT, NOT A PREFERENCE, AND IT COST THREE ATTEMPTS.
   * Adding one more conditional branch INSIDE the `filtered` memo makes the
   * React Compiler abandon that memo entirely ("existing memoization could not
   * be preserved") — in every form tried: inline, as a lifted module-scope
   * predicate, and with the clock hoisted out. Moving it to its own `useMemo`
   * simply moved the same error onto the new one. So it is a plain derived
   * value with no hand-memoization for the compiler to fail to preserve, which
   * is what the compiler wants anyway. Both halves matter: the error is a lint
   * ERROR against the baseline §9 deliberately freezes at 22, and §12 says an
   * exemption gets named with its reason rather than absorbed by raising it.
   *
   * Filtering afterwards is free — `filter` preserves relative order, so the
   * tier-then-date sort `filtered` ends on still holds — and the list is tens
   * of rows, not thousands.
   *
   * Everything downstream reads THIS, not `filtered`: the bulk bar's count,
   * "select all shown", the drag list and the empty state. Two names for two
   * populations would be §12's one-quantity-two-definitions on one screen.
   */
  const visible = filtered.filter((t) => matchesDue(t.due_date, dueFilter, dueWindow))

  // Per-person workload (the old Capacity view, folded in) — open + overdue.
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
      }
    })
  }, [tasks, members, scoped])

  // ─── Drag a task onto a person to reassign it ──────────────────────────────
  /*
    ⚠ THE LANES ARE NOT COLUMNS, AND THAT IS THE POINT OF A SHARED PRIMITIVE.
    This board is a flat list with a row of per-person workload chips above it,
    so the useful drag here is not "move between columns" — it is REASSIGNMENT,
    and the chips are already exactly the right drop targets, counts and all.
    The same hook that drives the two stage boards drives this without knowing
    that a lane happens to be a teammate.

    `unassigned` is a real lane rather than an absence: §12 notes that a dated
    task NOBODY owns was invisible to every per-person surface there was, so
    handing work BACK to the unassigned pile has to be as easy as taking it.
  */
  const UNASSIGNED = 'unassigned'
  const taskLanes: Lane[] = useMemo(
    () => [
      ...members.map((m) => ({ id: m.id, label: m.name })),
      { id: UNASSIGNED, label: 'Unassigned' },
    ],
    [members]
  )

  const dnd = useBoardDnd<BoardTask>({
    lanes: taskLanes,
    items: visible,
    laneOf: (t) => t.assignee_id ?? UNASSIGNED,
    setLane: (t, laneId) => {
      const m = members.find((x) => x.id === laneId)
      return {
        ...t,
        assignee_id: laneId === UNASSIGNED ? null : laneId,
        assignee: m ? { id: m.id, name: m.name, color: m.color } : null,
      }
    },
    titleOf: (t) => t.title,
    /*
      ⚠ `tasks` carries no order column (verified against database.ts), so a
      within-person reorder could not persist. The hook refuses the vertical
      gesture rather than animating a lie — and this list is sorted by urgency
      anyway, which is a better order than a hand-dragged one.
    */
    reorderable: false,
    onMove: async (move) => {
      const nextAssignee = move.toLaneId === UNASSIGNED ? null : move.toLaneId
      const member = members.find((x) => x.id === nextAssignee)
      const previous = tasks.find((t) => t.id === move.itemId)?.assignee_id ?? null
      const prevMember = members.find((x) => x.id === previous)

      // Optimistic against this component's own `tasks`, which is what every
      // count, the workload row and the filters all read.
      setTasks((prev) =>
        prev.map((t) =>
          t.id === move.itemId
            ? {
                ...t,
                assignee_id: nextAssignee,
                assignee: member ? { id: member.id, name: member.name, color: member.color } : null,
              }
            : t
        )
      )

      const res = await fetch(`/api/tasks/${move.itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee_id: nextAssignee }),
      })
      if (!res.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t.id === move.itemId
              ? {
                  ...t,
                  assignee_id: previous,
                  assignee: prevMember
                    ? { id: prevMember.id, name: prevMember.name, color: prevMember.color }
                    : null,
                }
              : t
          )
        )
        // A 401 is a redirect to login, not a failed reassignment — saying
        // "could not reassign" over the top of it is a second, wrong story.
        if (!handleAuthError(res)) {
          const { error } = await res.json().catch(() => ({ error: null }))
          toast.error(error ?? 'Could not reassign that task')
        }
        throw new Error('reassign failed')
      }
      toast.success(member ? `Reassigned to ${member.name}` : 'Returned to unassigned')
    },
  })

  const heldTask = dnd.heldId ? visible.find((t) => t.id === dnd.heldId) : undefined

  /*
    One set of action buttons, named once. They used to live inside the header
    row, which meant the masthead could not have them without duplicating the
    markup — and a duplicated button row is how two headers start disagreeing.
  */
  const headerActions = (
    <>

          {!scoped && (
            <button
              onClick={() => setManageOpen(true)}
              className={headerButtonClass}
              title="Add or remove people who can be assigned tasks"
            >
              <Users2 size={14} />
              <span className="sm:hidden">Team</span>
              <span className="hidden sm:inline">Manage team</span>
            </button>
          )}
          {sheetUrl && !scoped && (
            /* Opens in Google, not in the app — a real external destination, so
               it is an <a> with target/rel rather than next/link. */
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={headerButtonClass}
              title="The same board as a Google Sheet — My Drive / Ber Intelligence / Task Board / Ber Wilson Tasks. Tick Done there and it settles here."
            >
              <Table2 size={14} />
              <span className="sm:hidden">Sheet</span>
              <span className="hidden sm:inline">Open in Sheets</span>
            </a>
          )}
          {showWeeklyReport && !scoped && (
            <Link
              href="/reports/weekly/print"
              className={headerButtonClass}
              title="The week as a printable document — send it to the team"
            >
              <FileText size={14} />
              <span className="sm:hidden">Report</span>
              <span className="hidden sm:inline">Weekly report</span>
            </Link>
          )}
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[2.75rem] sm:h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all elev-1"
          >
            <Plus size={14} /> New task
          </button>
    </>
  )

  return (
    /* No max-width when this IS the page. A list whose rows truncate must not
       also reserve empty space: the cap left ~400px unused at 1440 while every
       task's `why` line was being clipped mid-sentence. Scoped/embedded boards
       still sit inside someone else's column and keep their own bounds. */
    <div className={cn('space-y-5', !scoped && !embedded && 'max-w-6xl')}>
      {/*
        ⚠ THIS IS THE APP'S LANDING SCREEN — `/` redirects to `/tasks` — AND IT
        WAS THE ONLY ONE WITH NO MASTHEAD AT ALL. It opened on "45 open across
        the team" in 14px grey while every list page opens on a 28px title, so
        the first thing anyone sees was the least-dressed thing in the app.

        The reason it had none was sound as far as it went: `AppHeader` already
        prints "Team Tasks" from nav.ts, and the two said the same words a line
        apart. But that is true of every other page too, and all of them carry
        both — the 14px locator and the masthead do different jobs. So the page
        gets the masthead, and the duplication argument is settled the way the
        other dozen pages settled it.
      */}
      {!embedded && (
        <PageHeader
          title="Tasks"
          icon={ListChecks}
          className="mb-0"
          metrics={
            <HeaderMetrics
              items={[
                { label: scoped ? 'open' : 'open across the team', value: openCount },
                ...(overdueCount > 0
                  ? [{ label: 'past their date', value: overdueCount, tone: 'critical' as const }]
                  : []),
              ]}
            />
          }
          actions={headerActions}
        />
      )}
      {embedded && <div className="flex flex-wrap items-center justify-end gap-2">{headerActions}</div>}

      {/* Team workload — tap a person to filter the board to them */}
      {!scoped && workload.length > 0 && (
        // Wrapping seven chips costs three rows on a phone and pushes the list
        // itself below the fold — scroll them sideways instead, and only wrap
        // once there's room for it.
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0 sm:overflow-visible sm:flex-wrap">
          {workload.map(({ member, open, overdue }) => {
            const active = assigneeFilter === member.id
            // While a task is held, this chip stops being a filter and becomes
            // a destination. Both at once would mean one tap did two things.
            const target = dnd.isDropTarget(member.id) || (dnd.keyboard && heldTask?.assignee_id !== member.id)
            return (
              <button
                key={member.id}
                {...dnd.laneProps(member.id)}
                onClick={() => {
                  if (dnd.keyboard) return
                  setAssigneeFilter(active ? 'all' : member.id)
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 h-[2.75rem] sm:h-9 pl-1.5 pr-3 rounded-full border text-sm transition-colors',
                  active
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
                  // ⚠ A RING, NOT A BACKGROUND. The active state above already
                  // owns `bg-primary/10`; `cn()` is tailwind-merge, so a `bg-*`
                  // here would delete it and the selected teammate would lose
                  // their highlight exactly while you dragged onto them (§12).
                  target && 'ring-2 ring-primary',
                  dnd.isDropTarget(member.id) && 'ring-offset-2 ring-offset-background',
                )}
                title={
                  dnd.keyboard
                    ? `Move "${heldTask?.title ?? 'this task'}" to ${member.name}`
                    : `${member.name}: ${open} open${overdue ? `, ${overdue} overdue` : ''}`
                }
              >
                <span className={cn('flex items-center justify-center size-6 rounded-full text-[10px] font-semibold', avatarClasses(member.color))}>
                  {initials(member.name)}
                </span>
                <span className="font-medium">{member.name}</span>
                <span className="tnum text-xs text-muted-foreground">{open}</span>
                {overdue > 0 && (
                  <span className="tnum text-[11px] font-semibold text-critical">
                    {overdue} late
                  </span>
                )}
              </button>
            )
          })}

          {/*
            Unassigned as a real chip, and only while a task is held.

            ⚠ IT IS NOT A FILTER CHIP, SO IT DOES NOT BELONG HERE AT REST — the
            row reads "tap a person to filter the board to them" and an
            Unassigned chip would be a fourth kind of thing in it. But §12
            records that four of ten dated tasks, three already overdue, were
            invisible to every per-person surface there was, precisely because
            nobody owned them. Handing work back has to be as easy as taking
            it, so the destination appears exactly when it is one.
          */}
          {dnd.keyboard && (
            <button
              {...dnd.laneProps(UNASSIGNED)}
              type="button"
              title={`Return "${heldTask?.title ?? 'this task'}" to unassigned`}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 h-[2.75rem] sm:h-9 px-3 rounded-full border border-dashed text-sm transition-colors',
                'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent',
                heldTask?.assignee_id != null && 'ring-2 ring-primary',
              )}
            >
              <span className="font-medium">Unassigned</span>
            </button>
          )}
        </div>
      )}

      {/* ─── Reassignment drag affordances ──────────────────────────────────── */}
      {!scoped && (
        <>
          <BoardLiveRegion dnd={dnd} />
          {/*
            The exit. Escape works only while the handle still holds focus, so
            a thumb that tapped to grab would otherwise have no way to put the
            task down.
          */}
          {dnd.keyboard && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="text-xs text-foreground">
                Holding <strong className="font-semibold">{heldTask?.title ?? 'a task'}</strong> — choose
                who it goes to.
              </span>
              <button
                type="button"
                onClick={() => dnd.cancelHold()}
                className="ml-auto h-[2.75rem] md:h-7 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Cancel
              </button>
            </div>
          )}
          {workload.length > 0 && <BoardHint dnd={dnd} noun="task" className="-mt-1" />}
        </>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="relative rounded-lg border border-border bg-card p-4 pt-4 space-y-3 elev-2 animate-fade-in-up">
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
            className="w-full h-10 rounded-md border border-input bg-background pl-3 pr-9 text-sm font-medium placeholder:text-muted-foreground placeholder:font-normal outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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

          {/* Optional details — why/what/how, collapsed by default */}
          {showDetails ? (
            <div className="space-y-2">
              {([
                ['Why', why, setWhy, 'Why does it matter?'],
                ['What', what, setWhat, 'What needs to be done?'],
                ['How', how, setHow, 'How should we approach it?'],
              ] as const).map(([label, val, setter, placeholder]) => (
                <div key={label} className="space-y-1">
                  <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
                  <textarea
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={placeholder}
                    rows={2}
                    className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 placeholder:text-muted-foreground"
                  />
                </div>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              + Add details (why / what / how)
            </button>
          )}

          <button
            onClick={handleAddTask}
            disabled={!title.trim() || adding}
            className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-lg bg-primary elev-1 text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors active:scale-[0.99]"
          >
            {adding && <Loader2 size={14} className="animate-spin" />}
            Save task
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          <button
            onClick={() => setStatus('open')}
            className={cn('px-3 h-[2.75rem] sm:h-auto sm:py-1.5 inline-flex items-center gap-1.5 transition-colors',
              status === 'open' ? 'bg-card text-foreground font-medium' : 'bg-muted/40 text-muted-foreground hover:text-foreground')}
          >
            <ListChecks size={14} /> Open
          </button>
          <button
            onClick={() => setStatus('done')}
            className={cn('px-3 h-[2.75rem] sm:h-auto sm:py-1.5 inline-flex items-center gap-1.5 transition-colors border-l border-border',
              status === 'done' ? 'bg-card text-foreground font-medium' : 'bg-muted/40 text-muted-foreground hover:text-foreground')}
          >
            <Archive size={14} /> Archive
          </button>
        </div>

        {/*
          The due-date slice. Sits beside the assignee filter rather than behind
          the phone "Filters" button with the record pickers, because it is the
          one filter that answers "what have I let slide" — see DUE_FILTERS.
        */}
        <select
          value={dueFilter}
          onChange={(e) => setDueFilter(e.target.value as DueFilter)}
          aria-label="Filter by due date"
          className={filterFieldClass}
        >
          {DUE_FILTERS.map((f) => (
            <option key={f} value={f}>{DUE_FILTER_LABELS[f]}</option>
          ))}
        </select>

        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={filterFieldClass}>
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          <option value="unassigned">Unassigned</option>
        </select>

        {hasRecordFilters && (
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className={cn(
              'sm:hidden inline-flex items-center gap-1.5 h-[2.75rem] px-3 rounded-md border text-sm font-medium transition-colors',
              activeRecordFilters > 0
                ? 'border-primary/50 bg-primary/10 text-foreground'
                : 'border-input bg-background text-muted-foreground',
            )}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal size={14} /> Filters
            {activeRecordFilters > 0 && (
              <span className="tnum inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
                {activeRecordFilters}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Record filters — four stacked selects eat a phone screen, so they live
          behind the Filters button below `sm` and sit inline from there up. */}
      <div className={cn('flex-wrap items-center gap-2', filtersOpen ? 'flex' : 'hidden sm:flex')}>
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
      </div>

      {/* List */}
      {/* §12: withholding from a reader means telling them. A failed read here
          would otherwise show a board on which nothing is live, which is a
          claim about the business rather than about the query. */}
      {liveError && (
        <p className="text-xs text-caution">
          Ranking unavailable — could not read which conversations are active ({liveError}). Rows
          are ordered by date only.
        </p>
      )}

      {/*
        The bulk bar.

        Present whenever there is anything to select, not once selecting has
        begun — §12: a control that only appears after you have started is one
        nobody discovers, and the point is to offer the shortcut BEFORE the
        reader resigns themselves to opening fifty sheets. Sticky, for the same
        reason /decide's is: the reader ticks on the way down the list.
      */}
      {status !== 'done' && visible.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-4 py-2.5 elev-1">
          {bulk ? (
            <>
              <Loader2 size={14} className="animate-spin text-primary shrink-0" />
              <span className="text-sm tnum">
                Updating {bulk.done + bulk.failed + 1} of {bulk.total}
                {bulk.failed > 0 && <span className="text-critical"> · {bulk.failed} failed</span>}
              </span>
            </>
          ) : selected.size === 0 ? (
            <>
              <span className="text-sm text-muted-foreground">
                <span className="tnum font-medium text-foreground">{visible.length}</span> shown
                {dueFilter !== 'all' && ` · ${DUE_FILTER_LABELS[dueFilter].toLowerCase()}`}
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set(visible.map((t) => t.id)))}
                className="ml-auto h-[2.75rem] sm:h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Select all shown
              </button>
            </>
          ) : (
            <>
              <span className="text-sm">
                <span className="tnum font-medium">{selected.size}</span> selected
              </span>

              {bulkMode === 'assign' ? (
                <select
                  autoFocus
                  defaultValue=""
                  aria-label="Assign the selected tasks to"
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    void applyToSelected(
                      { assignee_id: v === UNASSIGNED ? null : v },
                      (n) => `${n} task${n === 1 ? '' : 's'} reassigned`
                    )
                  }}
                  className={filterFieldClass}
                >
                  <option value="" disabled>Assign to…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  <option value={UNASSIGNED}>Nobody</option>
                </select>
              ) : bulkMode === 'date' ? (
                <>
                  <DatePicker
                    value=""
                    onChange={(v) =>
                      void applyToSelected(
                        { due_date: v || null },
                        (n) => `${n} task${n === 1 ? '' : 's'} dated`
                      )
                    }
                    placeholder="Due date for the selected…"
                  />
                  {/* Clearing a date is a real answer, and the picker cannot
                      express it: a task that turned out not to have a deadline
                      should lose the one somebody guessed. */}
                  <button
                    type="button"
                    onClick={() =>
                      void applyToSelected(
                        { due_date: null },
                        (n) => `${n} due date${n === 1 ? '' : 's'} cleared`
                      )
                    }
                    className="h-[2.75rem] sm:h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Clear date
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setBulkMode('date')}
                    className="h-[2.75rem] sm:h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Set due date
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkMode('assign')}
                    className="h-[2.75rem] sm:h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Assign
                  </button>
                  {/*
                    ⚠ COMPLETE, NEVER DELETE. The single-row control pair is
                    deliberate — ticking stamps `completed_at`, writes to
                    `activity_log` and SETTLES a promoted commitment on the
                    counterparty's thread, while deleting destroys the row and
                    its notes with only `to_jsonb(old)` to recover it. One of
                    those is safe to do fifty at a time and one is not, so only
                    one is here.
                  */}
                  <button
                    type="button"
                    onClick={() =>
                      void applyToSelected(
                        { status: 'done' },
                        (n) => `${n} task${n === 1 ? '' : 's'} completed`
                      )
                    }
                    className="h-[2.75rem] sm:h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    Mark done
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => { setSelected(new Set()); setBulkMode(null) }}
                className="ml-auto h-[2.75rem] sm:h-8 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {bulkMode ? 'Back' : 'Clear'}
              </button>
            </>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={status === 'done' ? Archive : ListChecks}
          title={status === 'done' ? 'Nothing archived yet' : 'No open tasks'}
          description={status === 'done' ? 'Completed tasks land here for reference.' : 'Add a task to get the team moving.'}
        />
      ) : (
        <div className="space-y-2">
          {dnd.preview.map((task, taskIndex) => {
            const due = task.due_date ? getDueLabel(task.due_date) : null
            const done = task.status === 'done'
            const tier = taskTier(task, live)
            const laneId = task.assignee_id ?? UNASSIGNED
            const held = dnd.draggingId === task.id
            return (
              <div
                key={task.id}
                {...dnd.cardProps(task.id, laneId, taskIndex)}
                onClick={() => setOpenTaskId(task.id)}
                className={cn(
                  'group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 cursor-pointer lift',
                  /*
                    ⚠ A RING, AND IT HAS TO BE. This row already sets `bg-card`
                    and the urgency tint sets `border-l-*`; a held style in
                    either of those groups would silently delete one of them,
                    which is how the most urgent row loses its colour at the
                    moment you grab it (§12, tailwind-merge).
                  */
                  held && 'ring-2 ring-primary opacity-60',
                  // ⚠ ONE COLOUR MEANS SOMETHING AND THE REST RECEDE (§12: when
                  // every row is red, red has stopped signifying). Only 'live'
                  // is tinted; 'unattached' is dimmed; 'tagged' is the ordinary
                  // card. Overdue takes the edge back, because late outranks
                  // important — and it is checked FIRST so the two colours
                  // never both apply to one border.
                  due?.overdue && !done
                    ? 'border-l-[3px] border-l-red-400 dark:border-l-red-500/70'
                    : !done && TIER_BORDER[tier],
                  !done && tier === 'unattached' && 'opacity-80',
                  done && 'opacity-60',
                )}
              >
                {/*
                  The batch tick.

                  ⚠ `stopPropagation`, BECAUSE THE WHOLE ROW OPENS THE SHEET.
                  Without it, selecting a task to bulk-edit would also open the
                  very form the bulk bar exists to avoid.

                  ⚠ AND IT IS A REAL `<input type="checkbox">`. A styled div
                  with an onClick is not reachable by keyboard and announces
                  nothing; this row is the one surface worked in batches of
                  fifty.
                */}
                {status !== 'done' && (
                  <input
                    type="checkbox"
                    checked={selected.has(task.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation()
                      setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(task.id)) next.delete(task.id)
                        else next.add(task.id)
                        return next
                      })
                    }}
                    aria-label={`Select ${task.title}`}
                    className="size-4 shrink-0 cursor-pointer accent-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                )}
                <button
                  onClick={(e) => handleComplete(task, e)}
                  className="relative shrink-0 inline-flex items-center justify-center size-5 transition-transform hover:scale-110 active:scale-95"
                  aria-label={done ? 'Reopen' : 'Complete'}
                >
                  {done ? (
                    <CheckCircle2 className="size-5 text-positive" />
                  ) : (
                    <Circle className="size-5 text-muted-foreground group-hover:text-positive transition-colors" />
                  )}
                  {/* The circle stays 20px; the tap area grows to 44px. An
                      absolute overlay does that without moving anything in the
                      row (padding on the button itself would shift the text). */}
                  <span className="tap-target" aria-hidden="true" />
                </button>

                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium truncate', done ? 'line-through text-muted-foreground' : 'text-foreground')}>
                    {task.title}
                  </p>
                  {task.why && !done && (
                    <p className="text-xs text-muted-foreground/80 truncate mt-0.5">{task.why}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {!done && tier === 'live' && (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-0.5 label-caps',
                          TIER_CHIP.live,
                        )}
                        title={`A conversation on this moved in the last ${LIVE_CORRESPONDENCE_DAYS} days`}
                      >
                        {TIER_LABELS.live}
                      </span>
                    )}
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
                        due.overdue ? 'text-critical' : due.urgent ? 'text-caution' : 'text-muted-foreground')}>
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

                {/* ⚠ `stopPropagation` BECAUSE THE WHOLE ROW IS THE OPEN
                    HANDLER. Without it the sheet opens behind the confirmation
                    dialog and the dialog's own dismiss lands on a changed
                    screen. The complete circle above does the same thing for
                    the same reason.

                    ⚠ AND IT IS VISIBLE ON FOCUS AND ALWAYS BELOW `sm` (§12): a
                    control that only appears on hover does not exist on a
                    phone, and one without `focus-visible:opacity-100` is
                    invisible to a keyboard user. The tap target is written
                    ABSOLUTELY (`size-[2.75rem]`) rather than as `size-11`,
                    because that utility is `calc(var(--spacing) * 11)` and the
                    10-17 density change took every one of those below the 44px
                    floor. */}
                {/*
                  The reassignment handle. Inline rather than positioned, so it
                  sits with the row's other actions instead of over its text.
                  Its own click stops propagation, which is what keeps it from
                  opening the task sheet underneath.
                */}
                <DragHandle
                  dnd={dnd}
                  id={task.id}
                  laneId={laneId}
                  index={taskIndex}
                  inline
                />
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingDelete(task) }}
                  title="Delete this task"
                  aria-label={`Delete task "${task.title}"`}
                  className="shrink-0 inline-flex size-[2.75rem] items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors outline-none hover:bg-critical-surface hover:text-critical focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-7 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                >
                  <Trash2 size={14} />
                </button>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        title="Delete this task?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" and its notes go for good. Complete it instead if the work actually happened — that is what the activity log and any linked commitment will record.`
            : undefined
        }
        confirmLabel="Delete task"
        destructive
        onConfirm={async () => {
          const task = pendingDelete
          setPendingDelete(null)
          if (task) await deleteTask(task)
        }}
      />

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
