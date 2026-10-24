'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Loader2, Search, UserPlus, EyeOff, Building2, Users, Mic,
  CheckCircle2, AlertTriangle, ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/shared/EmptyState'
import { FIELD_CONTROL_CLASS } from '@/lib/utils/field-classes'
import type { AttendeeClass, AttendeeFinding } from '@/lib/contacts/attendee-findings'

/**
 * "People we have met and never wrote down" — the findings queue.
 *
 * ⚠ THE CLASSIFICATION DECIDES WHICH BUTTONS EXIST, and that is the whole
 * protection rather than a nicety. Measured 2026-10-23 over the live corpus: 96
 * distinct unmatched attendee names, of which 21 are real new people and the
 * rest are our own executives under their mailboxes, our own company in a
 * person-shaped field, organizations, seats, and one-word names that cannot be
 * created at all. A queue offering the same "Create?" button for all 96 would
 * have moved the 96-way guess from the model to a tired human — and the 10-21
 * and 10-22 sessions spent two days undoing a smaller version of exactly that.
 *
 * ⚠ AND A SUSPECTED DUPLICATE IS SHOWN, NEVER FOLDED (§12). "Jaren Davis",
 * "Jaren L. Davis", "Todd" / "Todd Gorringe", "Jonathan" / "Jonathan Houk" are
 * all live pairs; marking them is safe where it is wrong and merging is not.
 */

interface Contact {
  id: string
  full_name: string
  company: string | null
  email: string | null
  is_organization: boolean | null
}

const CLASS_CHIP: Record<AttendeeClass, { tone: string; label: string }> = {
  candidate: { tone: 'info', label: 'New person' },
  fragment: { tone: 'caution', label: 'One word only' },
  internal: { tone: 'positive', label: 'One of ours' },
  organization: { tone: 'violet', label: 'Organization' },
  label: { tone: 'neutral', label: 'Not a person' },
}

/** Type-ahead over the whole directory — the same shape the meeting review
 *  screen uses, so "link, never duplicate" reads the same in both places. */
function ContactPicker({
  contacts,
  onPick,
  placeholder = 'Link to an existing contact…',
}: {
  contacts: Contact[]
  onPick: (c: Contact) => void
  placeholder?: string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const options = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    return contacts
      .filter(
        (c) =>
          c.full_name.toLowerCase().includes(s) || (c.company ?? '').toLowerCase().includes(s),
      )
      .slice(0, 8)
  }, [q, contacts])

  return (
    <div className="relative min-w-[13rem] flex-1">
      <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        className={`${FIELD_CONTROL_CLASS} h-[2.75rem] sm:h-9 pl-7`}
        placeholder={placeholder}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-card elev-2">
          {options.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                onPick(c)
                setQ('')
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-accent transition-colors outline-none focus-visible:bg-accent"
            >
              {c.is_organization && <Building2 size={12} className="text-muted-foreground shrink-0" />}
              <span className="truncate flex-1">{c.full_name}</span>
              {c.company && (
                <span className="text-[11px] text-muted-foreground truncate max-w-[8rem]">
                  {c.company}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FindingRow({
  finding,
  contacts,
  onResolved,
}: {
  finding: AttendeeFinding
  contacts: Contact[]
  onResolved: (nameKey: string, message: string) => void
}) {
  const [busy, setBusy] = useState<null | 'create' | 'link' | 'skip'>(null)
  // Editable before creating: the recording heard a role and a company, and the
  // surname it never said has to be typeable or a `fragment` could never be
  // promoted at all.
  const [fullName, setFullName] = useState(finding.name)
  const [role, setRole] = useState(finding.role ?? '')
  const [company, setCompany] = useState(finding.company ?? '')
  const chip = CLASS_CHIP[finding.classification.kind]

  async function post(payload: Record<string, unknown>, verb: 'create' | 'link' | 'skip') {
    setBusy(verb)
    try {
      const res = await fetch('/api/contacts/attendees/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: finding.name, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'That did not work')
      const linked =
        typeof data.slotsLinked === 'number' && data.slotsLinked > 0
          ? ` — ${data.slotsLinked} mention${data.slotsLinked === 1 ? '' : 's'} linked`
          : ''
      const noted =
        typeof data.notesWritten === 'number' && data.notesWritten > 0
          ? `, ${data.notesWritten} call${data.notesWritten === 1 ? '' : 's'} on their feed`
          : ''
      onResolved(
        finding.nameKey,
        verb === 'skip'
          ? `${finding.name} will not be asked about again`
          : `${data.party_name ?? finding.name}${linked}${noted}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'That did not work')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel>
      <div className="px-4 py-3 space-y-3">
        {/* ── What we heard ──────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">{finding.name}</span>
              <Chip tone={chip.tone}>{chip.label}</Chip>
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Mic size={11} />
                {finding.meetings.length} call{finding.meetings.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{finding.classification.reason}</p>
            {finding.alsoHeardAs && (
              <p className="text-xs text-caution mt-1 inline-flex items-start gap-1">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>
                  Possibly the same person as {finding.alsoHeardAs.join(', ')} — check before
                  adding, or link both to one contact
                </span>
              </p>
            )}
          </div>
          <div className="text-xs text-muted-foreground text-right shrink-0">
            {finding.company && <div>{finding.company}</div>}
            {finding.role && <div className="max-w-[16rem] truncate">{finding.role}</div>}
            {finding.email && <div className="font-mono text-[11px]">{finding.email}</div>}
          </div>
        </div>

        {/* ── Which calls ────────────────────────────────────────────── */}
        <ul className="space-y-0.5">
          {finding.meetings.slice(0, 3).map((m) => (
            <li key={m.id} className="text-xs text-muted-foreground flex items-baseline gap-2">
              <span className="tnum shrink-0">{m.date ?? '—'}</span>
              <span className="truncate">{m.title ?? 'Untitled call'}</span>
            </li>
          ))}
          {finding.meetings.length > 3 && (
            <li className="text-xs text-muted-foreground">
              and {finding.meetings.length - 3} more
            </li>
          )}
        </ul>

        {/* ── What you can do about it ───────────────────────────────── */}
        {finding.actions.create && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              className={`${FIELD_CONTROL_CLASS} h-[2.75rem] sm:h-9`}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              aria-label="Full name"
              placeholder="Full name"
            />
            <input
              className={`${FIELD_CONTROL_CLASS} h-[2.75rem] sm:h-9`}
              value={role}
              onChange={(e) => setRole(e.target.value)}
              aria-label="Role or title"
              placeholder="Role"
            />
            <input
              className={`${FIELD_CONTROL_CLASS} h-[2.75rem] sm:h-9`}
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              aria-label="Company"
              placeholder="Company"
            />
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {finding.actions.create && (
            <Button
              size="sm"
              onClick={() =>
                post(
                  {
                    action: 'create',
                    full_name: fullName,
                    role: role || null,
                    company: company || null,
                    email: finding.email,
                    is_organization: false,
                  },
                  'create',
                )
              }
              disabled={busy !== null}
            >
              {busy === 'create' ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Add as a contact
            </Button>
          )}

          {finding.actions.link && (
            <ContactPicker
              contacts={contacts}
              onPick={(c) => post({ action: 'link', party_id: c.id }, 'link')}
              placeholder={
                finding.classification.kind === 'internal'
                  ? 'Link to their contact card…'
                  : 'Link to an existing contact…'
              }
            />
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              post({ action: 'skip', reason: finding.actions.skipReason }, 'skip')
            }
            disabled={busy !== null}
            title="Never ask about this name again. Reversible — it is one row in meeting_attendee_skips."
          >
            {busy === 'skip' ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
            Not a contact
          </Button>
        </div>
      </div>
    </Panel>
  )
}

const FILTERS: { key: AttendeeClass | 'all'; label: string }[] = [
  { key: 'candidate', label: 'New people' },
  { key: 'fragment', label: 'One word only' },
  { key: 'organization', label: 'Organizations' },
  { key: 'internal', label: 'Ours' },
  { key: 'label', label: 'Not people' },
  { key: 'all', label: 'Everything' },
]

export default function UnlinkedAttendees({
  findings,
  contacts,
  withheldMeetings,
  slotsExamined,
  skipped,
}: {
  findings: AttendeeFinding[]
  contacts: Contact[]
  withheldMeetings: number
  slotsExamined: number
  skipped: number
}) {
  const router = useRouter()
  const [resolved, setResolved] = useState<Map<string, string>>(new Map())
  // ⚠ The filter would belong in the URL if it were a view (§12); this is a
  // working pass through one queue in one sitting, and the rows disappear as
  // they are resolved, so a shareable link to "the fragments" would describe a
  // list that no longer exists by the time it is opened.
  const [filter, setFilter] = useState<AttendeeClass | 'all'>('candidate')

  const counts = useMemo(() => {
    const out = new Map<AttendeeClass | 'all', number>()
    for (const f of findings) {
      if (resolved.has(f.nameKey)) continue
      out.set(f.classification.kind, (out.get(f.classification.kind) ?? 0) + 1)
      out.set('all', (out.get('all') ?? 0) + 1)
    }
    return out
  }, [findings, resolved])

  const shown = findings.filter(
    (f) => !resolved.has(f.nameKey) && (filter === 'all' || f.classification.kind === filter),
  )

  function onResolved(nameKey: string, message: string) {
    toast.success(message)
    setResolved((prev) => new Map(prev).set(nameKey, message))
    // ⚠ TRAILING-EDGE REFRESH, NOT ONE PER ROW. §12: an optimistic client
    // mutation with no `router.refresh()` leaves every server-rendered count
    // lying until the tab is reloaded — and refreshing once per row would
    // re-render the whole queue under the reader's cursor mid-pass. The row is
    // removed locally now; the server counts catch up when they next matter.
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">People we have met</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Names heard on recorded calls that no contact in the directory answers to. Adding
            one links every mention of them across every call and puts those conversations on
            their profile.
          </p>
        </div>
        <Link
          href="/contacts"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to the directory
        </Link>
      </div>

      {/* ⚠ WHAT WAS WITHHELD IS PART OF THE LIST (§12). A count that cannot be
          derived after the exclusion ran in SQL has to be carried; a reader who
          cannot see that something was held back reads the queue as complete. */}
      {withheldMeetings > 0 && (
        <Panel className="px-4 py-2.5">
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <ShieldAlert size={12} className="text-caution" />
            {withheldMeetings} call{withheldMeetings === 1 ? '' : 's'} on protected projects
            {withheldMeetings === 1 ? ' is' : ' are'} not read here. The people in them stay on
            the project.
          </p>
        </Panel>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map(({ key, label }) => {
          const n = counts.get(key) ?? 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`inline-flex items-center gap-1.5 h-[2.75rem] sm:h-8 px-2.5 rounded-md border text-xs transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                filter === key
                  ? 'border-foreground bg-accent text-foreground'
                  : 'border-input bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
              <span className="tnum font-medium">{n}</span>
            </button>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={resolved.size > 0 ? CheckCircle2 : Users}
          title={
            resolved.size > 0
              ? 'Nothing left in this lane'
              : (counts.get('all') ?? 0) === 0
                ? 'Every name on every recording is accounted for'
                : 'Nothing in this lane'
          }
          description={
            (counts.get('all') ?? 0) === 0
              ? `${slotsExamined} attendee slot${slotsExamined === 1 ? '' : 's'} read across the recorded calls${
                  skipped > 0 ? `, and ${skipped} name${skipped === 1 ? '' : 's'} you have said are not contacts` : ''
                }.`
              : 'Try another lane — the counts above say where the work is.'
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((f) => (
            <FindingRow
              key={f.nameKey}
              finding={f}
              contacts={contacts}
              onResolved={onResolved}
            />
          ))}
        </div>
      )}

      {/* ⚠ PRINT WHAT WAS EXAMINED. §12: an empty population passes vacuously
          behind the same tick, so "no findings" and "nothing was read" must be
          distinguishable on screen and not only in a log. */}
      <p className="text-xs text-muted-foreground">
        Read {slotsExamined} attendee slot{slotsExamined === 1 ? '' : 's'} across the recorded
        calls. {skipped > 0 && `${skipped} name${skipped === 1 ? '' : 's'} already marked as not a contact.`}
      </p>
    </div>
  )
}
