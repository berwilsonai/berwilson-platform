'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

const ENTITY_TYPES = [
  { value: 'llc', label: 'LLC' },
  { value: 'corp', label: 'Corporation' },
  { value: 'jv', label: 'Joint Venture' },
  { value: 'subsidiary', label: 'Subsidiary' },
  { value: 'other', label: 'Other' },
]

export default function NewVendorPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [entityType, setEntityType] = useState('llc')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [description, setDescription] = useState('')
  const [specialties, setSpecialties] = useState('')
  const [headquarters, setHeadquarters] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }

    setSaving(true)
    setError('')

    // Create the entity
    const res = await fetch('/api/entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        entity_type: entityType,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Failed to create vendor')
      setSaving(false)
      return
    }

    const { entity } = await res.json()

    // Update with vendor profile fields
    const updateRes = await fetch(`/api/entities/${entity.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website_url: websiteUrl.trim() || null,
        description: description.trim() || null,
        specialties: specialties.split(',').map(s => s.trim()).filter(Boolean),
        headquarters: headquarters.trim() || null,
      }),
    })

    if (!updateRes.ok) {
      // Entity was created but profile update failed — still navigate
      console.error('Profile update failed, but entity created')
    }

    router.push(`/vendors/${entity.id}`)
  }

  return (
    <div className="max-w-lg space-y-5">
      <Link
        href="/vendors"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft size={14} />
        All Vendors
      </Link>

      <h1 className="text-lg font-semibold">Add Vendor</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Company Name *">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Acme Construction Co."
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        </Field>

        <Field label="Entity Type">
          <select
            value={entityType}
            onChange={e => setEntityType(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ENTITY_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Website">
          <input
            type="url"
            value={websiteUrl}
            onChange={e => setWebsiteUrl(e.target.value)}
            placeholder="https://example.com"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="What does this company do?"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </Field>

        <Field label="Specialties (comma-separated)">
          <input
            type="text"
            value={specialties}
            onChange={e => setSpecialties(e.target.value)}
            placeholder="HVAC, MEP, Electrical"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        <Field label="Headquarters">
          <input
            type="text"
            value={headquarters}
            onChange={e => setHeadquarters(e.target.value)}
            placeholder="Salt Lake City, UT"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create Vendor'}
          </button>
          <Link
            href="/vendors"
            className="inline-flex items-center h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-muted transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      {children}
    </div>
  )
}
