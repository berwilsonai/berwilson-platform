// App-level domain types that extend the generated DB types.
// These are the shapes your components and server actions actually work with.

import type {
  Project,
  Party,
  Entity,
  ProjectPlayer,
  Milestone,
  Document,
  Update,
  DdItem,
  FinancingStructure,
  ComplianceItem,
  ActivityLog,
  ReviewQueueRow,
  ProjectStage,
  DdSeverity,
} from '@/lib/supabase/types'

// ---------------------------------------------------------------------------
// JSONB item shapes — the typed contents of update JSONB arrays
// ---------------------------------------------------------------------------

export type ActionItem = {
  text: string
  assignee?: string
  due_date?: string   // ISO date string
  completed?: boolean
}

export type WaitingOnItem = {
  text: string
  party?: string
  since?: string      // ISO date string
}

export type RiskItem = {
  text: string
  severity: DdSeverity
  mitigation?: string
}

export type DecisionItem = {
  text: string
  made_by?: string
  date?: string       // ISO date string
}

export type DrawScheduleEntry = {
  milestone: string
  amount: number
  drawn: number
  date?: string       // ISO date string
}

// ---------------------------------------------------------------------------
// AI extraction result — what Haiku returns from a paste or email
// ---------------------------------------------------------------------------

export type MentionedParty = {
  name: string
  company?: string
  role?: string
}

export type MentionedProject = {
  name_or_ref: string
  confidence: number  // 0–1
}

export type ExtractionResult = {
  summary: string
  action_items: ActionItem[]
  waiting_on: WaitingOnItem[]
  risks: RiskItem[]
  decisions: DecisionItem[]
  mentioned_parties: MentionedParty[]
  mentioned_projects: MentionedProject[]
  confidence: number  // 0–1 overall extraction quality
}

// ---------------------------------------------------------------------------
// Joined / enriched types — what the UI receives after DB queries
// ---------------------------------------------------------------------------

/** A project player with its party record joined */
export type PlayerWithParty = ProjectPlayer & {
  party: Party
}

/** A project with its players and their party records */
export type ProjectWithPlayers = Project & {
  project_players: PlayerWithParty[]
}

/** A project with its milestones sorted by sort_order */
export type ProjectWithMilestones = Project & {
  milestones: Milestone[]
}

/** An update with typed JSONB arrays instead of Json */
export type UpdateWithExtraction = Omit<
  Update,
  'action_items' | 'waiting_on' | 'risks' | 'decisions'
> & {
  action_items: ActionItem[]
  waiting_on: WaitingOnItem[]
  risks: RiskItem[]
  decisions: DecisionItem[]
}

/** A DD item with its assigned party joined */
export type DdItemWithAssignee = DdItem & {
  assigned_to_party: Party | null
}

/** A compliance item with its responsible party joined */
export type ComplianceItemWithResponsible = ComplianceItem & {
  responsible_party_record: Party | null
}

/** A financing structure with typed draw_schedule */
export type FinancingWithSchedule = Omit<FinancingStructure, 'draw_schedule'> & {
  draw_schedule: DrawScheduleEntry[] | null
}

/** An entity and all projects it's associated with */
export type EntityWithProjects = Entity & {
  entity_projects: (import('@/lib/supabase/types').EntityProject & {
    project: Project
  })[]
}

// ---------------------------------------------------------------------------
// Activity log with typed metadata
// ---------------------------------------------------------------------------

export type ActivityEvent = Omit<ActivityLog, 'metadata'> & {
  metadata: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Review queue with the source record shape
// ---------------------------------------------------------------------------

export type ReviewQueueItem = ReviewQueueRow & {
  project: Pick<Project, 'id' | 'name' | 'sector' | 'status'> | null
}

// ---------------------------------------------------------------------------
// Dashboard summary types
// ---------------------------------------------------------------------------

export type ProjectSummary = Pick<
  Project,
  'id' | 'name' | 'sector' | 'status' | 'stage' | 'estimated_value' | 'location'
> & {
  player_count: number
  pending_review_count: number
  open_dd_count: number
  latest_update_at: string | null
}

export type StageProgress = {
  stage: ProjectStage
  label: string
  completed: boolean
  target_date: string | null
  completed_at: string | null
}
