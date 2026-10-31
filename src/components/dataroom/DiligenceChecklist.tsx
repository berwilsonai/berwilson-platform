'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { isOpenStatus, type RoomStatus, type SectionStatus } from '@/lib/dataroom/status'
import SectionSignoff from './SectionSignoff'

/**
 * THE DILIGENCE CHECKLIST — nineteen sections, one line each.
 *
 * Richard, 2026-10-30: *"The checklist is a really important part of each
 * project. I would like it towards the top and displayed beautifully, cleanly
 * and clearly. maybe a collapsable section."*
 *
 * ⚠ WHAT MADE IT UNCLEAR WAS NOT THE STYLING, IT WAS THE DEPTH. The first
 * version gave every section its own Panel with all of its expected-document
 * lines rendered inline — **nineteen panels and 119 rows before you reach the
 * bottom**, with the one number you came for (how many are verified) scrolled
 * off. A checklist you cannot take in at a glance is not a checklist; it is a
 * document. So the 19 sections are now ONE line each and the 119 requirement
 * lines live behind each row's own disclosure, which is where detail belongs
 * when the summary is the point.
 *
 * Used in two places from one definition, because a checklist that disagrees
 * with itself between the Overview and its own tab is worse than one place to
 * look: `collapsible` folds it to its heading and progress bar for the
 * Overview, and it stands open on the Data room tab where it IS the content.
 */

function sectionTally(section: SectionStatus): { verified: boolean; stale: boolean } {
  return { verified: !!section.signoff, stale: !!section.signoff?.stale }
}

function GroupHeading({
  parentKey,
  label,
  sections,
}: {
  parentKey: string
  label: string
  sections: SectionStatus[]
}) {
  const verified = sections.filter((s) => s.signoff && !s.signoff.stale).length
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-1.5">
      <h3 className="label-caps text-muted-foreground">
        {parentKey} — {label}
      </h3>
      {/*
        The group's own tally, muted. Not a Chip: §12 — when every row is
        coloured, colour has stopped signifying, and three coloured group
        headers would compete with the one tone that means something (a stale
        tick on a row below).
      */}
      <span className="text-xs text-muted-foreground tabular-nums">
        {verified}/{sections.length}
      </span>
    </div>
  )
}

function ChecklistRow({
  section,
  recordKind,
  recordId,
}: {
  section: SectionStatus
  recordKind: 'project' | 'opportunity'
  recordId: string
}) {
  const [open, setOpen] = useState(false)
  const { verified, stale } = sectionTally(section)
  /**
   * ⚠ HUMAN-RECORDED ONLY — THE SAME BUG, ONE LEVEL DOWN. Counting derived
   * statuses made every row carry a number that was simply its own expected-
   * document count: `00.4 Financial Model` read "9 on file · 9 outstanding",
   * which reads as though the nine files were the problem. It is the identical
   * failure that had `openItems` reading 112 on every room in the portfolio —
   * a figure that is the same for everyone carries no information — and it
   * recurred because the rule was fixed in one reader and not in the shape.
   */
  const outstanding = section.rows.filter(
    (r) => !r.derived && isOpenStatus(String(r.status))
  ).length

  return (
    <li
      className={cn(
        'border-t border-border',
        // ⚠ A ring, never a background. `cn()` is tailwind-merge, so a stale
        // tint and the hover highlight would be in the same utility group and
        // the later one silently deletes the earlier (§12).
        stale && 'ring-1 ring-inset ring-caution/40'
      )}
    >
      <div className="flex items-start gap-3 px-4 py-2">
        <SectionSignoff
          recordKind={recordKind}
          recordId={recordId}
          sectionKey={section.section.key}
          sectionLabel={`${section.section.key} ${section.section.label}`}
          signoff={section.signoff}
          canSign
        />

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
        >
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {section.section.key}
            </span>
            <span className={cn('text-sm truncate', verified && 'text-muted-foreground')}>
              {section.section.label}
            </span>
            {section.section.optional && !verified ? (
              <span className="text-xs text-muted-foreground shrink-0">optional</span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <ChevronRight
              className={cn('size-3 transition-transform', open && 'rotate-90')}
              aria-hidden
            />
            {/*
              ⚠ The absence is named in words, never a bare dash — §12: a bare
              em dash at a value's own weight reads as a failed render.
            */}
            {section.documents.length === 0
              ? 'nothing on file'
              : `${section.documents.length} on file${section.drafts ? `, ${section.drafts} draft` : ''}`}
            {outstanding ? <span>· {outstanding} outstanding</span> : null}
          </span>
        </button>
      </div>

      {open ? (
        <div className="pb-3 pl-[3.4rem] pr-4">
          <ul className="space-y-1">
            {section.rows.map((row) => (
              <li key={row.expected} className="flex items-start gap-2 text-xs">
                <Chip
                  tone={
                    row.status === 'Missing' || row.status === 'Expired'
                      ? 'critical'
                      : row.derived
                        ? 'neutral'
                        : 'info'
                  }
                  className="shrink-0"
                >
                  {row.status}
                </Chip>
                <span className="min-w-0 text-muted-foreground">{row.expected}</span>
              </li>
            ))}
          </ul>
          {section.documents.length ? (
            <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
              {section.documents.map((d) => (
                <li key={d.id} className="flex items-start gap-2 text-xs">
                  {d.draft ? <Chip tone="caution">DRAFT</Chip> : null}
                  <span className="min-w-0 truncate">{d.fileName}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export default function DiligenceChecklist({
  status,
  collapsible = false,
  defaultOpen = true,
  href,
}: {
  status: RoomStatus
  /** Fold the whole thing to its heading and bar — for the Overview. */
  collapsible?: boolean
  defaultOpen?: boolean
  /** Where the heading links, when this is a summary of a fuller surface. */
  href?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const shown = collapsible ? open : true

  const parents: Array<[string, string]> = [
    ['00', 'Start Here'],
    ['01', 'Power & Property'],
    ['02', 'Capacity Commitment'],
  ]

  const pct = (n: number) => `${(n / Math.max(status.sectionCount, 1)) * 100}%`
  const outstanding = status.sectionCount - status.signedOff - status.staleSignoffs

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-baseline justify-between gap-3">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')}
                aria-hidden
              />
              <h2 className="label-caps text-muted-foreground">Diligence checklist</h2>
            </button>
          ) : (
            <h2 className="label-caps text-muted-foreground">Diligence checklist</h2>
          )}
          <p className="text-metric tabular-nums shrink-0">
            {status.signedOff}
            <span className="text-base text-muted-foreground"> / {status.sectionCount}</span>
          </p>
        </div>

        {/*
          Two bands, never one. §12: a stale tick is not progress, and summing
          it into the verified figure would overstate completeness in exactly
          the direction a diligence index must not.
        */}
        <div
          className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${status.signedOff} of ${status.sectionCount} sections verified${
            status.staleSignoffs ? `, ${status.staleSignoffs} needing a re-check` : ''
          }`}
        >
          <div className="bg-foreground" style={{ width: pct(status.signedOff) }} />
          <div className="bg-caution" style={{ width: pct(status.staleSignoffs) }} />
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          {status.signedOff === 0 && status.staleSignoffs === 0 ? (
            'Nothing verified yet. Tick a section once you have checked that what is in it is the right, current set.'
          ) : (
            <>
              {status.signedOff} verified
              {status.staleSignoffs ? (
                <span className="text-caution"> · {status.staleSignoffs} to re-check</span>
              ) : null}
              {outstanding ? ` · ${outstanding} outstanding` : null}
            </>
          )}
          {href ? (
            <>
              {' · '}
              <a
                href={href}
                className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
              >
                open the data room
              </a>
            </>
          ) : null}
        </p>
      </div>

      {shown
        ? parents.map(([key, label]) => {
            const sections = status.sections.filter((s) => s.section.parent === key)
            if (!sections.length) return null
            return (
              <div key={key}>
                <GroupHeading parentKey={key} label={label} sections={sections} />
                <ul>
                  {sections.map((s) => (
                    <ChecklistRow
                      key={s.section.key}
                      section={s}
                      recordKind={status.kind}
                      recordId={status.recordId}
                    />
                  ))}
                </ul>
              </div>
            )
          })
        : null}
    </Panel>
  )
}
