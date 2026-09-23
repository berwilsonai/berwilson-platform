import Link from 'next/link'
import { Building2, Star, User, Users } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'
import AddPlayerModal from '@/components/projects/AddPlayerModal'
import RemovePlayerButton from '@/components/projects/RemovePlayerButton'
import EditRoleButton from '@/components/projects/EditRoleButton'
import type { RecordKind } from '@/lib/records/scope'

/**
 * The people on a record — the same table for a project and an opportunity,
 * reading the one `project_players` table through whichever scope column is
 * set. Rendered server-side; the add/edit/remove controls are the existing
 * client components.
 */

export type PlayerRow = {
  id: string
  role: string
  is_primary: boolean | null
  notes: string | null
  parties: {
    id: string
    full_name: string
    company: string | null
    title: string | null
    email: string | null
    phone: string | null
    is_organization: boolean | null
  } | null
}

interface RecordPlayersProps {
  recordKind: RecordKind
  recordId: string
  players: PlayerRow[]
  /**
   * Project managers get a read-only view: names, roles and contact details so
   * they can reach the people they work with — no profile links, no editing.
   */
  limited: boolean
}

export default function RecordPlayers({ recordKind, recordId, players, limited }: RecordPlayersProps) {
  const noun = recordKind === 'opportunity' ? 'deal' : 'project'

  if (players.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No players yet"
        description={`Add the key people and organizations involved in this ${noun}.`}
        action={
          limited ? undefined : (
            <div className="flex items-center gap-2">
              <AddPlayerModal recordKind={recordKind} recordId={recordId} />
              <Link
                href={`/contacts/new`}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors"
              >
                Create New Contact
              </Link>
            </div>
          )
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {players.length} player{players.length !== 1 ? 's' : ''} on this {noun}
        </p>
        {!limited && <AddPlayerModal recordKind={recordKind} recordId={recordId} />}
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                Name
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">
                Company
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">
                Role
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">
                Contact
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {players.map(player => {
              const party = player.parties
              if (!party) return null
              return (
                <tr key={player.id} className="group hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="size-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                        {party.is_organization ? (
                          <Building2 size={13} className="text-muted-foreground" />
                        ) : (
                          <User size={13} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        {limited ? (
                          <span className="font-medium truncate block">{party.full_name}</span>
                        ) : (
                          <Link
                            href={`/contacts/${party.id}`}
                            className="font-medium hover:underline truncate block"
                          >
                            {party.full_name}
                          </Link>
                        )}
                        {party.title && (
                          <p className="text-xs text-muted-foreground truncate sm:hidden">
                            {party.title}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {party.company ? (
                      <span className="text-sm text-muted-foreground">{party.company}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                        {player.role}
                      </span>
                      {player.is_primary && (
                        <Star
                          size={11}
                          className="text-amber-500 dark:text-amber-400 fill-amber-400 shrink-0"
                          aria-label="Primary contact"
                        />
                      )}
                      {!limited && (
                        <EditRoleButton
                          playerId={player.id}
                          currentRole={player.role}
                          playerName={party.full_name}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {party.email ? (
                      <a
                        href={`mailto:${party.email}`}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {party.email}
                      </a>
                    ) : party.phone ? (
                      <a
                        href={`tel:${party.phone}`}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {party.phone}
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!limited && <RemovePlayerButton playerId={player.id} playerName={party.full_name} />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
