import Link from 'next/link'
import { ExternalLink, FileText, FolderOpen } from 'lucide-react'

import { Chip } from '@/components/ui/chip'
import { Panel, PanelHeader } from '@/components/ui/card'
import { StatTile } from '@/components/ui/stat'
import { folderUrl } from '@/lib/integrations/google-drive-write'
import DriveImportButton from '@/components/shared/DriveImportButton'
import { isOpenStatus, type RoomStatus, type SectionStatus } from '@/lib/dataroom/status'
import SectionSignoff from './SectionSignoff'
import type { Tone } from '@/lib/ui/tone'

/**
 * The data room, read from the platform's side.
 *
 * The same answer `00.2` publishes to Drive, rendered for whoever is working the
 * deal rather than for the partner reading it. Both come from `readRoomStatus`,
 * so the two cannot disagree — §12's one quantity, one definition, which this
 * codebase has broken three times on exactly this kind of surface.
 *
 * A reading surface, deliberately: nothing here mutates. Setting a status, a
 * counterparty or a deadline is the Diligence tab's job, which already writes
 * `dd_items` and which these rows are drawn from.
 */

/**
 * ⚠ A STATUS TONE IS A NAME, NEVER A CLASS STRING, and the map is exhaustive
 * over Richard's vocabulary with a neutral fallback for a value somebody typed.
 * §12, 10-29: a tone typed `string` let `amber` through, which `Chip` passes
 * along as class names, so it rendered unstyled and green.
 */
const STATUS_TONE: Record<string, Tone> = {
  Missing: 'critical',
  Expired: 'critical',
  Requested: 'caution',
  Draft: 'caution',
  'Signed—Conditional': 'caution',
  'In Progress': 'info',
  Effective: 'positive',
  Final: 'positive',
  Approved: 'positive',
  'Not Applicable': 'neutral',
}

function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'neutral'
}

function SectionBlock({
  section,
  recordKind,
  recordId,
}: {
  section: SectionStatus
  recordKind: 'project' | 'opportunity'
  recordId: string
}) {
  const { section: meta, documents, drafts, rows } = section
  const open = rows.filter((r) => isOpenStatus(String(r.status))).length

  return (
    <Panel className="p-0 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
        <SectionSignoff
          recordKind={recordKind}
          recordId={recordId}
          sectionKey={meta.key}
          sectionLabel={`${meta.key} ${meta.label}`}
          signoff={section.signoff}
          canSign
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <span className="text-muted-foreground tabular-nums">{meta.key}</span>
            <span className="truncate">{meta.label}</span>
            {meta.optional ? <Chip tone="neutral">optional</Chip> : null}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {documents.length === 0
              ? 'Nothing on file'
              : `${documents.length} on file${drafts ? `, ${drafts} draft` : ''}`}
            {open ? ` · ${open} outstanding` : null}
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.expected} className="px-4 py-2.5 flex items-start gap-3">
            <Chip tone={statusTone(String(row.status))} className="shrink-0 mt-0.5">
              {row.status}
            </Chip>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{row.expected}</p>
              {/*
                ⚠ WHERE THE STATUS CAME FROM IS PART OF THE STATUS. "Missing"
                because nobody has looked is a different claim from "Missing"
                because somebody checked and recorded it, and a diligence index
                that cannot tell them apart invites the reader to trust the
                first as if it were the second.
              */}
              {row.derived ? (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Read from the folder — nobody has recorded a decision
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {[
                    row.responsible && `Owner: ${row.responsible}`,
                    row.counterparty && `With: ${row.counterparty}`,
                    row.expiresOn && `Expires ${row.expiresOn}`,
                    row.dueDate && `Due ${row.dueDate}`,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Recorded by a person'}
                </p>
              )}
              {row.outstandingAction ? (
                <p className="text-xs text-caution mt-1">{row.outstandingAction}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {documents.length ? (
        <details className="border-t border-border">
          <summary className="px-4 py-2 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            <FileText className="inline size-3.5 mr-1.5 -mt-0.5" />
            {documents.length} document{documents.length === 1 ? '' : 's'} on file
          </summary>
          <ul className="px-4 pb-3 space-y-1.5">
            {documents.map((doc) => (
              <li key={doc.id} className="text-xs flex items-start gap-2">
                {doc.draft ? <Chip tone="caution">DRAFT</Chip> : null}
                <span className="min-w-0 truncate">{doc.fileName}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  )
}

export default function DataRoomView({ status }: { status: RoomStatus }) {
  const parents = ['00', '01', '02']
  const label: Record<string, string> = {
    '00': 'Start Here',
    '01': 'Power & Property',
    '02': 'Capacity Commitment',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-medium">Data room</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            The uniform diligence index every deal on this template carries. The same answer is
            published into the deal&rsquo;s Drive folder as{' '}
            <span className="whitespace-nowrap">00.2 — Master Document Index</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/*
            Drive is the source of truth, so "pull it in now" belongs beside the
            room rather than only on the Documents tab. The nightly sync is
            03:15 and the hourly watch runs 08:20–18:20; this is for wanting it
            before then — a file dragged into its section at 19:00, say.
          */}
          {status.driveFolderId ? (
            <DriveImportButton projectId={status.recordId} recordKind={status.kind} />
          ) : null}
        {status.driveFolderId ? (
          <Link
            href={folderUrl(status.driveFolderId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-foreground elev-1 text-background text-sm font-medium hover:bg-foreground/90 transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <FolderOpen className="size-4" />
            Open the room
            <ExternalLink className="size-3.5 opacity-70" />
          </Link>
        ) : null}
        </div>
      </div>

      {/*
        THE COMPLETION INDICATOR — the answer to "where are we and what is
        outstanding".

        ⚠ SIGNED-OFF AND STALE ARE DRAWN APART AND NEVER SUMMED. A stale tick is
        not progress: somebody verified a set of documents that has since
        changed. Summing them would overstate completeness in exactly the
        direction a diligence index must not, and §12 is explicit that two
        different quantities must be named apart and never added.
      */}
      <Panel>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <PanelHeader label="Sections verified" />
          <p className="text-metric tabular-nums">
            {status.signedOff}
            <span className="text-muted-foreground text-base"> / {status.sectionCount}</span>
          </p>
        </div>
        <div
          className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${status.signedOff} of ${status.sectionCount} sections verified${
            status.staleSignoffs ? `, ${status.staleSignoffs} needing a re-check` : ''
          }`}
        >
          <div
            className="bg-foreground"
            style={{ width: `${(status.signedOff / Math.max(status.sectionCount, 1)) * 100}%` }}
          />
          <div
            className="bg-caution"
            style={{ width: `${(status.staleSignoffs / Math.max(status.sectionCount, 1)) * 100}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {status.signedOff === 0 && status.staleSignoffs === 0
            ? 'Nothing verified yet. Tick a section once you have checked that what is in it is the right, current set.'
            : [
                `${status.signedOff} verified`,
                status.staleSignoffs
                  ? `${status.staleSignoffs} needing a re-check since documents changed`
                  : null,
                `${status.sectionCount - status.signedOff - status.staleSignoffs} outstanding`,
              ]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </Panel>

      {/*
        ⚠ EVERY TILE IS A DIFFERENT QUANTITY AND IS NAMED APART. §12: three
        "needs attention" numbers on one screen read 1, 99+ and 197. These four
        never sum to anything and must not look as though they do — which is
        why `_Unsorted` is the only one that ever takes a tone.
      */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Filed into a section" value={status.filed} />
        <StatTile
          label="Awaiting a filing decision"
          value={status.unsorted}
          tone={status.unsorted ? 'caution' : 'default'}
          hint="In 00.0 — _Unsorted. No rule could place these; move one in Drive and it files itself."
        />
        <StatTile
          label="Sections with nothing on file"
          value={status.emptySections}
          hint="Out of 19. An optional section does not count."
        />
        {/*
          ⚠ TWO QUANTITIES, NAMED APART, NEVER SUMMED. One number tried to carry
          both and read 112 on every room in the portfolio — Riverdale with 39
          documents, Steelton with 159 and GridEdge with none — because every
          requirement with no recorded decision derives as outstanding. What a
          person has actually judged outstanding is the number worth a tile; the
          derived gap is `emptySections` beside it.
        */}
        <StatTile
          label="Outstanding items you have recorded"
          value={status.openItems}
          empty="None recorded yet"
          hint="Including a condition still unresolved inside an agreement already signed — which is the thing a lender reads first. Set these on the Diligence tab."
        />
      </div>

      {status.working || status.notInDrive || status.outsideTemplate ? (
        <Panel>
          <PanelHeader label="Not part of the diligence index" />
          <ul className="text-sm text-muted-foreground space-y-1">
            {status.working ? (
              <li>
                {status.working} in Correspondence, Meetings or Proposals &amp; Bids — working
                files, kept beside the room rather than inside it
              </li>
            ) : null}
            {status.notInDrive ? (
              <li>{status.notInDrive} on the record but not in Drive at all</li>
            ) : null}
            {status.outsideTemplate ? (
              <li>
                {status.outsideTemplate} in a Drive folder outside the template — move them in
                Drive, or they stay invisible to this index
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      {parents.map((parent) => {
        const sections = status.sections.filter((s) => s.section.parent === parent)
        if (!sections.length) return null
        return (
          <section key={parent} className="space-y-3">
            <h3 className="label-caps text-muted-foreground">
              {parent} — {label[parent]}
            </h3>
            <div className="grid gap-3">
              {sections.map((s) => (
                <SectionBlock
                  key={s.section.key}
                  section={s}
                  recordKind={status.kind}
                  recordId={status.recordId}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
