/**
 * The task board as one Google Sheet, read and written.
 *
 * WHY A SHEET AND NOT GOOGLE TASKS, WHICH THIS REPLACED (2026-10-11)
 *
 * Google Tasks lists are PRIVATE PER ACCOUNT. There is no shared list, no
 * assignee field and no delegation, so the old sync could only ever push each
 * person their own slice and `/tasks` stayed the only place the whole board
 * existed — which is the one thing two executives steering a pipeline actually
 * need to look at together. A sheet is the whole board, on a phone, off the
 * tailnet, for anyone who has the link. That is the entire reason for the
 * change; everything below is in service of it.
 *
 * WHAT IS AUTHORITATIVE WHERE
 *
 * The sheet owns exactly ONE cell per row: the Done checkbox. Everything else
 * is platform-owned and is rewritten every run, so an edit made to a title or a
 * due date in the sheet is overwritten rather than merged. That asymmetry is
 * deliberate and is the same one the Google Tasks sync drew: ticking a task off
 * is the thing this exists for, while retyping one is drifting from the record
 * two other people are reading.
 *
 * HOW THAT AVOIDS A LOOP WITHOUT A BASE TABLE
 *
 * The Google Tasks sync needed a stored `base_status` per link and a three-way
 * merge. This needs neither, because the projection is REBUILT WHOLE every run:
 * after a rebuild the rendered checkbox always agrees with the platform — FALSE
 * on an open tab, TRUE on the Done tab. So the rendered value IS the base, and
 * it is implied by which tab the row is on:
 *
 *      open tab + ticked    ->  settle it done
 *      open tab + unticked  ->  nothing (this is the rendered state)
 *      Done tab + unticked  ->  reopen it
 *      Done tab + ticked    ->  nothing (this is the rendered state)
 *
 * Read the two no-op arms carefully, because they are what makes a race
 * harmless: a task completed inside the platform at 10:05, against a sheet
 * rendered at 10:00, is read at 10:15 as "unticked on an open tab" — which
 * means nothing, not "reopen it". Nothing can be lost by arriving late.
 *
 * ORDER IS LOAD-BEARING: read the sheet, settle what it says, re-read the
 * board, then rebuild. Rebuilding before settling would overwrite the ticks
 * unread; rebuilding from the pre-settle board would redraw a task somebody
 * just ticked as still open, and they would tick it again.
 *
 * NOTHING IS EVER CREATED FROM THE SHEET. The old sync imported tasks a member
 * typed into their own Google list, which was safe because a list is one
 * person's. A shared sheet is not: a row somebody pastes in while reorganising
 * is indistinguishable from a task they meant to create, and §11's standing
 * rule is that a record is never created without a human confirm step. A row
 * with no task id in the hidden column is ignored and counted.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { dropHidden, hiddenProjectIds } from '@/lib/security/confidential'
import {
  DriveScopeError,
  ensureFolder,
  ensureRootFolder,
  ensureDomainShared,
  moveFileToFolder,
  shareWithAddresses,
} from '@/lib/integrations/google-drive-write'
import { PRIMARY_MAILBOX, isGoogleConfigured } from '@/lib/integrations/google-workspace'
import {
  SheetsApiDisabledError,
  SheetsScopeError,
  a1,
  addTabRequest,
  addedTabId,
  basicFilterRequest,
  batchGetValues,
  batchUpdate,
  batchUpdateValues,
  checkboxColumnRequest,
  clearRowsRequest,
  columnWidthRequest,
  createSpreadsheet,
  ensureRowsRequest,
  headerStyleRequest,
  hideColumnRequest,
  listTabs,
  spreadsheetExists,
  type CellValue,
  type SheetRequest,
  type SheetTab,
} from '@/lib/integrations/google-sheets'

/** Shelf under the Ber Intelligence root, beside "Lead Lists". */
const SECTION = 'Task Board'
export const SPREADSHEET_NAME = 'Ber Wilson Tasks'

/** The overview tab. Named so it sorts first and says what it holds. */
const ALL_TAB = 'All open'
/** Open tasks nobody owns. Present only while there are any — see {@link wantedTabs}. */
const UNASSIGNED_TAB = 'Unassigned'
const DONE_TAB = 'Done'

/** How far back the Done tab reaches. Long enough to undo a mistake, short enough to read. */
const DONE_WINDOW_DAYS = 90

// ---------------------------------------------------------------------------
// The one column schema, used by every tab
// ---------------------------------------------------------------------------

/**
 * ONE schema for every tab, rather than a tailored one per tab.
 *
 * A person tab does not need Assignee and an open tab never has a Completed
 * date, so three bespoke layouts were the obvious design — and they would mean
 * three renderers, three read-back parsers and three sets of column indices
 * that must agree with each other forever. §12's rule about one quantity and
 * one definition applies to columns too: the cost of a blank cell is a blank
 * cell, and the cost of a drifted index is a tick read against the wrong task.
 */
export const COLUMNS = [
  'Done',
  'Task',
  'Assignee',
  'Due',
  'Completed',
  'Record',
  'Kind',
  'Detail',
  'Why',
  'Open in Ber Intelligence',
  'Task id',
] as const

const COL_DONE = 0
/** Last column, hidden. The only thing tying a row back to a record. */
const COL_TASK_ID = COLUMNS.length - 1
const COLUMN_COUNT = COLUMNS.length

/** Pixel widths, by column. Anything unlisted keeps Sheets' default. */
const COLUMN_WIDTHS: Record<number, number> = {
  0: 56, // Done — just the checkbox
  1: 320, // Task
  2: 110, // Assignee
  3: 96, // Due
  4: 96, // Completed
  5: 200, // Record
  6: 96, // Kind
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string
  title: string
  what: string | null
  why: string | null
  assignee_id: string | null
  project_id: string | null
  opportunity_id: string | null
  objective_id: string | null
  investor_id: string | null
  lead_id: string | null
  due_date: string | null
  status: string
  completed_at: string | null
  updated_at: string | null
}

export interface MemberRow {
  id: string
  name: string
  email: string | null
  auth_user_id: string | null
}

export interface TaskSheetResult {
  /** Did the workbook exist before this run? */
  created: boolean
  spreadsheetId: string
  url: string
  /** Tabs written, with their row counts. */
  tabs: { title: string; rows: number }[]
  tabsCreated: string[]
  openTasks: number
  doneTasks: number
  /** Open tasks with no owner, counted over the WHOLE board (§12, 09-24). */
  unassigned: number
  /** Ticked on an open tab and now done here. */
  settledDone: number
  /** Unticked on the Done tab and now open again. */
  reopened: number
  /**
   * Who each settle was attributed to. A tick on a person's own tab is theirs;
   * one on a shared tab cannot be traced to a person by any API Google offers,
   * and is recorded as the sheet rather than guessed at.
   */
  settledBy: Record<string, number>
  /** Rows carrying no task id — a paste, or somebody's own notes. Ignored. */
  strayRows: number
  /** Refusals: a cell that is neither ticked nor blank, a task that is both. */
  heldBack: string[]
  /** Tasks on a protected project, dropped before the sheet was built. */
  withheld: number
  /** Addresses newly granted writer. */
  shared: string[]
  errors: string[]
}

function emptyResult(): TaskSheetResult {
  return {
    created: false,
    spreadsheetId: '',
    url: '',
    tabs: [],
    tabsCreated: [],
    openTasks: 0,
    doneTasks: 0,
    unassigned: 0,
    settledDone: 0,
    reopened: 0,
    settledBy: {},
    strayRows: 0,
    heldBack: [],
    withheld: 0,
    shared: [],
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Reading the board
// ---------------------------------------------------------------------------

const TASK_FIELDS =
  'id, title, what, why, assignee_id, project_id, opportunity_id, objective_id, ' +
  'investor_id, lead_id, due_date, status, completed_at, updated_at'

/**
 * Every task, paged.
 *
 * PostgREST truncates at 1000 rows silently (§12), and the board is 46 rows
 * today — which is exactly the size at which nobody notices the cap being added
 * and exactly the thing that makes a projection quietly incomplete two years
 * later. Paged from the start.
 */
async function loadTasks(
  supabase: ReturnType<typeof createAdminClient>
): Promise<TaskRow[]> {
  const PAGE = 1000
  const out: TaskRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_FIELDS)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Could not read tasks: ${error.message}`)
    const page = (data ?? []) as unknown as TaskRow[]
    out.push(...page)
    if (page.length < PAGE) return out
  }
}

/**
 * Resolve the record each task hangs off, to a NAME.
 *
 * Names rather than ids because the reader is on a phone with no way to look an
 * id up, and often no way to reach the platform at all. Looked up per table
 * rather than through PostgREST embeds on purpose: `tasks` has six FKs, and
 * adding a second FK to an already-embedded table breaks every existing embed
 * of it (§12, PGRST201) — a lookup cannot be broken that way.
 */
class RecordNames {
  private readonly cache = new Map<string, string>()
  // Declared, not a constructor parameter property: this module is imported by
  // standalone verification scripts running under `node
  // --experimental-strip-types`, which is strip-only and cannot compile one
  // (§12). It typechecks and builds either way; what breaks is every script.
  private readonly supabase: ReturnType<typeof createAdminClient>

  constructor(supabase: ReturnType<typeof createAdminClient>) {
    this.supabase = supabase
  }

  private async load(table: string, column: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const { data } = await this.supabase
      .from(table as 'projects')
      .select(`id, ${column}`)
      .in('id', ids)
    for (const row of (data ?? []) as unknown as Record<string, string>[]) {
      if (row?.id) this.cache.set(`${table}:${row.id}`, String(row[column] ?? ''))
    }
  }

  async prime(tasks: TaskRow[]): Promise<void> {
    const pick = (f: keyof TaskRow) => [
      ...new Set(tasks.map((t) => t[f]).filter((v): v is string => Boolean(v))),
    ]
    await Promise.all([
      this.load('projects', 'name', pick('project_id')),
      this.load('opportunities', 'name', pick('opportunity_id')),
      this.load('objectives', 'title', pick('objective_id')),
      this.load('investors', 'name', pick('investor_id')),
      this.load('leads', 'title', pick('lead_id')),
    ])
  }

  /**
   * The ONE record a task is shown against, and what kind it is.
   *
   * Precedence carried over from the Google Tasks body builder, where it was
   * reasoned out: a lead is the weakest of these attachments, and a lead that
   * gets promoted acquires a project or opportunity tag that should outrank it.
   */
  for(task: TaskRow): { record: string; kind: string } {
    const get = (table: string, id: string | null) =>
      id ? (this.cache.get(`${table}:${id}`) || null) : null

    const project = get('projects', task.project_id)
    if (project) return { record: project, kind: 'Project' }
    const opportunity = get('opportunities', task.opportunity_id)
    if (opportunity) return { record: opportunity, kind: 'Opportunity' }
    const investor = get('investors', task.investor_id)
    if (investor) return { record: investor, kind: 'Investor' }
    const objective = get('objectives', task.objective_id)
    if (objective) return { record: objective, kind: 'Objective' }
    const lead = get('leads', task.lead_id)
    if (lead) return { record: lead, kind: 'Lead' }
    return { record: '', kind: '' }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** YYYY-MM-DD, which is what sorts correctly as text in Sheets. */
function isoDay(value: string | null): string {
  return value ? value.slice(0, 10) : ''
}

/**
 * One row, in column order.
 *
 * `done` is written as a real JSON boolean so the checkbox renders ticked or
 * unticked rather than showing the word. Everything else is a string: a task
 * title that starts with `=` must land as text, which is why the whole write
 * goes out as RAW.
 */
function renderRow(
  task: TaskRow,
  assignee: string,
  names: RecordNames,
  appUrl: string
): CellValue[] {
  const { record, kind } = names.for(task)
  return [
    task.status === 'done',
    task.title?.trim() || 'Untitled task',
    assignee,
    isoDay(task.due_date),
    isoDay(task.completed_at),
    record,
    kind,
    task.what?.trim() ?? '',
    task.why?.trim() ?? '',
    appUrl ? `${appUrl}/tasks?task=${task.id}` : '',
    task.id,
  ]
}

/**
 * Soonest deadline first, undated last.
 *
 * ⚠ `nullsFirst:false` ordering is what §12 warns about when a list is CAPPED —
 * the newest records sort last and fall off the end. Nothing is capped here:
 * every open task is written, so an undated one is at the bottom of the tab
 * rather than absent from it. That is the only reason this ordering is safe,
 * and it stops being safe the moment somebody adds a row limit.
 */
export function byUrgency(a: TaskRow, b: TaskRow): number {
  const aDue = a.due_date ?? '9999-12-31'
  const bDue = b.due_date ?? '9999-12-31'
  if (aDue !== bDue) return aDue < bDue ? -1 : 1
  return (a.title ?? '').localeCompare(b.title ?? '')
}

/** Most recently finished first — the Done tab is read to find a mistake. */
function byCompletion(a: TaskRow, b: TaskRow): number {
  const aAt = a.completed_at ?? a.updated_at ?? ''
  const bAt = b.completed_at ?? b.updated_at ?? ''
  return bAt.localeCompare(aAt)
}

// ---------------------------------------------------------------------------
// Reading a tick back
// ---------------------------------------------------------------------------

const TICKED = new Set(['x', 'X', 'yes', 'y', 'true', 'done', '✓', '✔', '1'])
const UNTICKED = new Set(['', 'no', 'n', 'false', '0', '-'])

/**
 * Is this cell a tick, a blank, or neither?
 *
 * A real checkbox returns a JSON boolean, which is the normal case. The string
 * arms exist because somebody will type into the column — on a phone keyboard,
 * or in a copied row — and `x` meaning "done" is not a misuse to be punished
 * with silence. Anything that is NEITHER is refused and named: §12's rule is
 * that ambiguity must mean no match, and "maybe" in a Done column is the case
 * that must refuse rather than guess which way the person meant it.
 */
export function readTick(cell: CellValue | undefined): boolean | null {
  if (cell === undefined || cell === null) return false
  if (typeof cell === 'boolean') return cell
  if (typeof cell === 'number') return cell === 1 ? true : cell === 0 ? false : null
  const text = cell.trim()
  if (TICKED.has(text) || TICKED.has(text.toLowerCase())) return true
  if (UNTICKED.has(text.toLowerCase())) return false
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What the sheet is asking for, per task. */
type Instruction = 'done' | 'reopen'

export interface TabRead {
  title: string
  /** Does this tab hold open tasks or finished ones? Decides what a tick means. */
  kind: 'open' | 'done'
  /** The member whose tab this is, for attribution. Null on a shared tab. */
  member: MemberRow | null
  rows: CellValue[][]
}

/**
 * Turn what was read off every tab into one instruction per task.
 *
 * A task appears on TWO open tabs at once — "All open" and its owner's — so two
 * cells speak for it. They are resolved rather than treated as a conflict: a
 * tick is an affirmative act and a blank is the absence of one, so a tick
 * anywhere wins. A genuine contradiction (ticked on an open tab AND unticked on
 * the Done tab, which takes a copied row to produce) is held back and named.
 */
export function collectInstructions(reads: TabRead[]): {
  instructions: Map<string, { instruction: Instruction; member: MemberRow | null; tab: string }>
  strayRows: number
  heldBack: string[]
} {
  const instructions = new Map<
    string,
    { instruction: Instruction; member: MemberRow | null; tab: string }
  >()
  const heldBack: string[] = []
  let strayRows = 0

  for (const read of reads) {
    for (const row of read.rows) {
      const id = String(row[COL_TASK_ID] ?? '').trim()
      if (!UUID.test(id)) {
        // A row with something in it but no id is a paste or somebody's own
        // note. An entirely blank row is just the bottom of the grid.
        if (row.some((c) => c !== null && c !== undefined && String(c).trim() !== '')) {
          strayRows++
        }
        continue
      }

      const tick = readTick(row[COL_DONE])
      if (tick === null) {
        const label = String(row[1] ?? id).slice(0, 60)
        heldBack.push(
          `"${label}" on ${read.title}: the Done cell holds "${String(row[COL_DONE])}", ` +
            `which is neither ticked nor blank — left alone.`
        )
        continue
      }

      // The no-op arms: the rendered state, arrived back unchanged.
      if (read.kind === 'open' && !tick) continue
      if (read.kind === 'done' && tick) continue

      const instruction: Instruction = read.kind === 'open' ? 'done' : 'reopen'
      const existing = instructions.get(id)
      if (existing && existing.instruction !== instruction) {
        heldBack.push(
          `Task ${id} is ticked on ${existing.tab} and unticked on ${read.title} at the same ` +
            `time — left alone. One of those rows is a copy.`
        )
        instructions.delete(id)
        continue
      }
      // First writer wins the attribution, and the tab order puts a person's
      // own tab after the shared one — so a tick on both is credited to them.
      if (!existing || (!existing.member && read.member)) {
        instructions.set(id, { instruction, member: read.member, tab: read.title })
      }
    }
  }

  return { instructions, strayRows, heldBack }
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/**
 * Settle what the sheet asked for.
 *
 * Written through a client carrying the ticker's identity where the tab names
 * one, so `activity_log` attributes the completion to the person rather than to
 * "system" (§12). A shared tab cannot be attributed — the Sheets API does not
 * say who edited a cell — so it is recorded as the sheet itself, which is true,
 * rather than credited to whoever the task happened to be assigned to.
 */
async function applyInstructions(
  instructions: Map<string, { instruction: Instruction; member: MemberRow | null; tab: string }>,
  result: TaskSheetResult
): Promise<void> {
  for (const [taskId, { instruction, member }] of instructions) {
    const actor =
      member?.auth_user_id ? { id: member.auth_user_id, email: member.email } : undefined
    const supabase = createAdminClient(actor)

    const patch =
      instruction === 'done'
        ? { status: 'done', completed_at: new Date().toISOString() }
        : { status: 'open', completed_at: null }

    // Guarded on the CURRENT status, not just the id: between the sheet being
    // read and this write, the same task may have been settled in the platform.
    // Then this update matches nothing and the counter does not claim it — a
    // pass that reports what it did must not report work somebody else did
    // (§12, 09-30).
    const { data, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', taskId)
      .eq('status', instruction === 'done' ? 'open' : 'done')
      .select('id')

    if (error) {
      result.errors.push(`Could not settle ${taskId}: ${error.message}`)
      continue
    }
    if ((data ?? []).length === 0) continue

    if (instruction === 'done') result.settledDone++
    else result.reopened++
    const who = member?.name ?? 'the sheet'
    result.settledBy[who] = (result.settledBy[who] ?? 0) + 1
  }
}

// ---------------------------------------------------------------------------
// Which tabs should exist
// ---------------------------------------------------------------------------

/**
 * The tab list, in display order.
 *
 * A person gets a tab once they have anything on the board, and KEEPS it
 * afterwards even when it empties — a tab that comes and goes is worse than an
 * empty one, because the bookmark and the habit both point at it. Nothing here
 * ever deletes a tab, which also means a tab somebody adds themselves is left
 * strictly alone rather than tidied away.
 */
export function wantedTabs(
  members: MemberRow[],
  tasks: TaskRow[],
  existing: SheetTab[],
  unassignedCount: number
): { title: string; kind: 'open' | 'done'; member: MemberRow | null }[] {
  const withWork = new Set(tasks.map((t) => t.assignee_id).filter(Boolean) as string[])
  const existingTitles = new Set(existing.map((t) => t.title))

  const people = members
    .filter((m) => withWork.has(m.id) || existingTitles.has(m.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  const tabs: { title: string; kind: 'open' | 'done'; member: MemberRow | null }[] = [
    { title: ALL_TAB, kind: 'open', member: null },
  ]
  // ⚠ The person tabs come AFTER the shared one so that a task ticked on both
  // is attributed to the person — collectInstructions prefers a later read that
  // names a member. Reordering these silently moves every settle to "the sheet".
  for (const m of people) tabs.push({ title: m.name, kind: 'open', member: m })
  // Present only while there is something in it, or while the tab already
  // exists. Six of 22 open tasks had no owner when this was built, which is why
  // it is a tab and not a footnote.
  if (unassignedCount > 0 || existingTitles.has(UNASSIGNED_TAB)) {
    tabs.push({ title: UNASSIGNED_TAB, kind: 'open', member: null })
  }
  tabs.push({ title: DONE_TAB, kind: 'done', member: null })
  return tabs
}

/** Which tasks belong on a given tab. */
function rowsFor(
  tab: { title: string; kind: 'open' | 'done'; member: MemberRow | null },
  open: TaskRow[],
  done: TaskRow[]
): TaskRow[] {
  if (tab.kind === 'done') return done
  if (tab.title === ALL_TAB) return open
  if (tab.title === UNASSIGNED_TAB) return open.filter((t) => !t.assignee_id)
  return open.filter((t) => t.assignee_id === tab.member?.id)
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** Where the spreadsheet id is remembered between runs. One row, enforced. */
interface StateRow {
  spreadsheet_id: string
  spreadsheet_url: string | null
}

async function readState(
  supabase: ReturnType<typeof createAdminClient>
): Promise<StateRow | null> {
  const { data, error } = await supabase
    .from('task_sheet_state')
    .select('spreadsheet_id, spreadsheet_url')
    .maybeSingle()
  if (error) throw new Error(`Could not read the task-sheet state: ${error.message}`)
  return (data as StateRow | null) ?? null
}

/**
 * Find or create the workbook.
 *
 * Checks that a remembered spreadsheet still EXISTS rather than trusting the
 * stored id: somebody trashing it by hand is invisible from here otherwise, and
 * every run would then write into a file nobody can open while reporting
 * success. A 404 is the one condition that justifies making a new one — a
 * disabled API or a missing scope must not, or the Drive fills with abandoned
 * workbooks (`spreadsheetExists` enforces that distinction).
 */
async function ensureSpreadsheet(
  supabase: ReturnType<typeof createAdminClient>,
  result: TaskSheetResult
): Promise<{ spreadsheetId: string; url: string }> {
  const state = await readState(supabase)
  if (state?.spreadsheet_id && (await spreadsheetExists(state.spreadsheet_id))) {
    return {
      spreadsheetId: state.spreadsheet_id,
      url:
        state.spreadsheet_url ??
        `https://docs.google.com/spreadsheets/d/${state.spreadsheet_id}`,
    }
  }

  const ref = await createSpreadsheet(SPREADSHEET_NAME)
  result.created = true

  // Filed beside the lead lists so the whole published surface is one place.
  // Non-fatal: a workbook in My Drive root still works and is still shared, and
  // failing the whole run over its filing would be the wrong trade.
  try {
    const root = await ensureRootFolder()
    await ensureDomainShared(root.id, PRIMARY_MAILBOX)
    const folder = await ensureFolder(SECTION, root.id)
    await moveFileToFolder(ref.spreadsheetId, folder.id)
  } catch (err) {
    result.errors.push(
      `Created the workbook but could not file it under ${SECTION}: ` +
        `${err instanceof Error ? err.message : String(err)}`
    )
  }

  await supabase
    .from('task_sheet_state')
    .upsert(
      {
        id: true,
        spreadsheet_id: ref.spreadsheetId,
        spreadsheet_url: ref.spreadsheetUrl,
      },
      { onConflict: 'id' }
    )

  return { spreadsheetId: ref.spreadsheetId, url: ref.spreadsheetUrl }
}

/**
 * Create any missing tab, and remember every tab's numeric id.
 *
 * The first tab of a brand-new spreadsheet is Google's "Sheet1"; it is RENAMED
 * into the first wanted tab rather than added-then-deleted, because deleting
 * the last remaining sheet is an error and the add/delete ordering to avoid
 * that is a trap for no gain.
 */
async function ensureTabs(
  spreadsheetId: string,
  wanted: { title: string }[],
  result: TaskSheetResult
): Promise<Map<string, SheetTab>> {
  let tabs = await listTabs(spreadsheetId)
  const byTitle = new Map(tabs.map((t) => [t.title, t]))

  const missing = wanted.filter((w) => !byTitle.has(w.title))
  if (missing.length === 0) return byTitle

  const requests: SheetRequest[] = []
  const renameTarget = tabs.length === 1 && tabs[0].title === 'Sheet1' ? tabs[0] : null
  const toAdd = [...missing]

  if (renameTarget) {
    const first = toAdd.shift()!
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId: renameTarget.sheetId,
          title: first.title,
          gridProperties: { frozenRowCount: 1 },
        },
        fields: 'title,gridProperties.frozenRowCount',
      },
    })
    result.tabsCreated.push(first.title)
  }
  for (const w of toAdd) {
    requests.push(addTabRequest(w.title, COLUMN_COUNT))
    result.tabsCreated.push(w.title)
  }

  const replies = await batchUpdate(spreadsheetId, requests)
  // Positional, and only the addSheet replies carry an id — the rename reply is
  // empty, which is why the id is read back by listing rather than from here.
  // (addedTabId stays the documented way to read one when a caller needs it
  // without a second round trip.)
  void replies.map(addedTabId)

  tabs = await listTabs(spreadsheetId)
  return new Map(tabs.map((t) => [t.title, t]))
}

/**
 * Make sure the people who have to tick a box can actually write.
 *
 * The workbook sits under the Ber Intelligence root, which is shared with the
 * domain as READER — enough to look at, and not enough to settle anything. So
 * each active member's address is granted writer on the file explicitly.
 *
 * Asserted every run rather than once at creation, for the reason §12 gives:
 * a grant removed by hand in Drive is invisible from here, and a content hash
 * cannot detect a change made on the far side of the API.
 */
async function ensureWriters(
  spreadsheetId: string,
  members: MemberRow[],
  result: TaskSheetResult
): Promise<void> {
  const addresses = members
    .map((m) => m.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e && e.includes('@')))
    // The owning mailbox created the file and already has everything.
    .filter((e) => e !== PRIMARY_MAILBOX.toLowerCase())
  if (addresses.length === 0) return

  try {
    const { granted, failed } = await shareWithAddresses(spreadsheetId, addresses, { role: 'writer' })
    result.shared = granted
    for (const email of failed) {
      result.errors.push(`Could not grant ${email} write access to the task sheet.`)
    }
  } catch (err) {
    if (err instanceof DriveScopeError) throw err
    result.errors.push(
      `Could not assert sharing: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Read the sheet, settle what it says, then rebuild it from the board.
 *
 * Returns a report rather than throwing for anything recoverable — the counters
 * are what the health card reads, and a run that settled three tasks and then
 * failed to share one address must say both.
 */
export async function syncTaskSheet(): Promise<TaskSheetResult> {
  const result = emptyResult()

  if (!isGoogleConfigured()) {
    throw new Error('Google Workspace is not configured, so the task sheet cannot be synced.')
  }

  const supabase = createAdminClient()
  const appUrl = (process.env.APP_URL ?? '').replace(/\/+$/, '')

  const { data: memberData, error: memberErr } = await supabase
    .from('team_members')
    .select('id, name, email, auth_user_id')
    .eq('active', true)
  if (memberErr) throw new Error(`Could not read the team: ${memberErr.message}`)
  const members = (memberData ?? []) as MemberRow[]
  const memberById = new Map(members.map((m) => [m.id, m]))

  const { spreadsheetId, url } = await ensureSpreadsheet(supabase, result)
  result.spreadsheetId = spreadsheetId
  result.url = url

  // --- 1. read the sheet, BEFORE anything is written ----------------------
  // A rebuild first would overwrite every tick unread, which is the one way
  // this pass could lose a person's work rather than merely delay it.
  const existingTabs = await listTabs(spreadsheetId)
  const readable = existingTabs.filter(
    (t) => t.title === ALL_TAB || t.title === DONE_TAB || t.title === UNASSIGNED_TAB || memberByName(members, t.title)
  )
  const ranges = readable.map((t) => a1(t.title, `A2:${columnLetter(COL_TASK_ID)}`))
  const values = result.created ? new Map<string, CellValue[][]>() : await batchGetValues(spreadsheetId, ranges)

  const reads: TabRead[] = readable.map((t, i) => ({
    title: t.title,
    kind: t.title === DONE_TAB ? 'done' : 'open',
    member: memberByName(members, t.title),
    rows: values.get(ranges[i]) ?? [],
  }))
  // Shared tabs first so a person's own tab wins the attribution — the same
  // ordering wantedTabs relies on, restated here because the read order is what
  // actually decides it.
  reads.sort((a, b) => Number(Boolean(a.member)) - Number(Boolean(b.member)))

  const { instructions, strayRows, heldBack } = collectInstructions(reads)
  result.strayRows = strayRows
  result.heldBack.push(...heldBack)

  // --- 2. settle ----------------------------------------------------------
  await applyInstructions(instructions, result)

  // --- 3. re-read the board, so the rebuild shows the settles just made ----
  const allTasks = await loadTasks(supabase)

  // ⚠ OUTBOUND CHANNEL. This workbook is shared with the domain and sits in
  // Drive — off the tailnet, on phones, and impossible to recall. So the
  // confidential filter takes the ABSOLUTE answer with no viewer (§12): there
  // is no step-up that can unlock a row here, because nothing can be unlocked
  // after it has left the box.
  //
  // Filtered on project_id ONLY, deliberately. `confidential` exists on
  // projects and nowhere else, so dropping a task because it hangs off a lead
  // or an opportunity would withhold real work and protect nothing — measured
  // 10-11: 27 of 46 tasks hang off a lead and 3 off an opportunity.
  const hidden = await hiddenProjectIds(null)
  // Counted on its own rather than as a length difference: §12's rule is that a
  // withheld count derived after the filter is structurally wrong, and "0
  // withheld" beside a trimmed list asserts a completeness it does not have.
  result.withheld = allTasks.filter((t) => t.project_id && hidden.has(t.project_id)).length
  const visible = dropHidden(allTasks, (t) => t.project_id, hidden)

  const names = new RecordNames(supabase)
  await names.prime(visible)

  const doneCutoff = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString()
  // Anything that is not `done` counts as open. A third status added later
  // would otherwise be invisible on every tab rather than merely untidy on one
  // — §12's "a file type with no branch is invisible, not unreadable".
  const open = visible.filter((t) => t.status !== 'done').sort(byUrgency)
  const done = visible
    .filter((t) => t.status === 'done' && (t.completed_at ?? t.updated_at ?? '') >= doneCutoff)
    .sort(byCompletion)

  result.openTasks = open.length
  result.doneTasks = done.length
  result.unassigned = open.filter((t) => !t.assignee_id).length

  // --- 4. rebuild ---------------------------------------------------------
  const wanted = wantedTabs(members, visible, existingTabs, result.unassigned)
  const tabsByTitle = await ensureTabs(spreadsheetId, wanted, result)

  const structural: SheetRequest[] = []
  const writes: { range: string; values: CellValue[][] }[] = []

  for (const tab of wanted) {
    const sheet = tabsByTitle.get(tab.title)
    if (!sheet) {
      result.errors.push(`Tab "${tab.title}" could not be created.`)
      continue
    }

    const tasks = rowsFor(tab, open, done)
    const body = tasks.map((t) =>
      renderRow(
        t,
        t.assignee_id ? (memberById.get(t.assignee_id)?.name ?? 'Unknown') : 'Unassigned',
        names,
        appUrl
      )
    )

    // A header with nothing under it reads as broken. Say which it is — the
    // same choice buildLeadCsv makes, and for the same reason.
    if (body.length === 0) {
      body.push([
        false,
        tab.kind === 'done'
          ? `Nothing completed in the last ${DONE_WINDOW_DAYS} days.`
          : tab.title === UNASSIGNED_TAB
            ? 'Every open task has an owner.'
            : 'No open tasks.',
        ...Array<CellValue>(COLUMN_COUNT - 2).fill(''),
      ])
    }

    const lastRow = 1 + body.length
    const grow = ensureRowsRequest(sheet.sheetId, sheet.rowCount, lastRow + 200)
    if (grow) structural.push(grow)

    // Clear below what is about to be written, so a board that shrank does not
    // leave yesterday's rows sitting under today's — a stale row with a live
    // checkbox is an instruction waiting to be misread.
    structural.push(clearRowsRequest(sheet.sheetId, lastRow, Math.max(sheet.rowCount, lastRow + 200)))
    structural.push(headerStyleRequest(sheet.sheetId, COLUMN_COUNT))
    structural.push(checkboxColumnRequest(sheet.sheetId, COL_DONE, lastRow + 200))
    structural.push(hideColumnRequest(sheet.sheetId, COL_TASK_ID))
    structural.push(basicFilterRequest(sheet.sheetId, COLUMN_COUNT))
    for (const [index, pixels] of Object.entries(COLUMN_WIDTHS)) {
      structural.push(columnWidthRequest(sheet.sheetId, Number(index), pixels))
    }

    writes.push({
      range: a1(tab.title, `A1:${columnLetter(COL_TASK_ID)}${lastRow}`),
      values: [[...COLUMNS], ...body],
    })
    result.tabs.push({ title: tab.title, rows: tasks.length })
  }

  // Values first, then formatting: the checkbox rule spans rows that must
  // already hold booleans, and a validation rule applied over a text cell shows
  // Sheets' red "invalid" corner until the next write.
  await batchUpdateValues(spreadsheetId, writes)
  await batchUpdate(spreadsheetId, structural)

  // --- 5. sharing and bookkeeping ----------------------------------------
  await ensureWriters(spreadsheetId, members, result)

  await supabase
    .from('task_sheet_state')
    .update({
      spreadsheet_url: url,
      last_synced_at: new Date().toISOString(),
      rows_published: result.openTasks + result.doneTasks,
      settled_total: result.settledDone + result.reopened,
      last_error: result.errors.length > 0 ? result.errors.join(' | ').slice(0, 1000) : null,
    })
    .eq('id', true)

  return result
}

/** Column index to an A1 letter. Eleven columns today; correct past Z anyway. */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

function memberByName(members: MemberRow[], title: string): MemberRow | null {
  return members.find((m) => m.name === title) ?? null
}

/** Sync without ever failing the caller — for a fire-and-forget refresh. */
export async function syncTaskSheetQuietly(): Promise<TaskSheetResult | null> {
  try {
    return await syncTaskSheet()
  } catch (err) {
    if (err instanceof SheetsApiDisabledError) {
      console.warn('[tasks/sheet] the Google Sheets API is not enabled on the Cloud project.')
    } else if (err instanceof SheetsScopeError) {
      console.warn('[tasks/sheet] the stored consent predates a scope this needs.')
    } else {
      console.warn('[tasks/sheet] skipped:', err instanceof Error ? err.message : err)
    }
    return null
  }
}
