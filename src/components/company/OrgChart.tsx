import {
  ChevronDown,
  ChevronRight,
  Building2,
  Landmark,
  ShieldCheck,
  UserPlus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Chip } from '@/components/ui/chip'
import {
  groupOrg,
  ORG_ENTITY_TYPE_SHORT,
  ORG_ENTITY_TYPE_LABELS,
  ORG_ENTITY_BADGE,
  ORG_TIER_LABELS,
  orgEntityType,
  ORG_TIERS,
} from '@/lib/utils/org'
import type { OrgNode, OrgPerson } from '@/lib/supabase/types'

/**
 * The presentation chart — a Lucid-style tree of the entity architecture,
 * rendered from the same rows the edit board maintains. Pure component (no
 * 'use client'): the interactive Structure view mounts it in a client tree
 * with `onToggleDivision`, and the print route renders it on the server with
 * everything static.
 *
 * Visual language: the two parent arms are navy hero cards; each division
 * carries an accent color (matched from its vertical) that flows down its SPV
 * rail; people render as initial avatars. All colors are literal class
 * strings so Tailwind keeps them, and every tint has a dark variant — print
 * forces light theme.
 */

const OPEN_BADGE =
  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'

// ─── Division accents ─────────────────────────────────────────────────────────

interface DivisionAccent {
  /** Solid strip across the top of the division card. */
  bar: string
  /** Softer strip on the left edge of each SPV card. */
  edge: string
  /** The vertical label above the division name. */
  label: string
  /** The SPV rail connector lines. */
  rail: string
}

const ACCENTS = {
  amber: {
    bar: 'bg-amber-500',
    edge: 'bg-amber-300 dark:bg-amber-500/50',
    label: 'text-amber-600 dark:text-amber-400',
    rail: 'bg-amber-300 dark:bg-amber-500/40',
  },
  blue: {
    bar: 'bg-blue-500',
    edge: 'bg-blue-300 dark:bg-blue-500/50',
    label: 'text-blue-600 dark:text-blue-400',
    rail: 'bg-blue-300 dark:bg-blue-500/40',
  },
  rose: {
    bar: 'bg-rose-500',
    edge: 'bg-rose-300 dark:bg-rose-500/50',
    label: 'text-rose-600 dark:text-rose-400',
    rail: 'bg-rose-300 dark:bg-rose-500/40',
  },
  emerald: {
    bar: 'bg-emerald-500',
    edge: 'bg-emerald-300 dark:bg-emerald-500/50',
    label: 'text-emerald-600 dark:text-emerald-400',
    rail: 'bg-emerald-300 dark:bg-emerald-500/40',
  },
  sky: {
    bar: 'bg-sky-500',
    edge: 'bg-sky-300 dark:bg-sky-500/50',
    label: 'text-sky-600 dark:text-sky-400',
    rail: 'bg-sky-300 dark:bg-sky-500/40',
  },
  violet: {
    bar: 'bg-violet-500',
    edge: 'bg-violet-300 dark:bg-violet-500/50',
    label: 'text-violet-600 dark:text-violet-400',
    rail: 'bg-violet-300 dark:bg-violet-500/40',
  },
  teal: {
    bar: 'bg-teal-500',
    edge: 'bg-teal-300 dark:bg-teal-500/50',
    label: 'text-teal-600 dark:text-teal-400',
    rail: 'bg-teal-300 dark:bg-teal-500/40',
  },
} satisfies Record<string, DivisionAccent>

const ACCENT_CYCLE: DivisionAccent[] = [
  ACCENTS.blue,
  ACCENTS.emerald,
  ACCENTS.amber,
  ACCENTS.rose,
  ACCENTS.sky,
  ACCENTS.violet,
  ACCENTS.teal,
]

/** Keyword-match the division's vertical to the app's sector hue families. */
function divisionAccent(division: OrgNode, index: number): DivisionAccent {
  const text = `${division.vertical ?? ''} ${division.name}`.toLowerCase()
  if (/energy|power|solar|util/.test(text)) return ACCENTS.amber
  if (/military|defense|federal|government/.test(text)) return ACCENTS.blue
  if (/health|wellness|medical/.test(text)) return ACCENTS.rose
  if (/real estate|housing|develop/.test(text)) return ACCENTS.emerald
  if (/tech|data|software/.test(text)) return ACCENTS.sky
  if (/steel|prefab|manufactur|industrial/.test(text)) return ACCENTS.violet
  if (/infrastructure|rail|transit/.test(text)) return ACCENTS.blue
  return ACCENT_CYCLE[index % ACCENT_CYCLE.length]
}

// ─── People helpers ───────────────────────────────────────────────────────────

// Same palette as the task board avatars, hashed from the name (org people are
// free text, so there's no stored color to reuse).
const PERSON_TONES = [
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
]

function personTone(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return PERSON_TONES[Math.abs(hash) % PERSON_TONES.length]
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ─── Chart ────────────────────────────────────────────────────────────────────

export interface OrgChartProps {
  nodes: OrgNode[]
  people: OrgPerson[]
  /** Which divisions show their SPVs. 'all' = fully expanded. */
  expandedDivisions?: ReadonlySet<string> | 'all'
  /** Show the leadership roster band + staff inside entity cards. */
  showPeople: boolean
  /** Present = interactive drill-down; absent = static (print). */
  onToggleDivision?: (id: string) => void
}

export default function OrgChart({
  nodes,
  people,
  expandedDivisions = 'all',
  showPeople,
  onToggleDivision,
}: OrgChartProps) {
  const { arms, management, divisions, spvsByDivision, roster, staffByNode } = groupOrg(nodes, people)
  const isExpanded = (id: string) => expandedDivisions === 'all' || expandedDivisions.has(id)
  const hasRoster = roster.leadership.length + roster.director.length > 0

  return (
    <div className="min-w-fit mx-auto">
      {/* Arms + management services */}
      <div className="flex justify-center items-stretch gap-4">
        {arms.map((arm, i) => (
          <ArmChartCard key={arm.id} arm={arm} icon={i === 0 ? Building2 : Landmark} />
        ))}
        {management && <ManagementChartCard node={management} />}
      </div>

      {/* Leadership roster */}
      {showPeople && hasRoster && <LeadershipBand roster={roster} />}

      {/* Divisions */}
      {divisions.length > 0 && (
        <>
          <div className="mx-auto h-7 w-px bg-border" />
          <div className="flex justify-center items-start">
            {divisions.map((division, i) => {
              const spvs = spvsByDivision.get(division.id) ?? []
              const expanded = isExpanded(division.id)
              const accent = divisionAccent(division, i)
              return (
                <div key={division.id} className="flex flex-col w-60 px-2">
                  <TopConnector first={i === 0} last={i === divisions.length - 1} />
                  <DivisionChartCard
                    division={division}
                    accent={accent}
                    spvCount={spvs.length}
                    expanded={expanded}
                    staff={showPeople ? staffByNode.get(division.id) ?? [] : []}
                    onToggle={onToggleDivision ? () => onToggleDivision(division.id) : undefined}
                  />
                  {expanded && spvs.length > 0 && (
                    <SpvRail
                      spvs={spvs}
                      accent={accent}
                      staffByNode={staffByNode}
                      showPeople={showPeople}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <Legend showPeople={showPeople} />
    </div>
  )
}

// ─── Connectors ───────────────────────────────────────────────────────────────

/** Elbow into a horizontal sibling row: half-width top borders + center stub. */
function TopConnector({ first, last }: { first: boolean; last: boolean }) {
  return (
    <div className="relative h-5 -mx-2">
      {!first && <div className="absolute left-0 right-1/2 top-0 border-t border-border" />}
      {!last && <div className="absolute left-1/2 right-0 top-0 border-t border-border" />}
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
    </div>
  )
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function ArmChartCard({ arm, icon: Icon }: { arm: OrgNode; icon: typeof Building2 }) {
  return (
    <div className="w-64 rounded-xl bg-primary text-primary-foreground elev-2 p-4">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center size-9 rounded-lg bg-primary-foreground/10 shrink-0">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-tight">{arm.name}</p>
          {arm.entity_type && (
            <Chip
              tone="bg-primary-foreground/10 text-primary-foreground ring-primary-foreground/25"
              className="mt-1.5"
            >
              {arm.entity_type}
            </Chip>
          )}
          {arm.note && (
            <p className="text-xs text-primary-foreground/70 mt-1.5 leading-snug">{arm.note}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ManagementChartCard({ node }: { node: OrgNode }) {
  return (
    <div className="w-64 rounded-xl border border-dashed border-border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <span className="flex items-center justify-center size-9 rounded-lg bg-muted text-muted-foreground shrink-0">
          <ShieldCheck size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{node.name}</p>
          {node.note && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{node.note}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function DivisionChartCard({
  division,
  accent,
  spvCount,
  expanded,
  staff,
  onToggle,
}: {
  division: OrgNode
  accent: DivisionAccent
  spvCount: number
  expanded: boolean
  staff: OrgPerson[]
  onToggle?: () => void
}) {
  const entityType = orgEntityType(division.entity_type)
  const body = (
    <>
      <div className={cn('h-1', accent.bar)} />
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {division.vertical && (
              <p className={cn('label-caps', accent.label)}>{division.vertical}</p>
            )}
            <p className="text-sm font-semibold leading-tight mt-0.5">{division.name}</p>
            <p className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              {entityType && (
                <Chip tone={ORG_ENTITY_BADGE[entityType]} title={ORG_ENTITY_TYPE_LABELS[entityType]}>
                  {ORG_ENTITY_TYPE_SHORT[entityType]}
                </Chip>
              )}
              <span className="text-xs text-muted-foreground tnum">
                {spvCount} SPV{spvCount !== 1 ? 's' : ''}
              </span>
            </p>
          </div>
          {onToggle && spvCount > 0 && (
            <span className="shrink-0 text-muted-foreground mt-0.5">
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </span>
          )}
        </div>
        {staff.length > 0 && <StaffLines staff={staff} />}
      </div>
    </>
  )

  if (onToggle) {
    return (
      <button
        onClick={onToggle}
        className="w-full text-left rounded-xl border border-border bg-card elev-1 overflow-hidden lift"
      >
        {body}
      </button>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card elev-1 overflow-hidden">{body}</div>
  )
}

function SpvChartCard({
  spv,
  accent,
  staff,
}: {
  spv: OrgNode
  accent: DivisionAccent
  staff: OrgPerson[]
}) {
  const entityType = orgEntityType(spv.entity_type)
  return (
    <div className="flex rounded-lg border border-border bg-card elev-1 overflow-hidden">
      <div className={cn('w-1 shrink-0', accent.edge)} />
      <div className="flex-1 min-w-0 p-2.5">
        <p className="text-sm font-medium leading-tight">{spv.name}</p>
        <p className="mt-1 flex items-center gap-1.5 flex-wrap">
          {entityType && (
            <Chip tone={ORG_ENTITY_BADGE[entityType]} title={ORG_ENTITY_TYPE_LABELS[entityType]}>
              {ORG_ENTITY_TYPE_SHORT[entityType]}
            </Chip>
          )}
          {spv.location && <span className="text-xs text-muted-foreground">{spv.location}</span>}
        </p>
        {staff.length > 0 && <StaffLines staff={staff} />}
      </div>
    </div>
  )
}

/** Vertical rail of SPVs under a division card, with accent elbow connectors. */
function SpvRail({
  spvs,
  accent,
  staffByNode,
  showPeople,
}: {
  spvs: OrgNode[]
  accent: DivisionAccent
  staffByNode: Map<string, OrgPerson[]>
  showPeople: boolean
}) {
  return (
    <div className="mt-2">
      {spvs.map((spv, i) => {
        const last = i === spvs.length - 1
        return (
          <div key={spv.id} className="flex">
            <div className="w-4 shrink-0 relative">
              {/* vertical rail segment (first extends up into the gap to touch the card) */}
              <div
                className={cn(
                  'absolute left-1.5 w-px',
                  accent.rail,
                  i === 0 ? '-top-2' : 'top-0',
                  last ? 'h-[calc(1.25rem+0.5rem)]' : 'bottom-0',
                )}
              />
              {/* horizontal stub into the card */}
              <div className={cn('absolute left-1.5 top-5 w-2.5 h-px', accent.rail)} />
            </div>
            <div className={cn('flex-1 min-w-0', !last && 'pb-2')}>
              <SpvChartCard
                spv={spv}
                accent={accent}
                staff={showPeople ? staffByNode.get(spv.id) ?? [] : []}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── People ───────────────────────────────────────────────────────────────────

function StaffLines({ staff }: { staff: OrgPerson[] }) {
  return (
    <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-1.5">
      {staff.map((p) => (
        <StaffLine key={p.id} person={p} />
      ))}
    </div>
  )
}

/** Compact person row inside a division/SPV card. */
function StaffLine({ person }: { person: OrgPerson }) {
  if (person.status === 'open') {
    return (
      <p className="flex items-center gap-1.5 text-xs flex-wrap">
        <span className="flex items-center justify-center size-5 rounded-full border border-dashed border-amber-400/70 text-amber-600 dark:text-amber-400 shrink-0">
          <UserPlus size={9} />
        </span>
        <span className="font-medium">{person.role}</span>
        <Chip tone={OPEN_BADGE}>Open</Chip>
      </p>
    )
  }
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className={cn(
          'flex items-center justify-center size-5 rounded-full text-[9px] font-semibold shrink-0',
          personTone(person.name ?? ''),
        )}
      >
        {initialsOf(person.name ?? '')}
      </span>
      <p className="text-xs leading-snug min-w-0">
        <span className="font-medium">{person.name}</span>
        <span className="text-muted-foreground"> · {person.role}</span>
      </p>
    </div>
  )
}

/** Roster person with a full avatar + stacked name/role/detail. */
function RosterPerson({ person }: { person: OrgPerson }) {
  if (person.status === 'open') {
    return (
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex items-center justify-center size-7 rounded-full border border-dashed border-amber-400/70 text-amber-600 dark:text-amber-400 shrink-0">
          <UserPlus size={12} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight flex items-center gap-1.5 flex-wrap">
            {person.role} <Chip tone={OPEN_BADGE}>Open</Chip>
          </p>
          {person.detail && (
            <p className="text-xs text-muted-foreground/70 leading-snug mt-0.5">{person.detail}</p>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          'mt-0.5 flex items-center justify-center size-7 rounded-full text-[10px] font-semibold shrink-0',
          personTone(person.name ?? ''),
        )}
      >
        {initialsOf(person.name ?? '')}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{person.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{person.role}</p>
        {person.detail && (
          <p className="text-xs text-muted-foreground/70 leading-snug mt-0.5">{person.detail}</p>
        )}
      </div>
    </div>
  )
}

function LeadershipBand({ roster }: { roster: Record<'leadership' | 'director', OrgPerson[]> }) {
  return (
    <div className="mt-5 mx-auto max-w-3xl rounded-xl border border-border bg-card elev-1 overflow-hidden">
      <div className="px-4 py-2 border-b border-border bg-muted/30">
        <p className="label-caps text-muted-foreground">Leadership</p>
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4">
        {ORG_TIERS.map((tier) => {
          const list = roster[tier]
          if (list.length === 0) return null
          return (
            <div key={tier}>
              <p className="label-caps text-muted-foreground mb-2.5">{ORG_TIER_LABELS[tier]}</p>
              <div className="space-y-3">
                {list.map((p) => (
                  <RosterPerson key={p.id} person={p} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({ showPeople }: { showPeople: boolean }) {
  return (
    <div className="mt-8 flex justify-center">
      <div className="flex items-center justify-center flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-primary" /> Parent entity
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Chip tone={ORG_ENTITY_BADGE.series}>Series</Chip> internal capital
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Chip tone={ORG_ENTITY_BADGE.standalone}>Standalone</Chip> outside capital
        </span>
        {showPeople && (
          <span className="inline-flex items-center gap-1.5">
            <Chip tone={OPEN_BADGE}>Open</Chip> role to fill
          </span>
        )}
      </div>
    </div>
  )
}
