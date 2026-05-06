'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Building2,
  CheckCircle2,
  Edit2,
  ExternalLink,
  Mail,
  Phone,
  Plus,
  Sparkles,
  Star,
  Trash2,
  User,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import ReviewForm from './ReviewForm'
import EnrichEntityButton from './EnrichEntityButton'
import VendorEditForm from './VendorEditForm'

interface ProjectLink {
  id: string
  relationship: string
  equity_pct: number | null
  notes: string | null
  projects: { id: string; name: string; status: string; sector: string } | null
}

interface Review {
  id: string
  entity_id: string
  project_id: string | null
  rating: number
  on_time: boolean | null
  on_budget: boolean | null
  would_rehire: boolean | null
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string
  projects: { id: string; name: string } | null
}

interface PrimaryContact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
}

interface VendorProfileClientProps {
  entity: Record<string, unknown>
  projectLinks: ProjectLink[]
  reviews: Review[]
  primaryContact: PrimaryContact | null
  allProjects: Array<{ id: string; name: string }>
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

export default function VendorProfileClient({
  entity,
  projectLinks,
  reviews: initialReviews,
  primaryContact,
  allProjects,
}: VendorProfileClientProps) {
  const [reviews, setReviews] = useState(initialReviews)
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [showEditForm, setShowEditForm] = useState(false)

  const handleReviewAdded = (review: Review) => {
    setReviews(prev => [review, ...prev])
    setShowReviewForm(false)
  }

  const handleReviewDeleted = async (reviewId: string) => {
    const res = await fetch(`/api/entities/${entity.id}/reviews/${reviewId}`, { method: 'DELETE' })
    if (res.ok) {
      setReviews(prev => prev.filter(r => r.id !== reviewId))
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column — Project History & Reviews */}
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
                    <th className="text-left px-3 py-2 font-medium">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {projectLinks.map(link => {
                    const review = reviews.find(r => r.project_id === link.projects?.id)
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
                          <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] text-muted-foreground">
                            {link.projects?.status ?? '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {review ? (
                            <div className="flex items-center gap-1">
                              <Star size={10} className="text-amber-500 fill-amber-500" />
                              <span>{Number(review.rating).toFixed(1)}</span>
                              {review.on_time !== null && (
                                review.on_time
                                  ? <CheckCircle2 size={10} className="text-green-500 ml-1" title="On time" />
                                  : <XCircle size={10} className="text-red-400 ml-1" title="Late" />
                              )}
                              {review.on_budget !== null && (
                                review.on_budget
                                  ? <CheckCircle2 size={10} className="text-green-500" title="On budget" />
                                  : <XCircle size={10} className="text-red-400" title="Over budget" />
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Reviews */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Reviews ({reviews.length})</h2>
            <button
              onClick={() => setShowReviewForm(true)}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={12} />
              Add Review
            </button>
          </div>

          {showReviewForm && (
            <ReviewForm
              entityId={entity.id as string}
              projects={allProjects}
              onSaved={handleReviewAdded}
              onCancel={() => setShowReviewForm(false)}
            />
          )}

          {reviews.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reviews yet. Add one after completing a project.</p>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <div key={review.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map(i => (
                          <Star
                            key={i}
                            size={12}
                            className={cn(
                              i <= Math.round(Number(review.rating))
                                ? 'text-amber-500 fill-amber-500'
                                : 'text-muted-foreground/30'
                            )}
                          />
                        ))}
                      </div>
                      {review.projects && (
                        <Link
                          href={`/projects/${review.projects.id}`}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {review.projects.name}
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(review.reviewed_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleReviewDeleted(review.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                        title="Delete review"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Indicators */}
                  <div className="flex items-center gap-3 mt-2">
                    {review.on_time !== null && (
                      <span className={cn('inline-flex items-center gap-1 text-[10px]', review.on_time ? 'text-green-600' : 'text-red-500')}>
                        {review.on_time ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        {review.on_time ? 'On time' : 'Late'}
                      </span>
                    )}
                    {review.on_budget !== null && (
                      <span className={cn('inline-flex items-center gap-1 text-[10px]', review.on_budget ? 'text-green-600' : 'text-red-500')}>
                        {review.on_budget ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        {review.on_budget ? 'On budget' : 'Over budget'}
                      </span>
                    )}
                    {review.would_rehire !== null && (
                      <span className={cn('inline-flex items-center gap-1 text-[10px]', review.would_rehire ? 'text-green-600' : 'text-red-500')}>
                        {review.would_rehire ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        {review.would_rehire ? 'Would rehire' : 'Would not rehire'}
                      </span>
                    )}
                  </div>

                  {review.notes && (
                    <p className="mt-2 text-xs text-muted-foreground">{review.notes}</p>
                  )}
                  {review.reviewed_by && (
                    <p className="mt-1 text-[10px] text-muted-foreground/70">— {review.reviewed_by}</p>
                  )}
                </div>
              ))}
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

        {/* Primary Contact */}
        {primaryContact && (
          <section className="rounded-lg border border-border p-3">
            <h3 className="text-xs font-semibold mb-2">Primary Contact</h3>
            <Link
              href={`/contacts/${primaryContact.id}`}
              className="flex items-center gap-2 hover:bg-muted/50 p-1.5 rounded -mx-1.5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User size={12} className="text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">{primaryContact.full_name}</p>
                {primaryContact.title && (
                  <p className="text-[10px] text-muted-foreground truncate">{primaryContact.title}</p>
                )}
              </div>
            </Link>
            <div className="mt-2 space-y-1">
              {primaryContact.email && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Mail size={10} className="shrink-0" />
                  <span className="truncate">{primaryContact.email}</span>
                </div>
              )}
              {primaryContact.phone && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Phone size={10} className="shrink-0" />
                  <span>{primaryContact.phone}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Entity Details */}
        <section className="rounded-lg border border-border p-3">
          <h3 className="text-xs font-semibold mb-2">Details</h3>
          <dl className="space-y-2 text-[11px]">
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium uppercase">{entity.entity_type as string}</dd>
            </div>
            {entity.jurisdiction && (
              <div>
                <dt className="text-muted-foreground">Jurisdiction</dt>
                <dd className="font-medium">{entity.jurisdiction as string}</dd>
              </div>
            )}
            {entity.ein && (
              <div>
                <dt className="text-muted-foreground">EIN</dt>
                <dd className="font-medium">{entity.ein as string}</dd>
              </div>
            )}
            {entity.formation_date && (
              <div>
                <dt className="text-muted-foreground">Formed</dt>
                <dd className="font-medium">{new Date(entity.formation_date as string).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* Enrichment Data */}
        {entity.enrichment_data && (
          <section className="rounded-lg border border-border p-3">
            <h3 className="text-xs font-semibold mb-2">Research Notes</h3>
            <EnrichmentNotesDisplay data={entity.enrichment_data as Record<string, unknown>} />
          </section>
        )}
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
      {data.founded_year && (
        <p className="text-[11px] text-muted-foreground">Founded: {data.founded_year as string}</p>
      )}
      {data.employee_count && (
        <p className="text-[11px] text-muted-foreground">Employees: {data.employee_count as string}</p>
      )}
      {sections.map(({ key, label }) => {
        const val = data[key]
        if (!val) return null
        if (typeof val === 'string') {
          return (
            <div key={key}>
              <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
              <p className="text-[11px]">{val}</p>
            </div>
          )
        }
        if (Array.isArray(val) && val.length > 0) {
          return (
            <div key={key}>
              <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
              <ul className="list-disc list-inside text-[11px] space-y-0.5">
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
