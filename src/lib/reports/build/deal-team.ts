/**
 * Deal Team & Relationships — who is on each deal, and where one person shows
 * up across the portfolio.
 *
 * Measured 2026-10-31: 176 player links over 440 contacts. This is the report
 * with the most real data in it, which is itself the finding — §12's standing
 * lesson is that the premise is usually wrong, and the premise here was that a
 * pipeline report would be the rich one.
 *
 * ⚠ BOTH DIRECTIONS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS. By deal is
 * "who is round the table on Steelton"; by person is "everywhere Sterling
 * touches us", which is the one that finds a counterparty quietly sitting on
 * both sides and the one a relationship map is for. Same rows, two groupings,
 * one read.
 *
 * ⚠ `role_key` SITS BESIDE `role`, NEVER REPLACING IT (§4). The registry key
 * is what groups and filters; the prose is what a person actually wrote and
 * carries facts no category can. Both are printed, and the prose is only
 * suppressed where it says the same thing as the label.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { contactRoleViews } from '@/lib/contacts/roles'
import { roleLabel } from '@/lib/utils/contact-roles'
import { STAGE_LABELS } from '@/lib/utils/constants'

import { type DealRegister, type DealRow } from '../deals'
import { toCell, type ReportData, type ReportRow, type RowGroup } from '../types'

interface PlayerRow {
  id: string
  project_id: string | null
  opportunity_id: string | null
  party_id: string
  role: string
  role_key: string | null
  is_primary: boolean | null
  notes: string | null
  party: {
    id: string
    full_name: string
    is_organization: boolean | null
    title: string | null
    company: string | null
    email: string | null
    phone: string | null
    merged_into_party_id: string | null
  } | null
}

const SELECT =
  'id, project_id, opportunity_id, party_id, role, role_key, is_primary, notes, ' +
  'party:parties(id, full_name, is_organization, title, company, email, phone, merged_into_party_id)'

export async function buildDealTeamReport(register: DealRegister): Promise<ReportData> {
  const supabase = createAdminClient()
  const [{ data, error }, roles] = await Promise.all([
    // PostgREST truncates at 1000 silently (§12). 176 rows is nowhere near it;
    // the explicit range keeps that a fact rather than an assumption.
    supabase.from('project_players').select(SELECT).range(0, 1999),
    contactRoleViews(),
  ])
  if (error) throw new Error(`Report could not read deal teams: ${error.message}`)

  const players = (data ?? []) as unknown as PlayerRow[]

  /*
   * ⚠ FILTERED TO THE REGISTER, WHICH IS WHERE CONTAINMENT LANDS. The register
   * has already dropped every confidential project, so a player row pointing at
   * one simply has no deal to attach to and falls out here. Reading
   * `project_players` without this join would put a protected deal's
   * counterparties into a document that leaves the building — the §12 shape
   * where a nullable second pointer breaks a security filter without touching
   * it, which is why the lookup is keyed on either column.
   */
  const dealById = new Map(register.deals.map((deal) => [deal.id, deal]))
  const linked = players
    .map((player) => {
      const dealId = player.project_id ?? player.opportunity_id
      const deal = dealId ? dealById.get(dealId) : undefined
      return deal && player.party ? { player, deal } : null
    })
    .filter((entry): entry is { player: PlayerRow; deal: DealRow } => entry !== null)

  const label = (player: PlayerRow): string =>
    player.role_key ? roleLabel(player.role_key, roles) : player.role

  /** The prose, unless it is just the label again. */
  const prose = (player: PlayerRow): string | null => {
    const written = player.role?.trim()
    if (!written) return null
    return written.toLowerCase() === label(player).toLowerCase() ? null : written
  }

  // ── By deal ────────────────────────────────────────────────────────────────
  const byDeal: RowGroup[] = register.deals
    .map((deal): RowGroup | null => {
      const own = linked.filter((entry) => entry.deal.id === deal.id)
      if (own.length === 0) return null
      return {
        label: deal.name,
        summary: `${STAGE_LABELS[deal.stage]} · ${own.length} ${own.length === 1 ? 'person' : 'people'}`,
        rows: own
          // Primaries first — the person to call is the point of the list.
          .sort((a, b) => Number(b.player.is_primary) - Number(a.player.is_primary))
          .map(({ player }): ReportRow => ({
            id: player.id,
            cells: {
              person: { value: player.party?.full_name ?? 'Unknown', href: `/contacts/${player.party_id}` },
              role: {
                value: label(player),
                tone: player.is_primary ? 'info' : undefined,
              },
              detail: prose(player),
              // An organization IS the company, so repeating the name here is
              // noise; a person with no company on file gets a blank, never an
              // em dash at a value's own weight (§12).
              company: player.party?.is_organization ? null : player.party?.company ?? null,
              title: player.party?.title ?? null,
              email: player.party?.email ?? null,
              phone: player.party?.phone ?? null,
            },
          })),
      }
    })
    .filter((group): group is RowGroup => group !== null)

  // ── By person ──────────────────────────────────────────────────────────────
  const byParty = new Map<string, { player: PlayerRow; deal: DealRow }[]>()
  for (const entry of linked) {
    const list = byParty.get(entry.player.party_id)
    if (list) list.push(entry)
    else byParty.set(entry.player.party_id, [entry])
  }

  const people: ReportRow[] = [...byParty.entries()]
    .map(([partyId, entries]): ReportRow => {
      const party = entries[0].player.party
      const uniqueRoles = [...new Set(entries.map(({ player }) => label(player)))]
      return {
        id: partyId,
        cells: {
          person: { value: party?.full_name ?? 'Unknown', href: `/contacts/${partyId}` },
          kind: party?.is_organization ? 'Organization' : 'Person',
          company: party?.company ?? null,
          title: party?.title ?? null,
          roles: uniqueRoles.join(', '),
          deals: {
            value: entries.length,
            // Somebody on four deals is a relationship; somebody on one is a
            // contact. Flagging it is the whole reason this grouping exists.
            tone: entries.length >= 3 ? 'info' : undefined,
          },
          on: entries.map(({ deal }) => deal.name).join(', '),
        },
      }
    })
    .sort((a, b) => {
      // ⚠ READ THROUGH `toCell`, NOT `String(cell)`. `person` is a dressed cell
      // carrying an href, so stringifying it gives "[object Object]" for every
      // row — a tiebreak that silently does nothing and looks like it works.
      const count = (row: ReportRow) => Number(toCell(row.cells.deals).value ?? 0)
      const name = (row: ReportRow) => String(toCell(row.cells.person).value ?? '')
      return count(b) - count(a) || name(a).localeCompare(name(b))
    })

  const dealsWithTeam = byDeal.length
  const organizations = [...byParty.values()].filter(
    (entries) => entries[0].player.party?.is_organization
  ).length

  return {
    title: 'Deal Team & Relationships',
    subtitle: 'Who is on each deal, and everywhere one name appears across the portfolio',
    coverage: `${linked.length} role${linked.length === 1 ? '' : 's'} across ${dealsWithTeam} of ${register.deals.length} deals${
      register.withheld > 0 ? `. ${register.withheld} protected deal(s) withheld.` : ''
    }`,
    withheld: register.withheld,
    sections: [
      {
        kind: 'stats',
        title: 'The network',
        stats: [
          {
            label: 'People & organizations',
            value: String(byParty.size),
            hint: `${byParty.size - organizations} people · ${organizations} organizations`,
          },
          {
            label: 'Roles filled',
            value: String(linked.length),
            hint: 'one person on one deal in one role',
          },
          {
            label: 'Deals with a team',
            value: `${dealsWithTeam} of ${register.deals.length}`,
            hint:
              dealsWithTeam < register.deals.length
                ? `${register.deals.length - dealsWithTeam} deals have nobody attached`
                : 'every deal has somebody attached',
            tone: dealsWithTeam < register.deals.length ? 'caution' : 'positive',
          },
          {
            label: 'On three or more deals',
            value: String(
              [...byParty.values()].filter((entries) => entries.length >= 3).length
            ),
            hint: 'the relationships that span the portfolio',
            tone: 'info',
          },
        ],
      },
      {
        kind: 'table',
        title: 'By person',
        description: 'Everyone attached to a deal, most-connected first.',
        columns: [
          { key: 'person', label: 'Name', format: 'text', width: 28 },
          { key: 'kind', label: 'Type', format: 'text', width: 14 },
          { key: 'title', label: 'Title', format: 'text', width: 24 },
          { key: 'company', label: 'Company', format: 'text', width: 26 },
          { key: 'roles', label: 'Roles', format: 'text', width: 30 },
          { key: 'deals', label: 'Deals', format: 'number', total: true },
          { key: 'on', label: 'On', format: 'text', width: 46 },
        ],
        rows: people,
        empty: 'Nobody is attached to a deal yet.',
      },
      {
        kind: 'table',
        title: 'By deal',
        description: 'The table on each deal, the primary contact first.',
        columns: [
          { key: 'person', label: 'Name', format: 'text', width: 28 },
          { key: 'role', label: 'Role', format: 'text', width: 22 },
          { key: 'detail', label: 'As written', format: 'text', width: 30 },
          { key: 'title', label: 'Title', format: 'text', width: 24 },
          { key: 'company', label: 'Company', format: 'text', width: 26 },
          /*
           * ⚠ CONTACT DETAILS ARE INTERNAL. A deal team sheet that walks out of
           * the building with everybody's direct line on it is a different
           * document from the one Richard asked for, and the audience filter is
           * the only thing standing between the two.
           */
          { key: 'email', label: 'Email', format: 'text', width: 28, internal: true },
          { key: 'phone', label: 'Phone', format: 'text', width: 18, internal: true },
        ],
        groups: byDeal,
        empty: 'No deal has a team attached yet.',
      },
    ],
  }
}
