import { Suspense } from 'react'
import Link from 'next/link'
import { Plus, Users, UserSearch, SlidersHorizontal, Mic } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { contactRoleViews, partyRoleMap } from '@/lib/contacts/roles'
import { countActionableAttendees } from '@/lib/contacts/attendee-queue'
import { viewerHiddenProjectIds } from '@/lib/security/request'
import ContactsClient from '@/components/contacts/ContactsClient'
import ScanCardButton from '@/components/contacts/ScanCardButton'
import type { ContactWithStats } from '@/components/contacts/ContactsClient'
import EmptyState from '@/components/shared/EmptyState'
import { Clock } from 'lucide-react'

export const metadata = { title: 'Directory — Ber Wilson Intelligence' }

/**
 * ONE directory, on `parties`.
 *
 * ⚠ The "Vendors & Contractors" tab was removed 2026-10-21. It read `entities`,
 * which held FIVE rows — all category='vendor', all entity_type='other', none
 * linked to a project — against 180 in `parties`, and two of the five were
 * misfiled (our own Dino operating company, which §4 says is not a vendor, and
 * a state agency). Four months of a second place to look that never had the
 * answer; §9 has carried the split as debt since July. All five moved to
 * `parties` as organizations (migration 20261021000006) and are reachable by
 * role like everything else.
 *
 * `entities` the TABLE is untouched and still the legal-entity backbone that
 * ownership_interests, org_nodes and the governance registers point at.
 * What retired is the surface. `/vendors/[id]` and `/vendors/new` still answer.
 */
export default async function DirectoryPage() {
  const db = createAdminClient()

  const [{ data: parties, error: partiesError }, { count: pendingCount }, roles, heardOnCalls] = await Promise.all([
    db
      .from('parties')
      .select(`
        id, full_name, company, title, email, phone, is_organization, avatar_url,
        tags, relationship_notes,
        project_players(project_id, role, projects(updated_at))
      `)
      .eq('status', 'active')
      .order('full_name'),
    db
      .from('parties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    contactRoleViews(),
    // People named on recorded calls that no contact answers to. The same
    // function the queue's own default lane counts with, so the badge and the
    // page can never disagree (§12).
    viewerHiddenProjectIds().then(countActionableAttendees),
  ])

  if (partiesError) throw new Error(`Failed to load contacts: ${partiesError.message}`)

  // One query for every contact's roles rather than an embed, because the embed
  // would be a second join on a table PostgREST truncates at 1000 rows with no
  // error (§12) — `partyRoleMap` pages explicitly.
  const roleMap = await partyRoleMap((parties ?? []).map(p => p.id))

  const contacts: ContactWithStats[] = (parties ?? []).map(p => {
    const players = (p.project_players as unknown as Array<{
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
      tags: (p.tags as string[]) ?? [],
      relationship_notes: p.relationship_notes ?? null,
      project_count: players.length,
      roles: [...new Set(players.map(pp => pp.role))],
      role_keys: roleMap.get(p.id) ?? [],
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
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold">Directory</h1>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Users size={14} />
            <span className="tnum">{contacts.length}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* ⚠ THE FOURTH DOOR, AND THE ONLY ONE THAT NEEDS NO TYPING AT ALL.
              Measured 2026-10-23: 135 of 169 attendee slots across the recorded
              calls carried no contact, 96 distinct names — people the executives
              had already met and spoken to, whom the directory had never heard
              of. Shown with its count even at zero, so the door is learnable
              before there is work behind it (§12: a surface hidden because it is
              empty is hidden exactly when somebody needs it). */}
          <Link
            href="/contacts/unlinked"
            className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
            title="People named on recorded calls who are not in the directory"
          >
            <Mic size={14} />
            <span className="whitespace-nowrap">From calls</span>
            {heardOnCalls > 0 && (
              <span className="tnum font-semibold text-info">{heardOnCalls}</span>
            )}
          </Link>
          {/* Photograph a card on a phone and the contact drafts itself. */}
          <ScanCardButton />
          {/* The third door into the directory: an email address in, a whole
              profile out, read from the correspondence already on file. */}
          <Link
            href="/intake?tab=people"
            className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
          >
            <UserSearch size={14} />
            <span className="whitespace-nowrap">Profile from Email</span>
          </Link>
          <Link
            href="/settings/contact-roles"
            className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
            title="Add, rename or retire a role"
          >
            <SlidersHorizontal size={14} />
            <span className="whitespace-nowrap">Roles</span>
          </Link>
          <Link
            href="/contacts/new"
            className="inline-flex items-center gap-1.5 h-[2.75rem] sm:h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            <span className="whitespace-nowrap">Add Contact</span>
          </Link>
        </div>
      </div>

      {/* Pending contacts banner */}
      {(pendingCount ?? 0) > 0 && (
        <Link
          href="/review?reason=new_contact"
          className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-sm hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        >
          <Clock size={15} className="shrink-0" />
          <span>
            <span className="font-semibold">{pendingCount} contact{pendingCount !== 1 ? 's' : ''} waiting for review</span>
            {' '}— auto-detected from email. Confirm they&apos;re real project contacts before they appear here.
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
          <ContactsClient contacts={contacts} roles={roles} />
        </Suspense>
      )}
    </div>
  )
}
