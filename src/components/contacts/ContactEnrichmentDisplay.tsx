'use client'

import { ExternalLink, AlertTriangle } from 'lucide-react'

interface ContactEnrichmentDisplayProps {
  data: Record<string, unknown>
  enrichedAt?: string | null
  conflicts?: Array<{ field: string; current: string; enriched: string }> | null
}

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'years_of_experience', label: 'Experience' },
  { key: 'address', label: 'Address' },
  { key: 'past_projects', label: 'Past Projects' },
  { key: 'certifications', label: 'Certifications' },
  { key: 'personal_credentials', label: 'Licenses & Credentials' },
  { key: 'litigation_history', label: 'Litigation History' },
  { key: 'government_contract_history', label: 'Gov Contract History' },
  { key: 'news_mentions', label: 'News Mentions' },
  { key: 'notable_affiliations', label: 'Affiliations' },
]

export default function ContactEnrichmentDisplay({
  data,
  enrichedAt,
  conflicts,
}: ContactEnrichmentDisplayProps) {
  // Extract sources if embedded in data
  const sources = Array.isArray(data.sources)
    ? (data.sources as Array<{ url: string; title?: string }>)
    : null

  const hasContent = SECTIONS.some((s) => {
    const val = data[s.key]
    if (!val) return false
    if (Array.isArray(val)) return val.length > 0
    return true
  })

  if (!hasContent) return null

  return (
    <div className="space-y-3">
      {enrichedAt && (
        <p className="text-xs text-muted-foreground">
          Enriched{' '}
          {new Date(enrichedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
      )}

      <div className="space-y-2">
        {SECTIONS.map(({ key, label }) => {
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
                  {val.slice(0, 8).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )
          }

          return null
        })}
      </div>

      {/* Sources */}
      {sources && sources.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground">Sources</p>
          <div className="space-y-0.5 max-h-20 overflow-y-auto">
            {sources.map((s, i) => (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline truncate"
              >
                <ExternalLink size={9} className="shrink-0" />
                <span className="truncate">{s.title ?? s.url}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Conflicts */}
      {conflicts && conflicts.length > 0 && (
        <div className="rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-2 space-y-1">
          <div className="flex items-center gap-1">
            <AlertTriangle size={10} className="text-amber-600 dark:text-amber-400" />
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} — existing values preserved
            </p>
          </div>
          {conflicts.map((c) => (
            <p key={c.field} className="text-xs text-amber-700 dark:text-amber-300">
              {c.field}: found &ldquo;{c.enriched}&rdquo; but kept &ldquo;{c.current}&rdquo;
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
