'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, CheckCircle2, Users, Mail, Phone, Building2, Search, AlertTriangle,
  Link2, UserPlus, MinusCircle, ExternalLink, Sparkles, FolderKanban,
} from 'lucide-react'
import { toast } from 'sonner'
import { Chip } from '@/components/ui/chip'
import { formatDate } from '@/lib/utils/constants'
import type {
  ProfileIntakeDraft, PersonProfileDraft, CastCandidate,
} from '@/lib/contacts/profile-intake'

interface RecordOption { id: string; name: string }

interface Props {
  sessionId: string
  draft: ProfileIntakeDraft
  projects: RecordOption[]
  opportunities: RecordOption[]
}

type Action = 'create' | 'link' | 'skip'

interface PersonRow {
  ref: string
  action: Action
  existing_party_id: string | null
  full_name: string
  email: string
  title: string
  company: string
  phone: string
  linkedin_url: string
  role: string
  link_to_record: boolean
}

interface CastRow {
  email: string
  include: boolean
  full_name: string
  company: string
  role: string
}

/** The deal everyone lands on: an existing record, or nothing. */
type Target = { kind: 'project' | 'opportunity'; id: string } | null

const ACTION_LABEL: Record<Action, string> = {
  create: 'Create contact',
  link: 'Update existing',
  skip: 'Skip',
}

const EVIDENCE_TONE: Record<PersonProfileDraft['evidence'], string> = {
  mail: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  directory: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900',
  web: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  none: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700',
}

const EVIDENCE_LABEL: Record<PersonProfileDraft['evidence'], string> = {
  mail: 'From the mail',
  directory: 'Google Contacts',
  web: 'Web only',
  none: 'Nothing found',
}

function initialPerson(p: PersonProfileDraft): PersonRow {
  return {
    ref: p.ref,
    // An email match IS identity, so default to updating that contact.
    // Anything less defaults to creating, because a wrong merge is the
    // expensive mistake and it cannot be undone from this screen.
    action: p.match_type === 'exact_email' && !p.ambiguous ? 'link' : p.evidence === 'none' ? 'skip' : 'create',
    existing_party_id: p.ambiguous ? null : p.existing_party_id,
    full_name: p.full_name ?? p.display_name ?? p.seed.name ?? '',
    email: p.email ?? '',
    title: p.title ?? '',
    company: p.company ?? '',
    phone: p.phone ?? '',
    linkedin_url: p.linkedin_url ?? '',
    role: p.role ?? '',
    link_to_record: true,
  }
}

export default function ProfileIntakeReview({ sessionId, draft, projects, opportunities }: Props) {
  const router = useRouter()
  const [people, setPeople] = useState<PersonRow[]>(() => (draft.people ?? []).map(initialPerson))
  const [cast, setCast] = useState<CastRow[]>(
    () => (draft.cast ?? []).map((c) => ({
      email: c.email,
      include: false,
      full_name: c.display_name ?? '',
      company: '',
      role: '',
    }))
  )
  const [targetRef, setTargetRef] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [profiling, setProfiling] = useState(false)
  const [failures, setFailures] = useState<string[]>([])

  const sourceByRef = useMemo(
    () => new Map((draft.people ?? []).map((p) => [p.ref, p])),
    [draft.people]
  )
  const castByEmail = useMemo(
    () => new Map((draft.cast ?? []).map((c) => [c.email, c])),
    [draft.cast]
  )

  /** domain → company, learned from the people who WERE profiled. Lets a cast
   *  member at elitesolutions.tech inherit "Elite Solutions" for free. */
  const companyByDomain = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of draft.people ?? []) {
      const domain = p.email?.split('@')[1]
      if (domain && p.company && !map.has(domain)) map.set(domain, p.company)
    }
    return map
  }, [draft.people])

  const target: Target = useMemo(() => {
    if (!targetRef) return null
    const [kind, id] = targetRef.split(':')
    if (kind !== 'project' && kind !== 'opportunity') return null
    return { kind, id }
  }, [targetRef])

  const willWrite = people.filter((p) => p.action !== 'skip').length + cast.filter((c) => c.include).length

  function patch(ref: string, changes: Partial<PersonRow>) {
    setPeople((rows) => rows.map((r) => (r.ref === ref ? { ...r, ...changes } : r)))
  }

  function patchCast(email: string, changes: Partial<CastRow>) {
    setCast((rows) => rows.map((r) => (r.email === email ? { ...r, ...changes } : r)))
  }

  /** Send the checked cast members through a fresh run, so they get the same
   *  full profile the named people got rather than just a name and an address. */
  async function profileSelectedCast() {
    const chosen = cast.filter((c) => c.include).map((c) => c.email)
    if (chosen.length === 0) {
      toast.error('Tick the people you want profiled first.')
      return
    }
    setProfiling(true)
    try {
      const res = await fetch('/api/contacts/profile-intake/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: chosen.join('\n'), label: `Cast of ${draft.people?.[0]?.full_name ?? 'this deal'}` }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The profile run failed.')
      toast.success('Profiling them now — this draft stays as it is.')
      router.push(`/intake/people/${data.session_id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The profile run failed.')
      setProfiling(false)
    }
  }

  async function submit() {
    const actions = people
      .filter((p) => p.action !== 'skip')
      .map((p) => ({
        ref: p.ref,
        action: p.action,
        existing_party_id: p.existing_party_id,
        full_name: p.full_name,
        email: p.email,
        title: p.title,
        company: p.company,
        phone: p.phone,
        linkedin_url: p.linkedin_url,
        role: p.role,
        link_to_record: p.link_to_record,
        aliases: sourceByRef.get(p.ref)?.aliases ?? [],
      }))

    // A checked cast member is a contact too — created from what the mail
    // shows, without the full profile pass.
    const castActions = cast
      .filter((c) => c.include)
      .map((c) => {
        const source = castByEmail.get(c.email)
        return {
          ref: `cast:${c.email}`,
          action: (source?.existing_party_id ? 'link' : 'create') as Action,
          existing_party_id: source?.existing_party_id ?? null,
          full_name: c.full_name || source?.display_name || c.email.split('@')[0],
          email: c.email,
          title: '',
          company: c.company || companyByDomain.get(source?.domain ?? '') || '',
          phone: '',
          linkedin_url: '',
          role: c.role,
          link_to_record: true,
          aliases: [],
        }
      })

    const all = [...actions, ...castActions]
    if (all.length === 0) {
      toast.error('Nothing is selected to save.')
      return
    }
    const nameless = all.find((a) => a.action === 'create' && !a.full_name.trim())
    if (nameless) {
      toast.error('Every contact being created needs a name.')
      return
    }
    const unlinked = all.find((a) => a.action === 'link' && !a.existing_party_id)
    if (unlinked) {
      toast.error(`Pick which existing contact "${unlinked.full_name}" is, or switch it to Create.`)
      return
    }

    setSaving(true)
    setFailures([])
    try {
      const res = await fetch('/api/contacts/profile-intake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, target, people: all }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save.')

      if (Array.isArray(data.failures) && data.failures.length > 0) {
        setFailures(data.failures)
        toast.error(`${data.failures.length} of them could not be saved.`)
        setSaving(false)
        return
      }

      const bits = [
        data.created ? `${data.created} created` : null,
        data.updated ? `${data.updated} updated` : null,
        data.linked ? `${data.linked} linked to the deal` : null,
      ].filter(Boolean)
      toast.success(bits.join(' · ') || 'Saved.')
      router.push(
        target ? `/${target.kind === 'project' ? 'projects' : 'opportunities'}/${target.id}` : '/contacts'
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.')
      setSaving(false)
    }
  }

  const stats = draft.stats
  const profiled = (draft.people ?? []).filter((p) => p.evidence === 'mail').length

  return (
    <div className="space-y-5">
      {/* ── What the run found ── */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="label-caps text-muted-foreground">What Ber AI found</h2>
        <p className="text-sm">
          {profiled} of {draft.people?.length ?? 0}{' '}
          {(draft.people?.length ?? 0) === 1 ? 'person was' : 'people were'} profiled from{' '}
          {stats?.threads_read ?? 0} email thread{(stats?.threads_read ?? 0) === 1 ? '' : 's'}
          {stats?.threads_fetched_live ? ` (${stats.threads_fetched_live} read from Gmail just now)` : ''}
          {draft.cast?.length ? `, and ${draft.cast.length} other people appear in the same correspondence.` : '.'}
        </p>
        {stats?.mailboxes?.length > 0 && (
          <p className="text-xs text-muted-foreground">Mailboxes read: {stats.mailboxes.join(', ')}</p>
        )}
        {(draft.notes ?? []).map((n, i) => (
          <p key={i} className="text-xs text-amber-700 dark:text-amber-400">{n}</p>
        ))}
      </div>

      {/* ── The deal everyone lands on ── */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <label htmlFor="target" className="label-caps text-muted-foreground flex items-center gap-1.5">
          <FolderKanban size={13} /> Attach them to
        </label>
        <select
          id="target"
          value={targetRef}
          onChange={(e) => setTargetRef(e.target.value)}
          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="">Nothing — just save the contacts</option>
          {opportunities.length > 0 && (
            <optgroup label="Opportunities">
              {opportunities.map((o) => (
                <option key={o.id} value={`opportunity:${o.id}`}>{o.name}</option>
              ))}
            </optgroup>
          )}
          {projects.length > 0 && (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="text-xs text-muted-foreground">
          Everyone saved below is added as a player on this record, with the role shown on their card.
        </p>
      </div>

      {/* ── People ── */}
      <div className="space-y-3">
        <h2 className="label-caps text-muted-foreground flex items-center gap-1.5">
          <Users size={13} /> The people you named
        </h2>
        {people.map((row) => {
          const source = sourceByRef.get(row.ref)
          if (!source) return null
          return (
            <PersonCard
              key={row.ref}
              row={row}
              source={source}
              onChange={(changes) => patch(row.ref, changes)}
              showLinkToggle={Boolean(target)}
            />
          )
        })}
      </div>

      {/* ── Cast fan-out ── */}
      {(draft.cast?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <h2 className="label-caps text-muted-foreground flex items-center gap-1.5">
            <Sparkles size={13} /> Also in this correspondence
          </h2>
          <p className="text-xs text-muted-foreground">
            Everyone else on these threads, most involved first. Tick to add them as contacts on the
            deal, or tick and use “Profile the selected” to read their mail properly first.
          </p>
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {(draft.cast ?? []).map((c) => {
              const row = cast.find((r) => r.email === c.email)
              if (!row) return null
              return (
                <CastCard
                  key={c.email}
                  candidate={c}
                  row={row}
                  inferredCompany={companyByDomain.get(c.domain) ?? ''}
                  onChange={(changes) => patchCast(c.email, changes)}
                />
              )
            })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={profileSelectedCast}
              disabled={profiling || saving}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent transition-colors disabled:opacity-60"
            >
              {profiling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Profile the selected
            </button>
          </div>
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1">
          <p className="text-sm font-medium text-destructive">These could not be saved:</p>
          {failures.map((f, i) => (
            <p key={i} className="text-xs text-destructive">{f}</p>
          ))}
        </div>
      )}

      {/* ── Confirm ── */}
      <div className="flex items-center justify-between gap-3 sticky bottom-0 bg-background/95 backdrop-blur py-3 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {willWrite} {willWrite === 1 ? 'contact' : 'contacts'} will be saved
          {target ? ' and attached to the record' : ''}. Nothing is written until you press this.
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={saving || profiling || willWrite === 0}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  )
}

// ── One person ───────────────────────────────────────────────────────────────

function PersonCard({
  row, source, onChange, showLinkToggle,
}: {
  row: PersonRow
  source: PersonProfileDraft
  onChange: (changes: Partial<PersonRow>) => void
  showLinkToggle: boolean
}) {
  const [showEvidence, setShowEvidence] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Header: who, and how we know */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {row.full_name || source.seed.raw}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            asked for as “{source.seed.raw}”
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Chip tone={EVIDENCE_TONE[source.evidence]}>{EVIDENCE_LABEL[source.evidence]}</Chip>
          {source.thread_count > 0 && (
            <Chip>
              {source.thread_count} thread{source.thread_count === 1 ? '' : 's'}
            </Chip>
          )}
        </div>
      </div>

      {/* Why this row found nothing, or found something uncertain */}
      {source.note && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300/60 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">{source.note}</p>
        </div>
      )}

      {source.ambiguous && source.candidates.length > 0 && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1.5">
          <p className="text-xs text-muted-foreground">
            More than one contact already fits this name, so nothing was chosen. Pick one to update,
            or leave it on Create:
          </p>
          {source.candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange({ action: 'link', existing_party_id: c.id })}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                row.existing_party_id === c.id ? 'bg-primary/10 ring-1 ring-inset ring-primary/40' : 'hover:bg-accent'
              }`}
            >
              <Search size={12} className="text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{c.full_name}</span>
              {c.company && <span className="text-muted-foreground truncate max-w-[9rem]">{c.company}</span>}
              {c.email && <span className="text-muted-foreground truncate max-w-[12rem]">{c.email}</span>}
            </button>
          ))}
        </div>
      )}

      {/* What to do with them */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['create', 'link', 'skip'] as const).map((a) => {
          const disabled = a === 'link' && !source.existing_party_id && source.candidates.length === 0
          const Icon = a === 'create' ? UserPlus : a === 'link' ? Link2 : MinusCircle
          return (
            <button
              key={a}
              type="button"
              disabled={disabled}
              onClick={() => onChange({
                action: a,
                existing_party_id: a === 'link' ? row.existing_party_id ?? source.existing_party_id : row.existing_party_id,
              })}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-40 ${
                row.action === a
                  ? 'bg-primary text-primary-foreground ring-primary'
                  : 'bg-background text-muted-foreground ring-border hover:bg-accent'
              }`}
            >
              <Icon size={12} />
              {ACTION_LABEL[a]}
            </button>
          )
        })}
        {row.action === 'link' && source.existing_party_name && !source.ambiguous && (
          <span className="text-xs text-muted-foreground">
            → {source.existing_party_name}
            {source.match_type === 'exact_email' && ' (same email address)'}
            {source.match_type === 'fuzzy_name' && ' (similar name — check this)'}
          </span>
        )}
      </div>

      {row.action !== 'skip' && (
        <>
          {/* The fields that will be written */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Name" value={row.full_name} onChange={(v) => onChange({ full_name: v })} />
            <Field label="Email" value={row.email} onChange={(v) => onChange({ email: v })} icon={Mail} />
            <Field label="Title" value={row.title} onChange={(v) => onChange({ title: v })} placeholder="not in the mail" />
            <Field label="Company" value={row.company} onChange={(v) => onChange({ company: v })} icon={Building2} />
            <Field label="Phone" value={row.phone} onChange={(v) => onChange({ phone: v })} icon={Phone} placeholder="not in the mail" />
            <Field label="Role on this deal" value={row.role} onChange={(v) => onChange({ role: v })} placeholder="e.g. land owner" />
          </div>

          {row.action === 'link' && (
            <p className="text-xs text-muted-foreground">
              Only empty fields on the existing contact are filled in — anything already typed there is left alone.
            </p>
          )}

          {showLinkToggle && (
            <label className="flex items-center gap-2 cursor-pointer select-none relative text-xs text-muted-foreground">
              <span className="absolute -inset-3" aria-hidden />
              <input
                type="checkbox"
                checked={row.link_to_record}
                onChange={(e) => onChange({ link_to_record: e.target.checked })}
                className="size-3.5 rounded border-input"
              />
              Add to the record chosen above as “{row.role || 'Contact'}”
            </label>
          )}
        </>
      )}

      {/* The evidence behind it */}
      {(source.summary || source.threads.length > 0 || source.commitments.length > 0) && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowEvidence((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showEvidence ? 'Hide' : 'Show'} what the mail says
          </button>
          {showEvidence && (
            <div className="mt-2 space-y-2.5 rounded-md border border-border bg-muted/30 p-3">
              {source.summary && <p className="text-xs leading-relaxed">{source.summary}</p>}

              {source.commitments.length > 0 && (
                <div className="space-y-1">
                  <p className="label-caps text-muted-foreground">Outstanding in the mail</p>
                  {source.commitments.map((c, i) => (
                    <p key={i} className="text-xs">• {c}</p>
                  ))}
                </div>
              )}

              {source.works_with.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Appears alongside:</span> {source.works_with.join(', ')}
                </p>
              )}

              {source.aliases.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Also written as:</span> {source.aliases.join(', ')} — saved as
                  aliases so the next extraction finds this contact instead of making a new one.
                </p>
              )}

              {source.threads.length > 0 && (
                <div className="space-y-1">
                  <p className="label-caps text-muted-foreground">
                    Threads{source.last_seen ? ` · last ${formatDate(source.last_seen)}` : ''}
                  </p>
                  {source.threads.map((t) => (
                    <p key={t.id} className="text-xs text-muted-foreground truncate">
                      {t.subject || '(no subject)'}
                      <span className="text-muted-foreground/70">
                        {' '}· {t.message_count} message{t.message_count === 1 ? '' : 's'}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {source.research_error && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Web research did not run: {source.research_error}
                </p>
              )}

              {source.sources.length > 0 && (
                <div className="space-y-1">
                  <p className="label-caps text-muted-foreground">Web sources</p>
                  {source.sources.slice(0, 6).map((s) => (
                    <a
                      key={s.url}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors truncate"
                    >
                      <ExternalLink size={10} className="shrink-0" />
                      <span className="truncate">{s.title || s.url}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── One cast member ──────────────────────────────────────────────────────────

function CastCard({
  candidate, row, inferredCompany, onChange,
}: {
  candidate: CastCandidate
  row: CastRow
  inferredCompany: string
  onChange: (changes: Partial<CastRow>) => void
}) {
  return (
    <div className="px-3 py-2.5 space-y-2">
      <label className="flex items-start gap-2.5 cursor-pointer select-none relative">
        <span className="absolute -inset-2" aria-hidden />
        <input
          type="checkbox"
          checked={row.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          className="mt-0.5 size-4 rounded border-input shrink-0"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate">
              {candidate.display_name || candidate.email.split('@')[0]}
            </span>
            <Chip>{candidate.domain}</Chip>
            <Chip>
              {candidate.thread_count} thread{candidate.thread_count === 1 ? '' : 's'}
            </Chip>
            {candidate.existing_party_name && (
              <Chip tone="bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900">
                on file: {candidate.existing_party_name}
              </Chip>
            )}
          </span>
          <span className="block text-xs text-muted-foreground truncate">{candidate.email}</span>
          {candidate.subjects.length > 0 && (
            <span className="block text-xs text-muted-foreground/80 truncate">
              {candidate.subjects[0]}
            </span>
          )}
        </span>
      </label>

      {row.include && (
        <div className="grid gap-2 sm:grid-cols-3 pl-6">
          <Field
            label="Name"
            value={row.full_name}
            onChange={(v) => onChange({ full_name: v })}
            placeholder={candidate.email.split('@')[0]}
          />
          <Field
            label="Company"
            value={row.company}
            onChange={(v) => onChange({ company: v })}
            placeholder={inferredCompany || candidate.domain}
          />
          <Field
            label="Role"
            value={row.role}
            onChange={(v) => onChange({ role: v })}
            placeholder="Contact"
          />
        </div>
      )}
    </div>
  )
}

// ── Field ────────────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, icon: Icon,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  icon?: React.ComponentType<{ size?: number; className?: string }>
}) {
  return (
    <div className="space-y-1">
      <label className="label-caps text-muted-foreground flex items-center gap-1">
        {Icon && <Icon size={11} />}
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-8 px-2.5 rounded-md border border-input bg-background text-sm"
      />
    </div>
  )
}
