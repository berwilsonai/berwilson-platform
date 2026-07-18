import { ChevronDown, ChevronRight, Building2, Landmark, Info } from 'lucide-react'
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
 */

const OPEN_BADGE =
  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30'

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
          <div className="mx-auto h-6 w-px bg-border" />
          <div className="flex justify-center items-start">
            {divisions.map((division, i) => {
              const spvs = spvsByDivision.get(division.id) ?? []
              const expanded = isExpanded(division.id)
              return (
                <div key={division.id} className="flex flex-col w-60 px-2">
                  <TopConnector first={i === 0} last={i === divisions.length - 1} />
                  <DivisionChartCard
                    division={division}
                    spvCount={spvs.length}
                    expanded={expanded}
                    staff={showPeople ? staffByNode.get(division.id) ?? [] : []}
                    onToggle={onToggleDivision ? () => onToggleDivision(division.id) : undefined}
                  />
                  {expanded && spvs.length > 0 && (
                    <SpvRail
                      spvs={spvs}
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
    <div className="w-60 rounded-xl border border-border bg-card elev-1 p-3.5">
      <div className="flex items-start gap-2.5">
        <Icon size={16} className="text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{arm.name}</p>
          {arm.entity_type && <Chip className="mt-1">{arm.entity_type}</Chip>}
          {arm.note && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{arm.note}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ManagementChartCard({ node }: { node: OrgNode }) {
  return (
    <div className="w-60 rounded-xl border border-dashed border-border bg-card/50 p-3.5">
      <div className="flex items-start gap-2.5">
        <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight text-muted-foreground">{node.name}</p>
          {node.note && (
            <p className="text-xs text-muted-foreground/80 mt-1.5 leading-snug">{node.note}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function DivisionChartCard({
  division,
  spvCount,
  expanded,
  staff,
  onToggle,
}: {
  division: OrgNode
  spvCount: number
  expanded: boolean
  staff: OrgPerson[]
  onToggle?: () => void
}) {
  const entityType = orgEntityType(division.entity_type)
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {division.vertical && (
            <p className="label-caps text-muted-foreground">{division.vertical}</p>
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
    </>
  )

  if (onToggle) {
    return (
      <button
        onClick={onToggle}
        className="w-full text-left rounded-xl border border-border bg-card elev-1 p-3 lift"
      >
        {body}
      </button>
    )
  }
  return <div className="rounded-xl border border-border bg-card elev-1 p-3">{body}</div>
}

function SpvChartCard({
  spv,
  staff,
}: {
  spv: OrgNode
  staff: OrgPerson[]
}) {
  const entityType = orgEntityType(spv.entity_type)
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
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
  )
}

/** Vertical rail of SPVs under a division card, with elbow connectors. */
function SpvRail({
  spvs,
  staffByNode,
  showPeople,
}: {
  spvs: OrgNode[]
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
                  'absolute left-1.5 w-px bg-border',
                  i === 0 ? '-top-2' : 'top-0',
                  last ? 'h-[calc(1.25rem+0.5rem)]' : 'bottom-0',
                )}
              />
              {/* horizontal stub into the card */}
              <div className="absolute left-1.5 top-5 w-2.5 h-px bg-border" />
            </div>
            <div className={cn('flex-1 min-w-0', !last && 'pb-2')}>
              <SpvChartCard spv={spv} staff={showPeople ? staffByNode.get(spv.id) ?? [] : []} />
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
    <div className="mt-2 pt-2 border-t border-border/60 space-y-1">
      {staff.map((p) => (
        <PersonLine key={p.id} person={p} />
      ))}
    </div>
  )
}

function PersonLine({ person }: { person: OrgPerson }) {
  if (person.status === 'open') {
    return (
      <p className="text-xs flex items-center gap-1.5 flex-wrap">
        <span className="font-medium">{person.role}</span>
        <Chip tone={OPEN_BADGE}>Open</Chip>
      </p>
    )
  }
  return (
    <p className="text-xs leading-snug">
      <span className="font-medium">{person.name}</span>
      <span className="text-muted-foreground"> — {person.role}</span>
    </p>
  )
}

function LeadershipBand({ roster }: { roster: Record<'leadership' | 'director', OrgPerson[]> }) {
  return (
    <div className="mt-4 mx-auto max-w-2xl rounded-xl border border-border bg-card elev-1 p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
        {ORG_TIERS.map((tier) => {
          const list = roster[tier]
          if (list.length === 0) return null
          return (
            <div key={tier}>
              <p className="label-caps text-muted-foreground mb-1.5">{ORG_TIER_LABELS[tier]}</p>
              <div className="space-y-1.5">
                {list.map((p) => (
                  <div key={p.id}>
                    <PersonLine person={p} />
                    {p.detail && (
                      <p className="text-xs text-muted-foreground/70 leading-snug mt-0.5">
                        {p.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
