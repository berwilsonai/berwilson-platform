import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Users } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import ContactsClient from '@/components/contacts/ContactsClient'
import type { ContactWithStats } from '@/components/contacts/ContactsClient'
import EmptyState from '@/components/shared/EmptyState'

export const metadata = { title: 'Contacts — Ber Wilson Intelligence' }

export default async function ContactsPage() {
  const supabase = createAdminClient()

  const { data: parties, error } = await supabase
    .from('parties')
    .select(`
      id, full_name, company, title, email, phone, is_organization, avatar_url,
      project_players(project_id, role, projects(updated_at))
    `)
    .order('full_name')

  if (error) throw new Error(`Failed to load contacts: ${error.message}`)

  const contacts: ContactWithStats[] = (parties ?? []).map(p => {
    const players = (p.project_players as Array<{
      project_id: string
      role: string
      projects: { updated_at: string | null } | null
    }>) ?? []

    return {
      id: p.id,
      full_name: p.full_name,
      company: p.company,
      title: p.title,
      email: p.email,
      phone: p.phone,
      is_organization: p.is_organization,
      avatar_url: p.avatar_url ?? null,
      project_count: players.length,
      roles: [...new Set(players.map(pp => pp.role))],
      last_active: players.reduce<string | null>((max, pp) => {
        const d = pp.projects?.updated_at ?? null
        if (!d) return max
        return !max || d > max ? d : max
      }, null),
    }
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-lg font-semibold">Contacts</h1>
        <Link
          href="/contacts/new"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus size={14} />
          Add Contact
        </Link>
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="Add people and firms you work with to build your relationship directory."
          action={
            <Link
              href="/contacts/new"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={14} />
              Add Contact
            </Link>
          }
        />
      ) : (
        <Suspense>
          <ContactsClient contacts={contacts} />
        </Suspense>
      )}
    </div>
  )
}
