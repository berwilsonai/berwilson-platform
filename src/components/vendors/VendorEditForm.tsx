'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

interface VendorEditFormProps {
  entity: Record<string, unknown>
  onClose: () => void
}

export default function VendorEditForm({ entity, onClose }: VendorEditFormProps) {
  const [websiteUrl, setWebsiteUrl] = useState((entity.website_url as string) ?? '')
  const [description, setDescription] = useState((entity.description as string) ?? '')
  const [specialties, setSpecialties] = useState(
    ((entity.specialties as string[]) ?? []).join(', ')
  )
  const [qualityScore, setQualityScore] = useState(
    entity.quality_score ? String(entity.quality_score) : ''
  )
  const [confidenceScore, setConfidenceScore] = useState(
    entity.confidence_score ? String(entity.confidence_score) : ''
  )
  const [headquarters, setHeadquarters] = useState((entity.headquarters as string) ?? '')
  const [logoUrl, setLogoUrl] = useState((entity.logo_url as string) ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')

    const res = await fetch(`/api/entities/${entity.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website_url: websiteUrl.trim() || null,
        description: description.trim() || null,
        specialties: specialties
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        quality_score: qualityScore ? Number(qualityScore) : null,
        confidence_score: confidenceScore ? Number(confidenceScore) : null,
        headquarters: headquarters.trim() || null,
        logo_url: logoUrl.trim() || null,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error || 'Update failed')
      setSaving(false)
      return
    }

    window.location.reload()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">Edit Vendor Profile</h3>
        <button type="button" onClick={onClose} className="p-1 hover:bg-muted rounded">
          <X size={14} />
        </button>
      </div>

      <Field label="Website URL">
        <input
          type="url"
          value={websiteUrl}
          onChange={e => setWebsiteUrl(e.target.value)}
          placeholder="https://example.com"
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          placeholder="What does this company do?"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </Field>

      <Field label="Specialties (comma-separated)">
        <input
          type="text"
          value={specialties}
          onChange={e => setSpecialties(e.target.value)}
          placeholder="HVAC, Plumbing, Electrical"
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Quality Score (1-5)">
          <input
            type="number"
            min="1"
            max="5"
            step="0.5"
            value={qualityScore}
            onChange={e => setQualityScore(e.target.value)}
            placeholder="—"
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
        <Field label="Confidence (1-5)">
          <input
            type="number"
            min="1"
            max="5"
            step="0.5"
            value={confidenceScore}
            onChange={e => setConfidenceScore(e.target.value)}
            placeholder="—"
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>
      </div>

      <Field label="Headquarters">
        <input
          type="text"
          value={headquarters}
          onChange={e => setHeadquarters(e.target.value)}
          placeholder="City, State"
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      <Field label="Logo URL">
        <input
          type="url"
          value={logoUrl}
          onChange={e => setLogoUrl(e.target.value)}
          placeholder="https://example.com/logo.png"
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </Field>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  )
}
