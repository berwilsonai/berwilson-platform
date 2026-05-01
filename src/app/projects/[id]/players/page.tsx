import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, Star, User, UserPlus, Users } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import EmptyState from '@/components/shared/EmptyState'

interface PageProps {
  params: Promise<{ id: string }>
}

type PlayerRow = {
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

export default async function PlayersPage({ params }: PageProps) {
  const { id: projectId } = await params
  const supabase = createAdminClient()

  // Verify project exists
  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()

  if (!project) notFound()

  const { data, error } = await supabase
    .from('project_players')
    .select(`
      id, role, is_primary, notes,
      parties(id, full_name, company, title, email, phone, is_organization)
    `)
    .eq('project_id', projectId)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(`Failed to load players: ${error.message}`)

  const players = (data as PlayerRow[]) ?? []

  if (players.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No players yet"
        description="Add the key people and organizations involved in this project."
        action={
          <Link
            href={`/contacts/new`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <UserPlus size={14} />
            Add Contact
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {players.length} player{players.length !== 1 ? 's' : ''} on this project
        </p>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {players.map(player => {
              const party = player.parties
              if (!party) return null
              return (
                <tr key={player.id} className="hover:bg-muted/30 transition-colors">
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
                        <Link
                          href={`/contacts/${party.id}`}
                          className="font-medium hover:underline truncate block"
                        >
                          {party.full_name}
                        </Link>
                        {party.title && (
                          <p className="text-[11px] text-muted-foreground truncate sm:hidden">
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
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                        {player.role}
                      </span>
                      {player.is_primary && (
                        <Star
                          size={11}
                          className="text-amber-500 fill-amber-400 shrink-0"
                          aria-label="Primary contact"
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
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
