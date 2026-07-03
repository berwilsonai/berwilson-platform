'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Building2,
  Edit2,
  ExternalLink,
  Mail,
  Phone,
  Sparkles,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import EnrichEntityButton from './EnrichEntityButton'
import VendorEditForm from './VendorEditForm'
import VendorDocuments from './VendorDocuments'
import type { Document as DocRecord } from '@/lib/supabase/types'

interface ProjectLink {
  id: string
  relationship: string
  equity_pct: number | null
  notes: string | null
  projects: { id: string; name: string; status: string | null; sector: string } | null
}

interface PrimaryContact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
}

interface LinkedContact {
  role: string | null
  is_primary: boolean | null
  parties: { id: string; full_name: string; email: string | null; phone: string | null; title: string | null } | null
}

interface VendorProfileClientProps {
  entity: Record<string, unknown>
  projectLinks: ProjectLink[]
  primaryContact: PrimaryContact | null
  linkedContacts: LinkedContact[]
  entityDocuments: DocRecord[]
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  vendor: 'Vendor',
  subcontractor: 'Subcontractor',
  consultant: 'Consultant',
  partner: 'Partner',
  owner: 'Owner',
  jv_partner: 'JV Partner',
  sub_entity: 'Sub-Entity',
  guarantor: 'Guarantor',
}

function ContactsSection({ linkedContacts, primaryContact }: { linkedContacts: LinkedContact[]; primaryContact: PrimaryContact | null }) {
  // Merge: show linked contacts, fall back to legacy primary contact
  const contacts = linkedContacts
    .filter(lc => lc.parties)
    .map(lc => ({ ...lc.parties!, role: lc.role, isPrimary: lc.is_primary }))

  // If legacy primary contact exists but isn't in the linked list, add it
  if (primaryContact && !contacts.some(c => c.id === primaryContact.id)) {
    contacts.unshift({ ...primaryContact, role: 'primary', isPrimary: true })
  }

  if (contacts.length === 0) return null

  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="text-xs font-semibold mb-2">
        People ({contacts.length})
      </h3>
      <div className="space-y-1">
        {contacts.map(contact => (
          <Link
            key={contact.id}
            href={`/contacts/${contact.id}`}
            className="flex items-center gap-2 hover:bg-muted/50 p-1.5 rounded -mx-1.5 transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
              <User size={12} className="text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{contact.full_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {[contact.title, contact.role].filter(Boolean).join(' · ')}
              </p>
            </div>
            {contact.email && (
              <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[140px]">
                {contact.email}
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function VendorProfileClient({
  entity,
  projectLinks,
  primaryContact,
  linkedContacts,
  entityDocuments,
}: VendorProfileClientProps) {
  const [showEditForm, setShowEditForm] = useState(false)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column — Project History */}
      <div className="lg:col-span-2 space-y-6">
        {/* Project History */}
        <section>
          <h2 className="text-sm font-semibold mb-3">Project History</h2>
          {projectLinks.length === 0 ? (
            <p className="text-xs text-muted-foreground">Not linked to any projects yet.</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium">Project</th>
                    <th className="text-left px-3 py-2 font-medium">Role</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {projectLinks.map(link => {
                    return (
                      <tr key={link.id} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2">
                          {link.projects ? (
                            <Link
                              href={`/projects/${link.projects.id}`}
                              className="text-primary hover:underline"
                            >
                              {link.projects.name}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">Unknown</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {RELATIONSHIP_LABELS[link.relationship] ?? link.relationship}
                        </td>
                        <td className="px-3 py-2">
                          <span className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
                            {link.projects?.status ?? '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>

      {/* Right column — Sidebar */}
      <div className="space-y-5">
        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setShowEditForm(!showEditForm)}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors w-full"
          >
            <Edit2 size={12} />
            Edit Profile
          </button>
          <EnrichEntityButton
            entityId={entity.id as string}
            entityName={entity.name as string}
            websiteUrl={entity.website_url as string | null}
            enrichedAt={entity.enriched_at as string | null}
          />
        </div>

        {showEditForm && (
          <VendorEditForm entity={entity} onClose={() => setShowEditForm(false)} />
        )}

        {/* People at this company */}
        <ContactsSection linkedContacts={linkedContacts} primaryContact={primaryContact} />

        {/* Entity Details */}
        <section className="rounded-lg border border-border p-3">
          <h3 className="text-xs font-semibold mb-2">Details</h3>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium uppercase">{entity.entity_type as string}</dd>
            </div>
            {entity.jurisdiction ? (
              <div>
                <dt className="text-muted-foreground">Jurisdiction</dt>
                <dd className="font-medium">{entity.jurisdiction as string}</dd>
              </div>
            ) : null}
            {entity.ein ? (
              <div>
                <dt className="text-muted-foreground">EIN</dt>
                <dd className="font-medium">{entity.ein as string}</dd>
              </div>
            ) : null}
            {entity.formation_date ? (
              <div>
                <dt className="text-muted-foreground">Formed</dt>
                <dd className="font-medium">{new Date(entity.formation_date as string).toLocaleDateString()}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {/* Enrichment Data */}
        {entity.enrichment_data ? (
          <section className="rounded-lg border border-border p-3">
            <h3 className="text-xs font-semibold mb-2">Research Notes</h3>
            <EnrichmentNotesDisplay data={entity.enrichment_data as Record<string, unknown>} />
          </section>
        ) : null}

        {/* Vendor Documents */}
        <VendorDocuments
          entityId={entity.id as string}
          initialDocuments={entityDocuments}
        />
      </div>
    </div>
  )
}

function EnrichmentNotesDisplay({ data }: { data: Record<string, unknown> }) {
  const sections = [
    { key: 'services', label: 'Services' },
    { key: 'key_clients', label: 'Key Clients' },
    { key: 'certifications', label: 'Certifications' },
    { key: 'notable_projects', label: 'Notable Projects' },
    { key: 'government_contract_history', label: 'Gov Contract History' },
  ]

  return (
    <div className="space-y-2">
      {data.founded_year ? (
        <p className="text-xs text-muted-foreground">Founded: {data.founded_year as string}</p>
      ) : null}
      {data.employee_count ? (
        <p className="text-xs text-muted-foreground">Employees: {data.employee_count as string}</p>
      ) : null}
      {sections.map(({ key, label }) => {
        const val = data[key]
        if (!val) return null
        if (typeof val === 'string') {
          return (
            <div key={key}>
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="text-xs">{val}</p>
            </div>
          )
        }
        if (Array.isArray(val) && val.length > 0) {
          return (
            <div key={key}>
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <ul className="list-disc list-inside text-xs space-y-0.5">
                {val.slice(0, 5).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}
