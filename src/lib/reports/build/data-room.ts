/**
 * Data Room Readiness — how full each diligence room is, and what is missing.
 *
 * ⚠ TWO QUANTITIES, NAMED APART AND NEVER SUMMED. `readRoomStatus` already
 * learned this the hard way and its own comments carry the measurement:
 * counting derived statuses as "open" gave **112 on every single room** —
 * Riverdale with 39 documents, Steelton with 159 and GridEdge with none all
 * read 112 — because a requirement nobody has touched derives to `Missing`,
 * and 119 minus the 7 optional ones is 112 for everybody forever. §12: when
 * every row is red, red has stopped signifying.
 *
 * So this report reads the two figures that actually move:
 *   · `signedOff` — sections a human ticked, over `sectionCount`. The
 *     completion fraction, and the only one that means somebody looked.
 *   · `emptySections` — shelves with nothing on them at all. The work queue.
 *
 * ⚠ AND A SIGN-OFF GOES STALE RATHER THAN WRONG. It is a statement about a
 * SET, fingerprinted, so an add, a removal or a REPLACEMENT un-ticks it — a
 * draft swapped for an executed copy is exactly the change a count would miss.
 * `staleSignoffs` is reported in its own column, never folded into `signedOff`.
 */

import { readRoomStatus, type RoomStatus } from '@/lib/dataroom/status'
import { STAGE_LABELS } from '@/lib/utils/constants'
import { phaseLookup, powerTotal } from '@/lib/records/power'

import { type DealRegister, type DealRow } from '../deals'
import type { NoteSection, ReportData, ReportRow, RowGroup, TableSection } from '../types'

/**
 * How many rooms are read at once.
 *
 * Each `readRoomStatus` is four queries, so sixteen rooms unbounded is
 * sixty-four concurrent requests at Kong — which is how a report page becomes
 * the thing that takes the platform down. Six at a time keeps the whole report
 * well inside a second on the measured corpus.
 */
const CONCURRENCY = 6

async function readRooms(deals: DealRow[]): Promise<Map<string, RoomStatus>> {
  const out = new Map<string, RoomStatus>()
  for (let at = 0; at < deals.length; at += CONCURRENCY) {
    const batch = deals.slice(at, at + CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (deal) => {
        try {
          return [deal.id, await readRoomStatus(deal.kind, deal.id)] as const
        } catch (error) {
          /*
           * ⚠ ONE UNREADABLE ROOM MUST NOT 500 THE REPORT. The room is read
           * from Drive-derived paths, and a record whose folder was moved or
           * revoked throws. Sixteen rooms where fifteen are fine is a report
           * with a named gap; a thrown error is no report at all, and the
           * reader cannot tell which room caused it.
           */
          console.error(`[reports/data-room] ${deal.kind} ${deal.id} unreadable:`, error)
          return [deal.id, null] as const
        }
      })
    )
    for (const [id, status] of results) {
      if (status) out.set(id, status)
    }
  }
  return out
}

export async function buildDataRoomReport(register: DealRegister): Promise<ReportData> {
  /*
   * ⚠ ONLY THE `data_center` TEMPLATE HAS A ROOM TO BE READY. `readRoomStatus`
   * returns null for a `standard` record by design, so filtering here is not an
   * optimisation — it is what stops the report listing nineteen deals with an
   * empty fraction beside each and implying they are behind.
   */
  const roomDeals = register.deals.filter((deal) => deal.dataRoomTemplate === 'data_center')
  const rooms = await readRooms(roomDeals)
  const phasesOf = phaseLookup(register.phases)

  const withRoom = roomDeals
    .map((deal) => ({ deal, room: rooms.get(deal.id) }))
    .filter((entry): entry is { deal: DealRow; room: RoomStatus } => entry.room !== undefined)

  const totals = withRoom.reduce(
    (acc, { room }) => ({
      sections: acc.sections + room.sectionCount,
      signedOff: acc.signedOff + room.signedOff,
      stale: acc.stale + room.staleSignoffs,
      empty: acc.empty + room.emptySections,
      filed: acc.filed + room.filed,
      unsorted: acc.unsorted + room.unsorted,
      working: acc.working + room.working,
      notInDrive: acc.notInDrive + room.notInDrive,
    }),
    { sections: 0, signedOff: 0, stale: 0, empty: 0, filed: 0, unsorted: 0, working: 0, notInDrive: 0 }
  )

  const rows: ReportRow[] = withRoom
    .map(({ deal, room }): ReportRow => ({
      id: deal.id,
      cells: {
        name: { value: deal.name, href: deal.href },
        stage: STAGE_LABELS[deal.stage],
        capacity: powerTotal([...phasesOf(deal.id)]).megawatts,
        // ⚠ A FRACTION, NOT A PERCENTAGE. "11 of 19" says what the denominator
        // is; "58%" invites the reader to compare two rooms whose templates
        // could differ. The numeric value behind it is the signed-off count, so
        // the column still sums and sorts in Excel.
        verified: {
          value: room.signedOff,
          label: `${room.signedOff} of ${room.sectionCount}`,
          tone: room.signedOff === room.sectionCount ? 'positive' : room.signedOff === 0 ? 'neutral' : 'info',
        },
        stale: room.staleSignoffs > 0 ? { value: room.staleSignoffs, tone: 'caution' } : 0,
        /*
         * ⚠ THE COLOUR MARKS PROGRESS, NOT THE BASELINE — AND THE FIRST
         * VERSION HAD IT THE OTHER WAY UP. It painted anything over 12 empty
         * shelves critical, which on the real corpus is 15 of 17 rooms: a
         * column of identical red 18s, which is §12's *"when every row is red,
         * red has stopped signifying"* arriving verbatim in the first
         * screenshot. Nothing in that column told you which room to open.
         *
         * Most rooms being nearly empty is the BASELINE here, so the
         * information is the handful that are not. Untouched rooms stay plain
         * and the sort (least ready first) carries the ranking; a room with
         * real progress gets the colour.
         */
        empty: {
          value: room.emptySections,
          tone:
            room.emptySections === 0
              ? 'positive'
              : room.emptySections <= 5
                ? 'caution'
                : undefined,
        },
        filed: room.filed,
        unsorted: room.unsorted > 0 ? { value: room.unsorted, tone: 'caution' } : 0,
      },
      detail:
        room.notInDrive > 0
          ? `${room.notInDrive} document${room.notInDrive === 1 ? '' : 's'} on the record with no Drive path`
          : undefined,
    }))
    // Least ready first. The report's job is to say where the work is, and a
    // list sorted by name buries the empty room among the finished ones.
    .sort((a, b) => Number(cellNumber(b, 'empty')) - Number(cellNumber(a, 'empty')))

  /*
   * The gap list: every empty shelf, by deal. This is the report's actual
   * output — a reader does not want "Riverdale is 13 short", they want the
   * thirteen names so they can go and ask for them.
   */
  const gapGroups: RowGroup[] = withRoom
    .map(({ deal, room }): RowGroup | null => {
      const empty = room.sections.filter((section) => section.missing)
      if (empty.length === 0) return null
      return {
        label: deal.name,
        tone: 'caution',
        summary: `${empty.length} of ${room.sectionCount} shelves empty`,
        rows: empty.map((section): ReportRow => ({
          id: `${deal.id}-${section.section.key}`,
          cells: {
            section: `${section.section.key} — ${section.section.label}`,
            expects: section.section.expects?.join('; ') ?? null,
            responsible: section.rows.find((row) => row.responsible)?.responsible ?? null,
          },
        })),
      }
    })
    .filter((group): group is RowGroup => group !== null)

  const standard = register.deals.length - roomDeals.length

  return {
    title: 'Data Room Readiness',
    subtitle: 'What each diligence room holds, what is verified, and what is still missing',
    coverage: `${withRoom.length} deal${withRoom.length === 1 ? '' : 's'} on the data-centre room template${
      standard > 0 ? `. ${standard} deals use the standard filing scheme and have no 19-section room.` : ''
    }${register.withheld > 0 ? ` ${register.withheld} protected deal(s) withheld.` : ''}`,
    withheld: register.withheld,
    sections: [
      {
        kind: 'stats',
        title: 'Across every room',
        stats: [
          {
            label: 'Verified',
            value: totals.sections > 0 ? `${totals.signedOff} of ${totals.sections}` : null,
            empty: 'No rooms built',
            hint: 'sections a person has ticked, over every section on every room',
            tone: totals.signedOff === 0 ? 'caution' : undefined,
          },
          {
            label: 'Empty shelves',
            value: String(totals.empty),
            hint: 'sections with nothing filed and no decision recorded',
            tone: totals.empty > 0 ? 'caution' : 'positive',
          },
          {
            label: 'Documents filed',
            value: totals.filed.toLocaleString('en-US'),
            hint: `${totals.working.toLocaleString('en-US')} more in working folders`,
          },
          {
            label: 'Needs sorting',
            value: totals.unsorted > 0 ? String(totals.unsorted) : null,
            empty: 'Nothing unsorted',
            hint: 'landed in 00.0 — the classifier could not place them',
            tone: totals.unsorted > 0 ? 'caution' : 'positive',
          },
        ],
      },
      ...(totals.stale > 0
        ? [
            {
              kind: 'note' as const,
              title: `${totals.stale} sign-off${totals.stale === 1 ? '' : 's'} went stale`,
              body: 'A sign-off records the exact set of documents somebody looked at. Adding, removing or replacing one — a draft swapped for an executed copy — makes the tick stale rather than wrong, and it needs re-ticking before it means anything.',
              tone: 'caution' as const,
            } satisfies NoteSection,
          ]
        : []),
      {
        kind: 'table',
        title: 'Room by room',
        columns: [
          { key: 'name', label: 'Deal', format: 'text', width: 32 },
          { key: 'stage', label: 'Stage', format: 'text', width: 16 },
          { key: 'capacity', label: 'Capacity', format: 'mw' },
          { key: 'verified', label: 'Verified', format: 'text', width: 14 },
          { key: 'stale', label: 'Stale', format: 'number', total: true },
          { key: 'empty', label: 'Empty shelves', format: 'number', total: true },
          { key: 'filed', label: 'Filed', format: 'number', total: true },
          { key: 'unsorted', label: 'Unsorted', format: 'number', total: true },
        ],
        rows,
        totals: rows.length > 0,
        empty: 'No deal is on the data-centre room template yet.',
      },
      ...(gapGroups.length > 0
        ? [
            {
              kind: 'table' as const,
              title: 'What is missing',
              description: 'Every shelf with nothing on it, and what belongs there.',
              columns: [
                { key: 'section', label: 'Section', format: 'text' as const, width: 38 },
                { key: 'expects', label: 'Expects', format: 'text' as const, width: 52 },
                { key: 'responsible', label: 'Responsible', format: 'text' as const, width: 20 },
              ],
              groups: gapGroups,
            } satisfies TableSection,
          ]
        : []),
    ],
  }
}

/** A numeric cell's value, for sorting. Cells may be bare or dressed. */
function cellNumber(row: ReportRow, key: string): number {
  const cell = row.cells[key]
  if (typeof cell === 'number') return cell
  if (cell && typeof cell === 'object' && typeof cell.value === 'number') return cell.value
  return 0
}
