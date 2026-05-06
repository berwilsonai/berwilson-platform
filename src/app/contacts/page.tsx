import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Users, Clock } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import ContactsClient from '@/components/contacts/ContactsClient'
import type { ContactWithStats } from '@/components/contacts/ContactsClient'
import EmptyState from '@/components/shared/EmptyState'

export const metadata = { title: 'Contacts — Ber Wilson Intelligence' }

export default async function ContactsPage() {
  const supabase = createAdminClient()
  // Cast to bypass generated types — status column added via migration
  const db = supabase as unknown as import('@supabase/supabase-js').SupabaseClient

  const [{ data: parties, error }, { count: pendingCount }] = await Promise.all([
    db
      .from('parties')
      .select(`
        id, full_name, company, title, email, phone, is_organization, avatar_url,
        project_players(project_id, role, projects(updated_at))
      `)
      .eq('status', 'active')
      .order('full_name'),
    db
      .from('parties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
  ])

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

      {/* Pending contacts banner */}
      {(pendingCount ?? 0) > 0 && (
        <Link
          href="/review?reason=new_contact"
          className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm hover:bg-amber-100 transition-colors"
        >
          <Clock size={15} className="shrink-0" />
          <span>
            <span className="font-semibold">{pendingCount} contact{pendingCount !== 1 ? 's' : ''} waiting for review</span>
            {' '}— auto-detected from email. Confirm they're real project contacts before they appear here.
          </span>
          <span className="ml-auto text-xs font-medium shrink-0">Review →</span>
        </Link>
      )}

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
