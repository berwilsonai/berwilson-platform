'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  UserPlus,
  Lock,
  LockOpen,
  ShieldAlert,
  CheckCircle2,
  Circle,
  LogOut,
  RotateCcw,
  Trash2,
  Pencil,
  X,
} from 'lucide-react'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, Input, Select, Textarea, FieldDate, FormGrid, FormActions } from '@/components/ui/field'
import RegisterSection, { type ColumnDef, type FieldDef, type Option, type Row } from './RegisterSection'
import { enumLabel, formatDate, formatMoney, daysUntilDate } from '@/lib/utils/constants'
import {
  AGREEMENT_KINDS,
  AGREEMENT_KIND_LABELS,
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  CLASSIFICATION_TONE,
  OFFBOARDING_CATEGORY_LABELS,
  OFFBOARDING_CATEGORY_TONE,
  PERSONNEL_STATUS_TONE,
  RESTRICTIVE_AGREEMENT_KINDS,
  SEPARATION_TYPES,
  SEPARATION_TYPE_LABELS,
  SEPARATION_TYPE_TONE,
  tone,
} from '@/lib/governance/constants'
import { offboardingProgress } from '@/lib/governance/offboarding'
import type {
  OrgRoleRow,
  PersonnelAgreementRow,
  PersonnelNoteKindRow,
  PersonnelNoteRow,
  PersonnelOffboardingRow,
  PersonnelRow,
} from '@/lib/governance/db'
import type { PersonnelPageData } from '@/lib/governance/queries'

/**
 * The personnel register.
 *
 * ⚠ WHAT THIS SCREEN REPLACES. Removing someone used to be a hard DELETE in two
 * places — org_people and team_members — with no date, no reason and no audit
 * row, and the team_members delete cascaded access_grants so the record of what
 * they could reach went with them. §12's rule is that the row is the tombstone.
 *
 * So "recording a departure" here is a PASS, not a column write: it closes the
 * person's signature authority, revokes their login while snapshotting what it
 * reached, marks their box on the chart departed, opens the offboarding
 * checklist — and says which of those it did. A pass that fills blanks and names
 * what it filled can be trusted twice; one that chooses cannot be trusted once.
 */

const opt = (values: readonly string[], labels: Record<string, string>): Option[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? enumLabel(v) }))

type Filter = 'active' | 'departed' | 'all'

export default function PersonnelRegister({
  data,
  canEdit,
}: {
  data: PersonnelPageData
  canEdit: boolean
}) {
  const [people, setPeople] = useState<PersonnelRow[]>(data.personnel)
  const [notes, setNotes] = useState<PersonnelNoteRow[]>(data.notes)
  const [offboarding, setOffboarding] = useState<PersonnelOffboardingRow[]>(data.offboarding)
  const [filter, setFilter] = useState<Filter>('active')
  const [selectedId, setSelectedId] = useState<string | null>(data.personnel[0]?.id ?? null)
  const [addOpen, setAddOpen] = useState(false)
  const [purgeTarget, setPurgeTarget] = useState<PersonnelRow | null>(null)

  const selected = people.find((p) => p.id === selectedId) ?? null

  const counts = useMemo(
    () => ({
      active: people.filter((p) => p.status === 'active').length,
      departed: people.filter((p) => p.status === 'departed').length,
      all: people.length,
    }),
    [people]
  )

  const visible = useMemo(() => {
    const rows = filter === 'all' ? people : people.filter((p) => p.status === filter)
    return [...rows].sort((a, b) => {
      // Within a mixed list, active first and then most recently departed —
      // the question is almost always about someone still here.
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      if (a.status === 'departed') return String(b.separated_on ?? '').localeCompare(String(a.separated_on ?? ''))
      return a.full_name.localeCompare(b.full_name)
    })
  }, [people, filter])

  const entityOptions: Option[] = useMemo(
    () => data.entities.map((e) => ({ value: e.id, label: `${e.name} (${enumLabel(e.kind)})` })),
    [data.entities]
  )
  const teamOptions: Option[] = useMemo(
    () => data.teamMembers.map((t) => ({ value: t.id, label: t.label })),
    [data.teamMembers]
  )
  const activeKinds = data.noteKinds.filter((k) => k.active)

  function replacePerson(row: PersonnelRow) {
    setPeople((prev) => prev.map((p) => (p.id === row.id ? row : p)))
  }

  async function patchPerson(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/governance/personnel/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => ({}))) as {
      row?: PersonnelRow
      applied?: string[]
      error?: string
    }
    if (!res.ok || !payload.row) {
      toast.error(payload.error ?? 'Could not save')
      return false
    }
    replacePerson(payload.row)
    // Say what the pass did, by name. A separation that silently closed three
    // appointments and revoked a login is not something to discover later.
    if (payload.applied?.length) {
      toast.success(`Departure recorded — ${payload.applied.join('; ')}`, { duration: 9000 })
      // The closed appointments and the deactivated login are not in this
      // component's state, so say that the page needs a reload to show them.
      setTimeout(() => toast.message('Reload to see the closed appointments on the Governance tab.'), 600)
    } else {
      toast.success('Saved')
    }
    return true
  }

  return (
    <div className="space-y-6">
      {/* ── Roster ────────────────────────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
        <Panel className="lg:sticky lg:top-4">
          <PanelHeader label="People" count={counts[filter]}>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setAddOpen((o) => !o)}>
                <UserPlus size={13} data-icon="inline-start" />
                Add
              </Button>
            )}
          </PanelHeader>

          <div className="flex gap-1 border-b border-border px-3 py-2">
            {(['active', 'departed', 'all'] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={[
                  'rounded-md px-2 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                  filter === f ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {enumLabel(f)} <span className="tnum opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>

          {addOpen && canEdit && (
            <AddPersonForm
              entityOptions={entityOptions}
              teamOptions={teamOptions}
              onClose={() => setAddOpen(false)}
              onCreated={(row) => {
                setPeople((prev) => [...prev, row])
                setSelectedId(row.id)
                setFilter('active')
                setAddOpen(false)
              }}
            />
          )}

          {visible.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {filter === 'departed'
                ? 'Nobody recorded as departed. That is the right answer only if nobody has left — before 2026-09-30 a departure deleted the row.'
                : 'No employment records yet. Add the team, then the officers and the contractors.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((p) => {
                const isSelected = p.id === selectedId
                const steps = offboarding.filter((s) => s.personnel_id === p.id)
                const progress = offboardingProgress(steps)
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={[
                        'relative flex min-h-11 w-full flex-col gap-0.5 px-4 py-2.5 text-left outline-none transition-colors',
                        'focus-visible:ring-3 focus-visible:ring-ring/50',
                        isSelected ? 'bg-muted' : 'hover:bg-muted/50',
                      ].join(' ')}
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{p.full_name}</span>
                        {p.legal_hold && <Lock size={11} className="shrink-0 text-rose-500" aria-label="Legal hold" />}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {p.title ? <span className="truncate">{p.title}</span> : null}
                        {p.status === 'departed' && (
                          <Chip tone={tone(SEPARATION_TYPE_TONE[p.separation_type ?? 'other'] ?? 'slate')}>
                            {enumLabel(p.separation_type, SEPARATION_TYPE_LABELS)} {formatDate(p.separated_on, { year: false })}
                          </Chip>
                        )}
                        {p.status === 'departed' && steps.length > 0 && !progress.complete && (
                          <Chip tone={tone('amber')}>
                            offboarding {progress.requiredDone}/{progress.requiredTotal}
                          </Chip>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        {/* ── Detail ──────────────────────────────────────────────────────── */}
        {selected ? (
          <div className="space-y-6">
            <EmploymentPanel
              person={selected}
              entityOptions={entityOptions}
              roles={data.roles.filter((r) => r.personnel_id === selected.id)}
              agreements={data.agreements.filter((a) => a.personnel_id === selected.id)}
              canEdit={canEdit}
              onPatch={(body) => patchPerson(selected.id, body)}
              onPurge={() => setPurgeTarget(selected)}
            />

            <NotesFeed
              personId={selected.id}
              kinds={activeKinds}
              notes={notes.filter((n) => n.personnel_id === selected.id)}
              canEdit={canEdit}
              onAdded={(note) => setNotes((prev) => [note, ...prev])}
              onRemoved={(id) => setNotes((prev) => prev.filter((n) => n.id !== id))}
            />

            {offboarding.some((s) => s.personnel_id === selected.id) && (
              <OffboardingChecklist
                steps={offboarding.filter((s) => s.personnel_id === selected.id)}
                canEdit={canEdit}
                onToggled={(row) =>
                  setOffboarding((prev) => prev.map((s) => (s.id === row.id ? row : s)))
                }
              />
            )}

            <RegisterSection
              key={`agreements-${selected.id}`}
              title="Agreements on file"
              description="What this person signed, at which version, and what runs on after they leave. The expiry on a non-solicit is the figure you need the day they resign — and the version is what makes a handbook acknowledgement mean anything."
              register="agreements"
              columns={agreementColumns}
              fields={agreementFields}
              initial={data.agreements.filter((a) => a.personnel_id === selected.id) as unknown as Row[]}
              defaults={{ personnel_id: selected.id }}
              canEdit={canEdit}
              addLabel="Add an agreement"
              emptyMessage="Nothing on file. An offer letter, an NDA and an IP assignment are the usual three."
            />
          </div>
        ) : (
          <Panel className="p-8 text-center text-sm text-muted-foreground">
            Choose someone from the roster, or add the first employment record.
          </Panel>
        )}
      </div>

      {/* ── Note kinds registry ──────────────────────────────────────────── */}
      <RegisterSection
        title="Note kinds"
        description="The classifications a personnel note can carry. A row, not a constraint — the day a safety re-verification or an immigration check needs filing, that is an entry here rather than a migration. A kind with notes under it cannot be deleted; mark it inactive and the history keeps its label."
        register="note-kinds"
        columns={noteKindColumns}
        fields={noteKindFields}
        initial={data.noteKinds as unknown as Row[]}
        defaults={{ tone: 'slate', sensitive: true, active: true, sort_order: 150 }}
        canEdit={canEdit}
        addLabel="Add a kind"
        emptyMessage="No note kinds — which should be impossible, since twelve are seeded."
      />

      <ConfirmDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => !open && setPurgeTarget(null)}
        title={`Permanently delete ${purgeTarget?.full_name ?? 'this record'}?`}
        description={
          'This is for a record created in error. A person who actually left should be marked departed instead — ' +
          'the row is what proves when their access ended and what it reached. The database refuses while a legal ' +
          'hold or a retention date stands, and the deleted row is kept in the activity log either way.'
        }
        confirmLabel="Delete permanently"
        destructive
        onConfirm={async () => {
          if (!purgeTarget) return
          const res = await fetch(`/api/governance/personnel/${purgeTarget.id}`, { method: 'DELETE' })
          if (!res.ok) {
            const payload = (await res.json().catch(() => ({}))) as { error?: string }
            // The database guard's own sentence names the hold and its reason.
            toast.error(payload.error ?? 'Could not delete', { duration: 9000 })
            return
          }
          setPeople((prev) => prev.filter((p) => p.id !== purgeTarget.id))
          if (selectedId === purgeTarget.id) setSelectedId(null)
          toast.success('Record deleted. It remains in the activity log.')
        }}
      />
    </div>
  )
}

// ─── Add ─────────────────────────────────────────────────────────────────────

function AddPersonForm({
  entityOptions,
  teamOptions,
  onClose,
  onCreated,
}: {
  entityOptions: Option[]
  teamOptions: Option[]
  onClose: () => void
  onCreated: (row: PersonnelRow) => void
}) {
  const [form, setForm] = useState({
    full_name: '',
    title: '',
    classification: 'employee',
    engaged_on: '',
    employing_entity_id: '',
    team_member_id: '',
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/governance/personnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await res.json().catch(() => ({}))) as { row?: PersonnelRow; error?: string }
      if (!res.ok || !payload.row) {
        toast.error(payload.error ?? 'Could not save')
        return
      }
      toast.success('Employment record opened')
      onCreated(payload.row)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-4">
      <div className="flex items-center justify-between">
        <h3 className="label-caps text-muted-foreground">New employment record</h3>
        <Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close">
          <X size={14} />
        </Button>
      </div>
      <Field label="Name" required>
        <Input
          value={form.full_name}
          onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
          placeholder="Jordan Reyes"
        />
      </Field>
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
      </Field>
      <Field
        label="Classification"
        hint="Set by tax and employment law. Worker classification is the audit magnet in construction."
      >
        <Select
          value={form.classification}
          onChange={(e) => setForm((p) => ({ ...p, classification: e.target.value }))}
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Start date">
        <FieldDate value={form.engaged_on} onChange={(v: string) => setForm((p) => ({ ...p, engaged_on: v }))} />
      </Field>
      <Field label="Employer of record" hint="Which group entity employs them.">
        <Select
          value={form.employing_entity_id}
          onChange={(e) => setForm((p) => ({ ...p, employing_entity_id: e.target.value }))}
        >
          <option value="">— none —</option>
          {entityOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Platform login"
        hint="Linking it means a separation here revokes their access and records what it reached."
      >
        <Select
          value={form.team_member_id}
          onChange={(e) => setForm((p) => ({ ...p, team_member_id: e.target.value }))}
        >
          <option value="">— no login —</option>
          {teamOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <FormActions>
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy || !form.full_name.trim()}>
          {busy ? 'Saving…' : 'Open record'}
        </Button>
      </FormActions>
    </div>
  )
}

// ─── Employment + separation ─────────────────────────────────────────────────

function EmploymentPanel({
  person,
  entityOptions,
  roles,
  agreements,
  canEdit,
  onPatch,
  onPurge,
}: {
  person: PersonnelRow
  entityOptions: Option[]
  roles: OrgRoleRow[]
  agreements: PersonnelAgreementRow[]
  canEdit: boolean
  onPatch: (body: Record<string, unknown>) => Promise<boolean>
  onPurge: () => void
}) {
  const [separating, setSeparating] = useState(false)
  const [holding, setHolding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [details, setDetails] = useState({
    full_name: person.full_name,
    title: person.title ?? '',
    classification: person.classification as string,
    engaged_on: person.engaged_on ?? '',
    employing_entity_id: person.employing_entity_id ?? '',
  })
  const [sep, setSep] = useState({
    separated_on: new Date().toISOString().slice(0, 10),
    separation_type: '',
    separation_notice_on: '',
    rehire_eligible: '',
  })
  const [hold, setHold] = useState({ legal_hold_reason: '', retention_until: '' })
  const [busy, setBusy] = useState(false)

  const openRoles = roles.filter((r) => !r.effective_to)
  const liveCovenants = agreements.filter(
    (a) => RESTRICTIVE_AGREEMENT_KINDS.includes(a.kind) && (!a.expires_on || daysUntilDate(a.expires_on)! >= 0)
  )

  async function recordSeparation() {
    if (!sep.separation_type) {
      toast.error('Choose a separation type — a date without one is half a record.')
      return
    }
    setBusy(true)
    const ok = await onPatch({
      separated_on: sep.separated_on,
      separation_type: sep.separation_type,
      separation_notice_on: sep.separation_notice_on || null,
      rehire_eligible: sep.rehire_eligible === '' ? null : sep.rehire_eligible,
    })
    setBusy(false)
    if (ok) setSeparating(false)
  }

  return (
    <Panel>
      <PanelHeader label={person.full_name}>
        <div className="flex items-center gap-1.5">
          <Chip tone={tone(PERSONNEL_STATUS_TONE[person.status])}>{enumLabel(person.status)}</Chip>
          <Chip tone={tone(CLASSIFICATION_TONE[person.classification] ?? 'slate')}>
            {enumLabel(person.classification, CLASSIFICATION_LABELS)}
          </Chip>
        </div>
      </PanelHeader>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-xs sm:grid-cols-3">
        <Fact label="Title" value={person.title} />
        <Fact label="Employer of record" value={person.employing_entity_name} />
        <Fact label="Started" value={person.engaged_on ? formatDate(person.engaged_on) : null} />
        {person.status === 'departed' && (
          <>
            <Fact
              label="Left"
              value={
                <span>
                  {formatDate(person.separated_on)}
                  <span className="block text-muted-foreground/70">
                    {enumLabel(person.separation_type, SEPARATION_TYPE_LABELS)}
                  </span>
                </span>
              }
            />
            <Fact
              label="Notice given"
              value={person.separation_notice_on ? formatDate(person.separation_notice_on) : null}
            />
            <Fact
              label="Rehire"
              value={
                // Tri-state: "not decided" is a real answer and a different one
                // from no, and it is the one a reference request turns on.
                person.rehire_eligible === null ? (
                  <span className="text-muted-foreground/70">not decided</span>
                ) : person.rehire_eligible ? (
                  'Eligible'
                ) : (
                  'Not eligible'
                )
              }
            />
          </>
        )}
      </dl>

      {/* Authority and covenants still running — the two things that outlive
          employment if nobody closes them. */}
      {(openRoles.length > 0 || liveCovenants.length > 0) && (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs">
          {openRoles.length > 0 && (
            <div className="flex items-start gap-2">
              <ShieldAlert
                size={13}
                className={['mt-0.5 shrink-0', person.status === 'departed' ? 'text-rose-500' : 'text-muted-foreground'].join(' ')}
              />
              <p>
                <span className="font-medium text-foreground">
                  {person.status === 'departed' ? 'Still holds authority' : 'Holds'}
                </span>{' '}
                <span className="text-muted-foreground">
                  {openRoles
                    .map(
                      (r) =>
                        `${r.title}${r.org_node_name ? ` (${r.org_node_name})` : ''}${
                          r.can_sign_contracts
                            ? ` — signs ${r.signing_limit === null ? 'without limit' : `to ${formatMoney(Number(r.signing_limit))}`}`
                            : ''
                        }`
                    )
                    .join('; ')}
                </span>
              </p>
            </div>
          )}
          {liveCovenants.length > 0 && (
            <div className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
              <p>
                <span className="font-medium text-foreground">Bound by</span>{' '}
                <span className="text-muted-foreground">
                  {liveCovenants
                    .map(
                      (a) =>
                        `${enumLabel(a.kind, AGREEMENT_KIND_LABELS)}${a.version ? ` v${a.version}` : ''}${
                          a.expires_on ? ` until ${formatDate(a.expires_on)}` : ' (no expiry)'
                        }`
                    )
                    .join('; ')}
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Legal hold */}
      {person.legal_hold && (
        <div className="flex items-start gap-2 border-t border-border bg-rose-50/60 px-4 py-3 text-xs dark:bg-rose-500/10">
          <Lock size={13} className="mt-0.5 shrink-0 text-rose-500" />
          <p>
            <span className="font-medium text-foreground">Under legal hold</span>{' '}
            <span className="text-muted-foreground">
              — {person.legal_hold_reason}. The database refuses to delete this record while the hold stands.
            </span>
          </p>
        </div>
      )}
      {!person.legal_hold && person.retention_until && (
        <div className="flex items-start gap-2 border-t border-border px-4 py-3 text-xs">
          <Lock size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Retained until <span className="text-foreground">{formatDate(person.retention_until)}</span> — deletion is
            refused before then.
          </p>
        </div>
      )}

      {canEdit && (
        <>
          {editing ? (
            <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
              <div className="flex items-center justify-between">
                <h3 className="label-caps text-muted-foreground">Employment details</h3>
                <Button size="icon-xs" variant="ghost" onClick={() => setEditing(false)} aria-label="Close">
                  <X size={14} />
                </Button>
              </div>
              <FormGrid cols={2}>
                <Field label="Name" required>
                  <Input
                    value={details.full_name}
                    onChange={(e) => setDetails((p) => ({ ...p, full_name: e.target.value }))}
                  />
                </Field>
                <Field label="Title">
                  <Input
                    value={details.title}
                    onChange={(e) => setDetails((p) => ({ ...p, title: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Classification"
                  hint="A change here is worth a Classification note saying on what basis."
                >
                  <Select
                    value={details.classification}
                    onChange={(e) => setDetails((p) => ({ ...p, classification: e.target.value }))}
                  >
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>
                        {CLASSIFICATION_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Started">
                  <FieldDate
                    value={details.engaged_on}
                    onChange={(v: string) => setDetails((p) => ({ ...p, engaged_on: v }))}
                  />
                </Field>
                <Field label="Employer of record" className="sm:col-span-2">
                  <Select
                    value={details.employing_entity_id}
                    onChange={(e) => setDetails((p) => ({ ...p, employing_entity_id: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {entityOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
              <FormActions>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy || !details.full_name.trim()}
                  onClick={async () => {
                    setBusy(true)
                    const ok = await onPatch({
                      full_name: details.full_name.trim(),
                      title: details.title.trim() || null,
                      classification: details.classification,
                      engaged_on: details.engaged_on || null,
                      employing_entity_id: details.employing_entity_id || null,
                    })
                    setBusy(false)
                    if (ok) setEditing(false)
                  }}
                >
                  {busy ? 'Saving…' : 'Save'}
                </Button>
              </FormActions>
            </div>
          ) : separating ? (
            <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
              <div className="flex items-center justify-between">
                <h3 className="label-caps text-muted-foreground">Record a departure</h3>
                <Button size="icon-xs" variant="ghost" onClick={() => setSeparating(false)} aria-label="Close">
                  <X size={14} />
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Saving this also closes any open signature authority, revokes the platform login and records what it
                could reach, marks the org chart departed, and opens the offboarding checklist. It will say which of
                those it did. Write <span className="text-foreground">why</span> as a Separation note below — the
                reason belongs in one place.
              </p>
              <FormGrid cols={2}>
                <Field label="Last day" required>
                  <FieldDate
                    value={sep.separated_on}
                    onChange={(v: string) => setSep((p) => ({ ...p, separated_on: v }))}
                  />
                </Field>
                <Field label="Type" required>
                  <Select
                    value={sep.separation_type}
                    onChange={(e) => setSep((p) => ({ ...p, separation_type: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {SEPARATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {SEPARATION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Notice given on">
                  <FieldDate
                    value={sep.separation_notice_on}
                    onChange={(v: string) => setSep((p) => ({ ...p, separation_notice_on: v }))}
                  />
                </Field>
                <Field label="Eligible for rehire" hint="Leave undecided if nobody has decided.">
                  <Select
                    value={sep.rehire_eligible}
                    onChange={(e) => setSep((p) => ({ ...p, rehire_eligible: e.target.value }))}
                  >
                    <option value="">Not decided</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </Select>
                </Field>
              </FormGrid>
              <FormActions>
                <Button variant="outline" size="sm" onClick={() => setSeparating(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button size="sm" onClick={recordSeparation} disabled={busy}>
                  {busy ? 'Recording…' : 'Record departure'}
                </Button>
              </FormActions>
            </div>
          ) : holding ? (
            <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-4">
              <h3 className="label-caps text-muted-foreground">Hold this record</h3>
              <Field
                label="Reason for the legal hold"
                hint="Required. A hold nobody can explain cannot be lifted with confidence either."
              >
                <Input
                  value={hold.legal_hold_reason}
                  onChange={(e) => setHold((p) => ({ ...p, legal_hold_reason: e.target.value }))}
                  placeholder="EEOC charge filed 2026-09-12"
                />
              </Field>
              <Field label="Or retain until" hint="A statutory retention date, with no active dispute.">
                <FieldDate
                  value={hold.retention_until}
                  onChange={(v: string) => setHold((p) => ({ ...p, retention_until: v }))}
                />
              </Field>
              <FormActions>
                <Button variant="outline" size="sm" onClick={() => setHolding(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    const body: Record<string, unknown> = {}
                    if (hold.legal_hold_reason.trim()) {
                      body.legal_hold = true
                      body.legal_hold_reason = hold.legal_hold_reason.trim()
                    }
                    if (hold.retention_until) body.retention_until = hold.retention_until
                    if (Object.keys(body).length === 0) {
                      toast.error('Give a hold reason or a retention date.')
                      return
                    }
                    if (await onPatch(body)) setHolding(false)
                  }}
                >
                  Apply
                </Button>
              </FormActions>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
              {person.status === 'active' ? (
                <Button size="sm" variant="outline" onClick={() => setSeparating(true)}>
                  <LogOut size={13} data-icon="inline-start" />
                  Record a departure
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await onPatch({ separated_on: null, separation_type: null, rehire_eligible: null })
                    toast.message(
                      'Reinstated. Offices are regained by appointment with a resolution behind them — the closed ones stay closed, and the offboarding checklist stays as history.',
                      { duration: 9000 }
                    )
                  }}
                >
                  <RotateCcw size={13} data-icon="inline-start" />
                  Reinstate
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDetails({
                    full_name: person.full_name,
                    title: person.title ?? '',
                    classification: person.classification as string,
                    engaged_on: person.engaged_on ?? '',
                    employing_entity_id: person.employing_entity_id ?? '',
                  })
                  setEditing(true)
                }}
              >
                <Pencil size={13} data-icon="inline-start" />
                Edit details
              </Button>
              {person.legal_hold ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPatch({ legal_hold: false, legal_hold_reason: null })}
                >
                  <LockOpen size={13} data-icon="inline-start" />
                  Lift the hold
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setHolding(true)}>
                  <Lock size={13} data-icon="inline-start" />
                  Hold
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground hover:text-destructive"
                onClick={onPurge}
              >
                <Trash2 size={13} data-icon="inline-start" />
                Delete record
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  // Omit nothing, but never render a bare em dash at a value's own weight —
  // it reads as a failed render rather than an absence (§12).
  return (
    <div>
      <dt className="label-caps text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">
        {value === null || value === undefined || value === '' ? (
          <span className="text-muted-foreground/60">not recorded</span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function NotesFeed({
  personId,
  kinds,
  notes,
  canEdit,
  onAdded,
  onRemoved,
}: {
  personId: string
  kinds: PersonnelNoteKindRow[]
  notes: PersonnelNoteRow[]
  canEdit: boolean
  onAdded: (note: PersonnelNoteRow) => void
  onRemoved: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ kind: 'general', body: '', effective_on: '' })
  const [busy, setBusy] = useState(false)
  const kindMap = useMemo(() => new Map(kinds.map((k) => [k.key, k])), [kinds])

  async function save() {
    if (!form.body.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/governance/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personnel_id: personId,
          kind: form.kind,
          body: form.body.trim(),
          effective_on: form.effective_on || null,
          confidential: kindMap.get(form.kind)?.sensitive ?? true,
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { row?: PersonnelNoteRow; error?: string }
      if (!res.ok || !payload.row) {
        toast.error(payload.error ?? 'Could not save')
        return
      }
      onAdded(payload.row)
      setForm({ kind: 'general', body: '', effective_on: '' })
      setOpen(false)
      toast.success('Note filed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <PanelHeader label="Personnel file" count={notes.length}>
        {canEdit && !open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Add a note
          </Button>
        )}
      </PanelHeader>

      <p className="px-4 pt-3 text-xs leading-relaxed text-muted-foreground/90">
        The narrative — why someone left, what was said, what was agreed. Kept here and nowhere else, so the one
        place holding employment-law-sensitive material is the one place that is admin-only. Each note records when
        it <span className="text-foreground">happened</span> as well as when it was written down; a note filed three
        weeks late is a different fact from one filed the same day.
      </p>

      {open && canEdit && (
        <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-4">
          <FormGrid cols={2}>
            <Field label="Kind" required>
              <Select value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value }))}>
                {kinds.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="When it happened" hint="Leave empty if it is today.">
              <FieldDate
                value={form.effective_on}
                onChange={(v: string) => setForm((p) => ({ ...p, effective_on: v }))}
              />
            </Field>
          </FormGrid>
          {kindMap.get(form.kind)?.description && (
            <p className="text-xs text-muted-foreground/80">{kindMap.get(form.kind)?.description}</p>
          )}
          <Field label="Note" required>
            <Textarea
              rows={5}
              value={form.body}
              onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))}
              placeholder="Resigned to take a role closer to family. Four weeks' notice given and worked in full; handover to Eric completed. Left on good terms."
            />
          </Field>
          <FormActions>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !form.body.trim()}>
              {busy ? 'Filing…' : 'File note'}
            </Button>
          </FormActions>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing on file. A departure without a note records that someone left but not why.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {notes.map((n) => {
            const kind = kindMap.get(n.kind)
            return (
              <li key={n.id} className="group px-4 py-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <Chip tone={tone(kind?.tone ?? 'slate')}>{kind?.label ?? enumLabel(n.kind)}</Chip>
                  <span className="text-muted-foreground">
                    {n.effective_on ? formatDate(n.effective_on) : formatDate(n.created_at)}
                  </span>
                  {n.effective_on && n.created_at && n.effective_on !== n.created_at.slice(0, 10) && (
                    <span className="text-muted-foreground/60">
                      recorded {formatDate(n.created_at)}
                    </span>
                  )}
                  {n.author && <span className="text-muted-foreground/70">· {n.author}</span>}
                  {canEdit && (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Remove note"
                      className="ml-auto text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        const res = await fetch(`/api/governance/notes/${n.id}`, { method: 'DELETE' })
                        if (!res.ok) {
                          toast.error('Could not remove')
                          return
                        }
                        onRemoved(n.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{n.body}</p>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// ─── Offboarding ─────────────────────────────────────────────────────────────

function OffboardingChecklist({
  steps,
  canEdit,
  onToggled,
}: {
  steps: PersonnelOffboardingRow[]
  canEdit: boolean
  onToggled: (row: PersonnelOffboardingRow) => void
}) {
  const progress = offboardingProgress(steps)
  const grouped = useMemo(() => {
    const map = new Map<string, PersonnelOffboardingRow[]>()
    for (const s of [...steps].sort((a, b) => a.sort_order - b.sort_order)) {
      map.set(s.category, [...(map.get(s.category) ?? []), s])
    }
    return [...map.entries()]
  }, [steps])

  async function toggle(step: PersonnelOffboardingRow) {
    const res = await fetch(`/api/governance/offboarding/${step.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      // The server stamps the time and the actor — a checklist whose completion
      // time the browser supplies is not evidence of the thing it evidences.
      body: JSON.stringify({ completed_at: step.completed_at ? null : true }),
    })
    const payload = (await res.json().catch(() => ({}))) as { row?: PersonnelOffboardingRow; error?: string }
    if (!res.ok || !payload.row) {
      toast.error(payload.error ?? 'Could not save')
      return
    }
    onToggled(payload.row)
  }

  return (
    <Panel>
      <PanelHeader label="Offboarding">
        <Chip tone={tone(progress.complete ? 'emerald' : progress.requiredDone === 0 ? 'rose' : 'amber')}>
          <span className="tnum">
            {progress.requiredDone} of {progress.requiredTotal} required
          </span>
        </Chip>
      </PanelHeader>

      <p className="px-4 pt-3 text-xs leading-relaxed text-muted-foreground/90">
        Required steps are counted separately on purpose: a departure with the easy optional steps done and
        &ldquo;signature authority ended&rdquo; still open is not finished, and one percentage over everything would
        hide exactly that.
      </p>

      <div className="space-y-4 px-4 py-4">
        {grouped.map(([category, rows]) => (
          <div key={category}>
            <h3 className="mb-1.5 flex items-center gap-1.5">
              <Chip tone={tone(OFFBOARDING_CATEGORY_TONE[category] ?? 'slate')}>
                {enumLabel(category, OFFBOARDING_CATEGORY_LABELS)}
              </Chip>
            </h3>
            <ul className="space-y-0.5">
              {rows.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => toggle(s)}
                    className="group relative flex min-h-11 w-full items-start gap-2 rounded-md px-1 py-1.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent sm:min-h-0"
                  >
                    {s.completed_at ? (
                      <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                    ) : (
                      <Circle
                        size={15}
                        className={['mt-0.5 shrink-0', s.required ? 'text-amber-500' : 'text-muted-foreground/40'].join(' ')}
                      />
                    )}
                    <span className="min-w-0 flex-1 text-xs">
                      <span className={s.completed_at ? 'text-muted-foreground line-through' : 'text-foreground'}>
                        {s.label}
                      </span>
                      {!s.required && !s.completed_at && (
                        <span className="ml-1.5 text-muted-foreground/60">optional</span>
                      )}
                      {s.completed_at && (
                        <span className="block text-muted-foreground/70">
                          {formatDate(s.completed_at)}
                          {s.completed_by ? ` · ${s.completed_by}` : ''}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ─── Specs used above ────────────────────────────────────────────────────────

const agreementColumns: ColumnDef[] = [
  { name: 'kind', label: 'Agreement', primary: true, labels: AGREEMENT_KIND_LABELS },
  {
    name: 'version',
    label: 'Version',
    render: (r) =>
      r.version ? (
        <span className="tnum">v{String(r.version)}</span>
      ) : (
        // Version is the load-bearing column: an acknowledgement of "the
        // handbook" with no version is worth nothing.
        <span className="text-amber-600 dark:text-amber-400">no version</span>
      ),
  },
  { name: 'signed_on', label: 'Signed', kind: 'date' },
  {
    name: 'expires_on',
    label: 'Runs until',
    render: (r) => {
      if (!r.expires_on) {
        return RESTRICTIVE_AGREEMENT_KINDS.includes(String(r.kind)) ? (
          <span className="text-muted-foreground">no expiry</span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )
      }
      const days = daysUntilDate(String(r.expires_on))
      return (
        <span className="whitespace-nowrap">
          {formatDate(String(r.expires_on))}
          {days !== null && days < 0 && <span className="block text-muted-foreground/70">expired</span>}
        </span>
      )
    },
  },
  { name: 'consideration', label: 'Consideration', kind: 'money', numeric: true, secondary: true },
]

const agreementFields: FieldDef[] = [
  { name: 'kind', label: 'Agreement', type: 'select', options: opt(AGREEMENT_KINDS, AGREEMENT_KIND_LABELS), required: true },
  { name: 'version', label: 'Version', type: 'text', placeholder: '2026.1' },
  { name: 'signed_on', label: 'Signed on', type: 'date' },
  { name: 'effective_from', label: 'Effective from', type: 'date' },
  { name: 'expires_on', label: 'Runs until', type: 'date', hint: 'For a covenant — the figure you need the day they resign.' },
  { name: 'consideration', label: 'Consideration', type: 'money', hint: 'For a separation agreement. A release with none on file is one a lawyer will question.' },
  { name: 'note', label: 'Note', type: 'textarea' },
]

const noteKindColumns: ColumnDef[] = [
  { name: 'label', label: 'Kind', primary: true },
  { name: 'key', label: 'Key', secondary: true },
  { name: 'description', label: 'What it is for', secondary: true },
  { name: 'sensitive', label: 'Sensitive', kind: 'bool' },
  { name: 'requires_document', label: 'Needs a document', kind: 'bool', secondary: true },
  {
    name: 'active',
    label: 'Live',
    render: (r) =>
      r.active ? (
        <Chip tone={tone('emerald')}>active</Chip>
      ) : (
        <Chip tone={tone('slate')}>retired</Chip>
      ),
  },
]

const noteKindFields: FieldDef[] = [
  { name: 'key', label: 'Key', type: 'text', required: true, placeholder: 'immigration', hint: 'A stable slug. Renaming it carries its notes with it.' },
  { name: 'label', label: 'Label', type: 'text', required: true, placeholder: 'Immigration / I-9' },
  { name: 'description', label: 'What it is for', type: 'textarea', wide: true },
  { name: 'tone', label: 'Chip colour', type: 'select', options: ['rose', 'amber', 'emerald', 'blue', 'violet', 'teal', 'indigo', 'sky', 'cyan', 'slate'].map((t) => ({ value: t, label: t })) },
  { name: 'sensitive', label: 'Sensitive', type: 'bool', placeholder: 'Carries employment-law-sensitive material' },
  { name: 'requires_document', label: 'Needs a document', type: 'bool', placeholder: 'Incomplete without a signed file' },
  { name: 'sort_order', label: 'Sort order', type: 'number' },
  { name: 'active', label: 'Active', type: 'bool', placeholder: 'Offered when filing a new note' },
]
