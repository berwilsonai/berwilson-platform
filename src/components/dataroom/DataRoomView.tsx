import Link from 'next/link'
import { ExternalLink, FolderOpen } from 'lucide-react'

import { Panel, PanelHeader } from '@/components/ui/card'
import { StatTile } from '@/components/ui/stat'
import { folderUrl } from '@/lib/integrations/google-drive-write'
import DriveImportButton from '@/components/shared/DriveImportButton'
import type { RoomStatus } from '@/lib/dataroom/status'
import DiligenceChecklist from './DiligenceChecklist'

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

export default function DataRoomView({ status }: { status: RoomStatus }) {
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
        ⚠ THE CHECKLIST IS FIRST, AND THAT IS THE WHOLE POINT OF THE TAB.
        Richard, 10-30: *"The checklist is a really important part of each
        project. I would like it towards the top."* It was below a progress
        panel and four stat tiles, so the nineteen rows a person came to work
        opened below the fold. The counts are a readout ABOUT the checklist;
        they belong under it.
      */}
      <DiligenceChecklist status={status} />

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

    </div>
  )
}
