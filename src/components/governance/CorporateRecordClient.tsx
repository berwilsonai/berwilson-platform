'use client'

import { useMemo } from 'react'
import { ShieldCheck, PenLine } from 'lucide-react'
import RegisterSection, { type ColumnDef, type FieldDef, type Option, type Row } from './RegisterSection'
import { Chip } from '@/components/ui/chip'
import { enumLabel, formatDate, formatMoney } from '@/lib/utils/constants'
import {
  ADOPTING_BODIES,
  ADOPTING_BODY_LABELS,
  APPOINTED_BY,
  APPOINTED_BY_LABELS,
  OWNERSHIP_CLASSES,
  OWNERSHIP_CLASS_LABELS,
  RESOLUTION_KINDS,
  RESOLUTION_KIND_LABELS,
  RESOLUTION_KIND_TONE,
  ROLE_END_REASONS,
  ROLE_END_REASON_LABELS,
  SIGNATURE_STATUSES,
  SIGNATURE_STATUS_LABELS,
  SIGNATURE_STATUS_TONE,
  tone,
} from '@/lib/governance/constants'
import type { CorporateRecordPageData } from '@/lib/governance/queries'

/**
 * Resolutions, appointments and ownership — the three effective-dated registers
 * that turn the org chart into a corporate record.
 *
 * The shape they share is the point: a row opens, a row closes, nothing is
 * overwritten. "Who held signature authority on 14 March 2024" is a query here
 * and was unanswerable before, because org_people carried no dates at all.
 */

const opt = (values: readonly string[], labels: Record<string, string>): Option[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? enumLabel(v) }))

export default function CorporateRecordClient({
  data,
  canEdit,
}: {
  data: CorporateRecordPageData
  canEdit: boolean
}) {
  const entityOptions: Option[] = useMemo(
    () => data.entities.map((e) => ({ value: e.id, label: `${e.name} (${enumLabel(e.kind)})` })),
    [data.entities]
  )
  const personnelOptions: Option[] = useMemo(
    () =>
      data.personnel.map((p) => ({
        value: p.id,
        label: p.status === 'departed' ? `${p.name} (departed)` : p.name,
      })),
    [data.personnel]
  )
  const resolutionOptions: Option[] = useMemo(
    () => data.resolutionOptions.map((r) => ({ value: r.id, label: r.label })),
    [data.resolutionOptions]
  )
  const meetingOptions: Option[] = useMemo(
    () => data.meetingOptions.map((m) => ({ value: m.id, label: m.label })),
    [data.meetingOptions]
  )

  // ── Resolutions ────────────────────────────────────────────────────────────

  const resolutionColumns: ColumnDef[] = [
    {
      name: 'reference',
      label: 'Ref.',
      primary: true,
      render: (r) =>
        r.reference ? (
          <span className="tnum">{String(r.reference)}</span>
        ) : (
          // The number is how a resolution is cited from a contract or an
          // opinion, so its absence is worth naming rather than dashing out.
          <span className="text-muted-foreground/60">unnumbered</span>
        ),
    },
    { name: 'title', label: 'Resolution', primary: true },
    { name: 'kind', label: 'Kind', kind: 'chip', labels: RESOLUTION_KIND_LABELS, tones: RESOLUTION_KIND_TONE },
    {
      name: 'adopting_body',
      label: 'Adopted by',
      secondary: true,
      render: (r) => (
        <span>
          {enumLabel(String(r.adopting_body ?? ''), ADOPTING_BODY_LABELS)}
          {r.org_node_name ? (
            <span className="block text-muted-foreground/70">{String(r.org_node_name)}</span>
          ) : (
            <span className="block text-muted-foreground/60">group level</span>
          )}
        </span>
      ),
    },
    { name: 'adopted_on', label: 'Adopted', kind: 'date' },
    {
      name: 'signature_status',
      label: 'Signature',
      kind: 'chip',
      labels: SIGNATURE_STATUS_LABELS,
      tones: SIGNATURE_STATUS_TONE,
    },
  ]

  const resolutionFields: FieldDef[] = [
    { name: 'title', label: 'Title', type: 'text', required: true, wide: true, placeholder: 'Approval of the Delta land purchase' },
    { name: 'reference', label: 'Reference number', type: 'text', placeholder: 'BW-2026-004', hint: 'How this will be cited. Unique per entity.' },
    { name: 'kind', label: 'Kind', type: 'select', options: opt(RESOLUTION_KINDS, RESOLUTION_KIND_LABELS), hint: 'A written consent is an action taken WITHOUT a meeting.' },
    { name: 'org_node_id', label: 'Entity bound', type: 'select', options: entityOptions, hint: 'Leave empty for a group-level action.' },
    { name: 'adopting_body', label: 'Adopted by', type: 'select', options: opt(ADOPTING_BODIES, ADOPTING_BODY_LABELS) },
    { name: 'adopted_on', label: 'Adopted on', type: 'date', required: true },
    { name: 'effective_on', label: 'Effective on', type: 'date' },
    {
      name: 'meeting_id',
      label: 'Adopted at meeting',
      type: 'select',
      options: meetingOptions,
      when: { field: 'kind', equals: ['resolution', 'ratification', 'minute_action', ''] },
      hint: 'Leave empty if it was not minuted at a board meeting.',
    },
    { name: 'votes_for', label: 'Votes for', type: 'number' },
    { name: 'votes_against', label: 'Votes against', type: 'number' },
    { name: 'votes_abstain', label: 'Abstentions', type: 'number' },
    { name: 'signature_status', label: 'Signature status', type: 'select', options: opt(SIGNATURE_STATUSES, SIGNATURE_STATUS_LABELS) },
    { name: 'signed_on', label: 'Signed on', type: 'date', when: { field: 'signature_status', equals: ['signed', 'superseded'] } },
    { name: 'superseded_by_resolution_id', label: 'Superseded by', type: 'select', options: resolutionOptions, when: { field: 'signature_status', equals: ['superseded'] } },
    { name: 'text_body', label: 'Resolved clauses', type: 'textarea', hint: 'As adopted. A resolution is amended by adopting another one, never by editing this.' },
    { name: 'note', label: 'Note', type: 'textarea' },
  ]

  // ── Appointments and authority ─────────────────────────────────────────────

  const currentRoles = data.roles.filter((r) => !r.effective_to)
  const signers = currentRoles.filter((r) => r.can_sign_contracts)

  const appointmentColumns: ColumnDef[] = [
    { name: 'person_name', label: 'Person', primary: true },
    {
      name: 'title',
      label: 'Office',
      primary: true,
      render: (r) => (
        <span>
          {String(r.title)}
          <span className="mt-0.5 flex flex-wrap gap-1">
            {r.is_director ? <Chip tone={tone('indigo')}>Director</Chip> : null}
            {r.is_officer ? <Chip tone={tone('blue')}>Officer</Chip> : null}
            {r.is_manager ? <Chip tone={tone('teal')}>Manager</Chip> : null}
          </span>
        </span>
      ),
    },
    {
      name: 'org_node_name',
      label: 'Entity',
      secondary: true,
      render: (r) =>
        r.org_node_name ? String(r.org_node_name) : <span className="text-muted-foreground/60">group level</span>,
    },
    {
      name: 'can_sign_contracts',
      label: 'Signing authority',
      render: (r) => {
        if (!r.can_sign_contracts) return <span className="text-muted-foreground/60">none</span>
        const limit = r.signing_limit
        return (
          <span className="inline-flex flex-wrap items-center gap-1">
            {/* NULL with can_sign_contracts means UNLIMITED — a real state, and
                a different one from zero. Say so in words. */}
            <Chip tone={tone(limit === null || limit === undefined ? 'rose' : 'emerald')}>
              {limit === null || limit === undefined ? 'Unlimited' : `to ${formatMoney(Number(limit))}`}
            </Chip>
            {r.bank_signatory ? <Chip tone={tone('violet')}>Bank</Chip> : null}
            {r.can_bind_surety ? <Chip tone={tone('amber')}>Surety</Chip> : null}
          </span>
        )
      },
    },
    {
      name: 'effective_from',
      label: 'Held',
      render: (r) => (
        <span className="whitespace-nowrap">
          {formatDate(String(r.effective_from))}
          {r.effective_to ? (
            <span className="block text-muted-foreground/70">
              to {formatDate(String(r.effective_to))}
              {r.end_reason ? ` · ${enumLabel(String(r.end_reason), ROLE_END_REASON_LABELS)}` : ''}
            </span>
          ) : (
            <span className="block text-emerald-600 dark:text-emerald-400">current</span>
          )}
        </span>
      ),
    },
  ]

  const appointmentFields: FieldDef[] = [
    { name: 'person_name', label: 'Name', type: 'text', required: true, hint: 'Kept on the row, so the record survives the chart being tidied.' },
    { name: 'personnel_id', label: 'Employment record', type: 'select', options: personnelOptions, hint: 'Links the office to the person’s file, so a separation closes it.' },
    { name: 'title', label: 'Office held', type: 'text', required: true, placeholder: 'Executive Vice President' },
    { name: 'org_node_id', label: 'Entity', type: 'select', options: entityOptions, hint: 'Leave empty for a group-level office.' },
    { name: 'effective_from', label: 'From', type: 'date', required: true },
    { name: 'effective_to', label: 'Until', type: 'date', hint: 'Leave empty while they still hold it.' },
    { name: 'end_reason', label: 'Reason it ended', type: 'select', options: opt(ROLE_END_REASONS, ROLE_END_REASON_LABELS) },
    { name: 'appointed_by', label: 'Appointed by', type: 'select', options: opt(APPOINTED_BY, APPOINTED_BY_LABELS) },
    { name: 'appointing_resolution_id', label: 'Appointing resolution', type: 'select', options: resolutionOptions },
    { name: 'ending_resolution_id', label: 'Ending resolution', type: 'select', options: resolutionOptions },
    { name: 'is_director', label: 'Director', type: 'bool', placeholder: 'Sits on the board' },
    { name: 'is_officer', label: 'Officer', type: 'bool', placeholder: 'Holds a corporate office' },
    { name: 'is_manager', label: 'Manager', type: 'bool', placeholder: 'Manager of an LLC' },
    { name: 'can_sign_contracts', label: 'May sign contracts', type: 'bool', placeholder: 'Has contract signing authority' },
    { name: 'signing_limit', label: 'Signing limit', type: 'money', placeholder: '500000', hint: 'Leave empty for unlimited — which is a different answer from zero.', when: { field: 'can_sign_contracts', equals: [true] } },
    { name: 'bank_signatory', label: 'Bank signatory', type: 'bool', placeholder: 'Signs on company accounts' },
    { name: 'can_bind_surety', label: 'May bind surety', type: 'bool', placeholder: 'Can commit bonding capacity' },
    { name: 'authority_note', label: 'Authority note', type: 'textarea', hint: 'Any carve-out or condition on the above.' },
  ]

  // ── Ownership ──────────────────────────────────────────────────────────────

  const ownershipColumns: ColumnDef[] = [
    { name: 'org_node_name', label: 'Entity', primary: true, render: (r) => String(r.org_node_name ?? 'unnamed entity') },
    { name: 'holder_name', label: 'Holder', primary: true },
    { name: 'class', label: 'Class', kind: 'chip', labels: OWNERSHIP_CLASS_LABELS, secondary: true },
    { name: 'percent', label: '%', kind: 'percent', numeric: true },
    { name: 'units', label: 'Units', kind: 'number', numeric: true, secondary: true },
    { name: 'capital_contributed', label: 'Capital', kind: 'money', numeric: true, secondary: true },
    {
      name: 'effective_from',
      label: 'Held',
      render: (r) => (
        <span className="whitespace-nowrap">
          {formatDate(String(r.effective_from))}
          {r.effective_to ? (
            <span className="block text-muted-foreground/70">to {formatDate(String(r.effective_to))}</span>
          ) : (
            <span className="block text-emerald-600 dark:text-emerald-400">current</span>
          )}
        </span>
      ),
    },
  ]

  const ownershipFields: FieldDef[] = [
    { name: 'org_node_id', label: 'Entity owned', type: 'select', options: entityOptions, required: true },
    { name: 'holder_name', label: 'Holder', type: 'text', required: true, placeholder: 'Ber Wilson Holdings LLC' },
    { name: 'class', label: 'Class of interest', type: 'select', options: opt(OWNERSHIP_CLASSES, OWNERSHIP_CLASS_LABELS) },
    { name: 'percent', label: 'Percent', type: 'money', placeholder: '51' },
    { name: 'units', label: 'Units', type: 'money' },
    { name: 'capital_contributed', label: 'Capital contributed', type: 'money' },
    { name: 'effective_from', label: 'From', type: 'date', required: true },
    { name: 'effective_to', label: 'Until', type: 'date', hint: 'Set when the interest is transferred or redeemed — which closes it rather than deleting it.' },
    { name: 'consideration', label: 'Consideration', type: 'money' },
    { name: 'authorizing_resolution_id', label: 'Authorised by', type: 'select', options: resolutionOptions },
    { name: 'certificate_number', label: 'Certificate no.', type: 'text' },
    { name: 'note', label: 'Note', type: 'textarea' },
  ]

  // Current ownership by entity, for the tile above the ledger. Only the live
  // rows — a historical ledger summed would read as 300% owned.
  const ownershipByEntity = useMemo(() => {
    const live = data.ownership.filter((o) => !o.effective_to)
    const map = new Map<string, { name: string; percent: number; holders: number }>()
    for (const row of live) {
      const key = row.org_node_id
      const current = map.get(key) ?? { name: row.org_node_name ?? 'unnamed entity', percent: 0, holders: 0 }
      current.percent += Number(row.percent ?? 0)
      current.holders += 1
      map.set(key, current)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data.ownership])

  return (
    <div className="space-y-6">
      <RegisterSection
        title="Resolutions & written consents"
        description="Board and member actions, each citable by number. A written consent has no meeting behind it, which is why it needs a home of its own — meetings.decisions is a list of sentences and cannot be cited, signed or superseded."
        register="resolutions"
        columns={resolutionColumns}
        fields={resolutionFields}
        initial={data.resolutions as unknown as Row[]}
        defaults={{ kind: 'resolution', adopting_body: 'board', signature_status: 'unsigned' }}
        canEdit={canEdit}
        addLabel="Record a resolution"
        emptyMessage="No resolutions or consents on file yet. Start with the ones that created the entities on the Structure tab."
      />

      <RegisterSection
        title="Appointments & authority"
        description="Who holds which office, in which entity, from when — and critically who may sign what. A row is closed with an end date, never overwritten, so the register answers who held authority on a given date."
        register="appointments"
        columns={appointmentColumns}
        fields={appointmentFields}
        initial={data.roles as unknown as Row[]}
        defaults={{ appointed_by: 'board' }}
        canEdit={canEdit}
        addLabel="Record an appointment"
        emptyMessage="No appointments recorded. Until there are, nothing in the platform says who may sign a contract."
        sort={(a, b) => {
          // Current holders first — the register is read for who holds office
          // today, and history is what you scroll to.
          const aOpen = a.effective_to ? 1 : 0
          const bOpen = b.effective_to ? 1 : 0
          if (aOpen !== bOpen) return aOpen - bOpen
          return String(b.effective_from).localeCompare(String(a.effective_from))
        }}
      >
        {signers.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h3 className="label-caps mb-2 flex items-center gap-1.5 text-muted-foreground">
              <PenLine size={12} />
              Can sign today
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {signers.map((r) => (
                <Chip
                  key={r.id}
                  tone={tone(r.signing_limit === null ? 'rose' : 'emerald')}
                  className="gap-1.5"
                >
                  <span className="font-semibold">{r.person_name}</span>
                  <span className="opacity-80">
                    {r.org_node_name ?? 'group'} ·{' '}
                    {r.signing_limit === null ? 'unlimited' : formatMoney(Number(r.signing_limit))}
                  </span>
                </Chip>
              ))}
            </div>
          </div>
        )}
      </RegisterSection>

      <RegisterSection
        title="Ownership of record"
        description="The cap table, effective-dated. A transfer closes one row and opens another, so who owned an SPV on the day a deal closed is a query rather than an archaeology exercise. The raise pipeline on /investors tracks commitments; this is the ownership that results."
        register="ownership"
        columns={ownershipColumns}
        fields={ownershipFields}
        initial={data.ownership as unknown as Row[]}
        defaults={{ class: 'membership_units' }}
        canEdit={canEdit}
        addLabel="Record an interest"
        emptyMessage="No ownership recorded. Worth starting with the entities that have outside capital — the Structure tab marks those Standalone."
        sort={(a, b) => {
          const aOpen = a.effective_to ? 1 : 0
          const bOpen = b.effective_to ? 1 : 0
          if (aOpen !== bOpen) return aOpen - bOpen
          const byEntity = String(a.org_node_name ?? '').localeCompare(String(b.org_node_name ?? ''))
          return byEntity !== 0 ? byEntity : Number(b.percent ?? 0) - Number(a.percent ?? 0)
        }}
      >
        {ownershipByEntity.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <h3 className="label-caps mb-2 flex items-center gap-1.5 text-muted-foreground">
              <ShieldCheck size={12} />
              Held today
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {ownershipByEntity.map((e) => {
                // A cap table that does not add to 100 is the thing worth
                // flagging, and only alarm when it is actually wrong — a
                // register with no percentages recorded is incomplete, not broken.
                const off = e.percent > 0 && Math.abs(e.percent - 100) > 0.01
                return (
                  <Chip key={e.name} tone={tone(off ? 'amber' : 'slate')} className="gap-1.5">
                    <span className="font-semibold">{e.name}</span>
                    <span className="tnum opacity-80">
                      {e.percent > 0 ? `${e.percent.toFixed(2)}%` : 'no % recorded'} · {e.holders} holder
                      {e.holders === 1 ? '' : 's'}
                    </span>
                  </Chip>
                )
              })}
            </div>
          </div>
        )}
      </RegisterSection>
    </div>
  )
}
