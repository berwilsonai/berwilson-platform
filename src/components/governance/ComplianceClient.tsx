'use client'

import { useMemo } from 'react'
import { CalendarClock, AlertTriangle } from 'lucide-react'
import RegisterSection, { type ColumnDef, type FieldDef, type Option, type Row } from './RegisterSection'
import { Chip } from '@/components/ui/chip'
import { enumLabel, formatDate, daysUntilDate } from '@/lib/utils/constants'
import {
  ACK_CADENCES,
  ACK_CADENCE_LABELS,
  ACK_METHODS,
  ACK_METHOD_LABELS,
  DISCLOSURE_KINDS,
  DISCLOSURE_KIND_LABELS,
  OBLIGATION_CATEGORIES,
  OBLIGATION_CATEGORY_LABELS,
  OBLIGATION_CATEGORY_TONE,
  OBLIGATION_PERIODS,
  OBLIGATION_PERIOD_LABELS,
  OBLIGATION_STATUSES,
  OBLIGATION_STATUS_LABELS,
  OBLIGATION_STATUS_TONE,
  POLICY_CATEGORIES,
  POLICY_CATEGORY_LABELS,
  RPT_APPROVERS,
  RPT_APPROVER_LABELS,
  RPT_APPROVER_TONE,
  RPT_STATUSES,
  RPT_STATUS_LABELS,
  RPT_STATUS_TONE,
  dueTone,
  tone,
} from '@/lib/governance/constants'
import type { CompliancePageData } from '@/lib/governance/queries'

/**
 * The compliance register — the entity filing calendar, conflict disclosures,
 * related-party transactions, and policies with their acknowledgements.
 *
 * These four are not generic governance hygiene for this company. Ber Wilson
 * contracts through a structure of related SPVs and Dino is an acquired
 * operating company billing it, so conflicts and related-party disclosure are
 * first-order rather than box-ticking.
 */

const opt = (values: readonly string[], labels: Record<string, string>): Option[] =>
  values.map((v) => ({ value: v, label: labels[v] ?? enumLabel(v) }))

export default function ComplianceClient({
  data,
  canEdit,
}: {
  data: CompliancePageData
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
  const teamOptions: Option[] = useMemo(
    () => data.teamMembers.map((t) => ({ value: t.id, label: t.label })),
    [data.teamMembers]
  )
  const policyOptions: Option[] = useMemo(
    () => data.policies.map((p) => ({ value: p.id, label: `${p.name} v${p.version}` })),
    [data.policies]
  )

  // ── The filing calendar ────────────────────────────────────────────────────

  const obligationColumns: ColumnDef[] = [
    { name: 'kind', label: 'Obligation', primary: true },
    {
      name: 'org_node_name',
      label: 'Entity',
      render: (r) =>
        r.org_node_name ? String(r.org_node_name) : <span className="text-muted-foreground/60">group level</span>,
    },
    {
      name: 'category',
      label: 'Type',
      kind: 'chip',
      labels: OBLIGATION_CATEGORY_LABELS,
      tones: OBLIGATION_CATEGORY_TONE,
      secondary: true,
    },
    {
      name: 'jurisdiction',
      label: 'Where',
      secondary: true,
      render: (r) => (
        <span>
          {r.jurisdiction ? String(r.jurisdiction) : <span className="text-muted-foreground/60">—</span>}
          {r.authority ? <span className="block text-muted-foreground/70">{String(r.authority)}</span> : null}
        </span>
      ),
    },
    {
      name: 'next_due_on',
      label: 'Next due',
      render: (r) => {
        const due = r.next_due_on ? String(r.next_due_on) : null
        if (!due) return <span className="text-muted-foreground/60">no date set</span>
        const days = daysUntilDate(due)
        return (
          <span className="whitespace-nowrap">
            <Chip tone={tone(dueTone(due, String(r.status)))}>{formatDate(due)}</Chip>
            {days !== null && (
              <span className="mt-0.5 block text-muted-foreground/70">
                {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `in ${days}d`}
              </span>
            )}
          </span>
        )
      },
    },
    { name: 'period', label: 'Cycle', labels: OBLIGATION_PERIOD_LABELS, secondary: true },
    { name: 'status', label: 'Status', kind: 'chip', labels: OBLIGATION_STATUS_LABELS, tones: OBLIGATION_STATUS_TONE },
  ]

  const obligationFields: FieldDef[] = [
    { name: 'kind', label: 'Obligation', type: 'text', required: true, wide: true, placeholder: 'Annual report', hint: 'Free text on purpose — the set grows every time you register in a new state or pick up a licence class.' },
    { name: 'category', label: 'Type', type: 'select', options: opt(OBLIGATION_CATEGORIES, OBLIGATION_CATEGORY_LABELS) },
    { name: 'org_node_id', label: 'Entity', type: 'select', options: entityOptions, hint: 'Leave empty for a group-level obligation.' },
    { name: 'jurisdiction', label: 'Jurisdiction', type: 'text', placeholder: 'Utah' },
    { name: 'authority', label: 'Filed with', type: 'text', placeholder: 'Utah Division of Corporations' },
    { name: 'identifier', label: 'File / licence no.', type: 'text' },
    { name: 'period', label: 'Cycle', type: 'select', options: opt(OBLIGATION_PERIODS, OBLIGATION_PERIOD_LABELS) },
    { name: 'last_filed_on', label: 'Last filed', type: 'date' },
    { name: 'next_due_on', label: 'Next due', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: opt(OBLIGATION_STATUSES, OBLIGATION_STATUS_LABELS) },
    { name: 'owner_team_member_id', label: 'Owner', type: 'select', options: teamOptions, hint: 'An obligation with no owner is one nobody files.' },
    { name: 'cost', label: 'Fee', type: 'money' },
    { name: 'note', label: 'Note', type: 'textarea' },
  ]

  const lapsed = data.obligations.filter((o) => o.status === 'lapsed')
  const dueSoon = data.obligations.filter((o) => {
    if (o.status === 'not_applicable' || o.status === 'waived' || o.status === 'lapsed') return false
    const d = daysUntilDate(o.next_due_on)
    return d !== null && d <= 30
  })
  const certsExpiring = data.certifications.filter((c) => {
    if (!c.is_active) return false
    const d = daysUntilDate(c.expiration_date)
    return d !== null && d <= 90
  })

  // ── Conflicts ──────────────────────────────────────────────────────────────

  const conflictColumns: ColumnDef[] = [
    { name: 'person_name', label: 'Person', primary: true },
    { name: 'kind', label: 'Kind', labels: DISCLOSURE_KIND_LABELS, secondary: true },
    { name: 'period', label: 'Cycle', secondary: true },
    { name: 'disclosed_on', label: 'Disclosed', kind: 'date' },
    {
      name: 'has_conflicts',
      label: 'Outcome',
      render: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          {/* A "nothing to disclose" return IS the record — the register exists
              to distinguish it from nobody having been asked. */}
          <Chip tone={tone(r.has_conflicts ? 'amber' : 'emerald')}>
            {r.has_conflicts ? 'Conflict disclosed' : 'Nothing to disclose'}
          </Chip>
          {r.recused ? <Chip tone={tone('violet')}>Recused</Chip> : null}
        </span>
      ),
    },
    {
      name: 'description',
      label: 'What',
      secondary: true,
      render: (r) =>
        r.description ? (
          <span className="line-clamp-2">{String(r.description)}</span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
  ]

  const conflictFields: FieldDef[] = [
    { name: 'person_name', label: 'Name', type: 'text', required: true },
    { name: 'personnel_id', label: 'Employment record', type: 'select', options: personnelOptions },
    { name: 'kind', label: 'Kind', type: 'select', options: opt(DISCLOSURE_KINDS, DISCLOSURE_KIND_LABELS) },
    { name: 'period', label: 'Cycle', type: 'text', placeholder: '2026', hint: 'One annual return per person per cycle.' },
    { name: 'disclosed_on', label: 'Disclosed on', type: 'date', required: true },
    { name: 'has_conflicts', label: 'Reports a conflict', type: 'bool', placeholder: 'Yes — there is something to disclose' },
    { name: 'description', label: 'What the conflict is', type: 'textarea', wide: true, when: { field: 'has_conflicts', equals: [true] }, hint: 'Required when a conflict is reported.' },
    { name: 'related_name', label: 'Related party', type: 'text', when: { field: 'has_conflicts', equals: [true] } },
    { name: 'org_node_id', label: 'Entity affected', type: 'select', options: entityOptions, when: { field: 'has_conflicts', equals: [true] } },
    { name: 'recused', label: 'Recused', type: 'bool', placeholder: 'Stepped out of the decision' },
    { name: 'resolution_id', label: 'Addressed in resolution', type: 'select', options: resolutionOptions, when: { field: 'has_conflicts', equals: [true] } },
    { name: 'reviewed_by', label: 'Reviewed by', type: 'text' },
    { name: 'reviewed_on', label: 'Reviewed on', type: 'date' },
  ]

  // Who has NOT returned a disclosure this cycle. A register that only holds
  // returns cannot tell "no conflicts" from "never asked", and the gap is the
  // whole thing an auditor is checking.
  const cycle = String(new Date().getFullYear())
  const returnedThisCycle = new Set(
    data.conflicts.filter((c) => c.kind === 'annual' && c.period === cycle).map((c) => c.personnel_id ?? c.person_name)
  )
  const outstanding = data.personnel.filter(
    (p) => p.status === 'active' && !returnedThisCycle.has(p.id) && !returnedThisCycle.has(p.name)
  )

  // ── Related party ──────────────────────────────────────────────────────────

  const rptColumns: ColumnDef[] = [
    { name: 'title', label: 'Transaction', primary: true },
    { name: 'counterparty_name', label: 'Counterparty', primary: true },
    { name: 'relationship', label: 'Relationship', secondary: true },
    { name: 'amount', label: 'Amount', kind: 'money', numeric: true },
    { name: 'approved_by', label: 'Approved by', kind: 'chip', labels: RPT_APPROVER_LABELS, tones: RPT_APPROVER_TONE },
    {
      name: 'arms_length_basis',
      label: "Arm's length basis",
      secondary: true,
      render: (r) =>
        r.arms_length_basis ? (
          <span className="line-clamp-2">{String(r.arms_length_basis)}</span>
        ) : (
          // This is the question the auditor is actually asking, so its absence
          // is named rather than dashed.
          <span className="text-amber-600 dark:text-amber-400">not stated</span>
        ),
    },
    { name: 'status', label: 'Status', kind: 'chip', labels: RPT_STATUS_LABELS, tones: RPT_STATUS_TONE },
  ]

  const rptFields: FieldDef[] = [
    { name: 'title', label: 'Transaction', type: 'text', required: true, wide: true, placeholder: 'Dino plumbing and HVAC subcontracts' },
    { name: 'counterparty_name', label: 'Counterparty', type: 'text', required: true },
    { name: 'relationship', label: 'Why it is a related party', type: 'text', required: true, placeholder: 'Internal operating company, commonly owned' },
    { name: 'org_node_id', label: 'Our entity', type: 'select', options: entityOptions },
    { name: 'nature', label: 'Nature of the dealing', type: 'textarea', wide: true },
    { name: 'amount', label: 'Amount', type: 'money' },
    { name: 'period', label: 'Period', type: 'text', placeholder: 'FY2026' },
    { name: 'started_on', label: 'Started', type: 'date' },
    { name: 'ended_on', label: 'Ended', type: 'date' },
    { name: 'arms_length_basis', label: "Arm's length basis", type: 'textarea', wide: true, hint: 'How the price was set. This is the question an auditor or a lender is actually asking.' },
    { name: 'approved_by', label: 'Approved by', type: 'select', options: opt(RPT_APPROVERS, RPT_APPROVER_LABELS) },
    { name: 'resolution_id', label: 'Approving resolution', type: 'select', options: resolutionOptions },
    { name: 'disclosed_in', label: 'Disclosed in', type: 'text', placeholder: 'FY2026 audit; Bank of Utah covenant certificate' },
    { name: 'status', label: 'Status', type: 'select', options: opt(RPT_STATUSES, RPT_STATUS_LABELS) },
    { name: 'note', label: 'Note', type: 'textarea' },
  ]

  // ── Policies ───────────────────────────────────────────────────────────────

  const ackCountByPolicy = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of data.acknowledgements) map.set(a.policy_id, (map.get(a.policy_id) ?? 0) + 1)
    return map
  }, [data.acknowledgements])

  const activeHeadcount = data.personnel.filter((p) => p.status === 'active').length

  const policyColumns: ColumnDef[] = [
    { name: 'name', label: 'Policy', primary: true },
    {
      name: 'version',
      label: 'Version',
      primary: true,
      render: (r) => <span className="tnum">v{String(r.version)}</span>,
    },
    { name: 'category', label: 'Category', labels: POLICY_CATEGORY_LABELS, secondary: true },
    { name: 'effective_from', label: 'Effective', kind: 'date', secondary: true },
    {
      name: 'requires_acknowledgement',
      label: 'Acknowledged',
      render: (r) => {
        if (!r.requires_acknowledgement) {
          return <span className="text-muted-foreground/60">not required</span>
        }
        const count = ackCountByPolicy.get(String(r.id)) ?? 0
        // Measured against active headcount, which is the only denominator that
        // means anything — and amber rather than red while it is merely
        // incomplete.
        const complete = activeHeadcount > 0 && count >= activeHeadcount
        return (
          <Chip tone={tone(complete ? 'emerald' : count === 0 ? 'amber' : 'blue')}>
            <span className="tnum">
              {count}
              {activeHeadcount > 0 ? ` of ${activeHeadcount}` : ''}
            </span>
          </Chip>
        )
      },
    },
    {
      name: 'retired_on',
      label: 'Live',
      render: (r) =>
        r.retired_on ? (
          <Chip tone={tone('slate')}>retired {formatDate(String(r.retired_on))}</Chip>
        ) : (
          <Chip tone={tone('emerald')}>current</Chip>
        ),
    },
  ]

  const policyFields: FieldDef[] = [
    { name: 'name', label: 'Policy', type: 'text', required: true, placeholder: 'Employee handbook' },
    { name: 'version', label: 'Version', type: 'text', required: true, placeholder: '2026.1', hint: 'Not optional. An acknowledgement of "the handbook" with no version is worth nothing.' },
    { name: 'category', label: 'Category', type: 'select', options: opt(POLICY_CATEGORIES, POLICY_CATEGORY_LABELS) },
    { name: 'summary', label: 'Summary', type: 'textarea', wide: true },
    { name: 'effective_from', label: 'Effective from', type: 'date' },
    { name: 'retired_on', label: 'Retired on', type: 'date', hint: 'Set when a new version supersedes it — the old one keeps its acknowledgements.' },
    { name: 'requires_acknowledgement', label: 'Needs acknowledgement', type: 'bool', placeholder: 'Everyone must acknowledge it' },
    { name: 'acknowledgement_cadence', label: 'How often', type: 'select', options: opt(ACK_CADENCES, ACK_CADENCE_LABELS) },
    { name: 'adopted_by_resolution_id', label: 'Adopted by resolution', type: 'select', options: resolutionOptions },
  ]

  const ackColumns: ColumnDef[] = [
    { name: 'person_name', label: 'Person', primary: true },
    {
      name: 'policy_id',
      label: 'Policy',
      primary: true,
      render: (r) => {
        const p = data.policies.find((x) => x.id === r.policy_id)
        return p ? `${p.name} v${p.version}` : <span className="text-muted-foreground/60">unknown policy</span>
      },
    },
    { name: 'acknowledged_on', label: 'Acknowledged', kind: 'date' },
    { name: 'method', label: 'How', labels: ACK_METHOD_LABELS, secondary: true },
  ]

  const ackFields: FieldDef[] = [
    { name: 'policy_id', label: 'Policy', type: 'select', options: policyOptions, required: true },
    { name: 'person_name', label: 'Name', type: 'text', required: true },
    { name: 'personnel_id', label: 'Employment record', type: 'select', options: personnelOptions },
    { name: 'acknowledged_on', label: 'Acknowledged on', type: 'date', required: true },
    { name: 'method', label: 'How', type: 'select', options: opt(ACK_METHODS, ACK_METHOD_LABELS) },
    { name: 'note', label: 'Note', type: 'text' },
  ]

  return (
    <div className="space-y-6">
      <RegisterSection
        title="Entity filing calendar"
        description="Annual reports, registered agent renewals, foreign qualifications, contractor licences, BOI filings — the obligations that attach to an entity rather than to a project. The certifications on the Profile tab are capability statements; these are the filings that keep the entities alive."
        register="obligations"
        columns={obligationColumns}
        fields={obligationFields}
        initial={data.obligations as unknown as Row[]}
        defaults={{ category: 'filing', period: 'annual', status: 'open' }}
        canEdit={canEdit}
        addLabel="Add an obligation"
        emptyMessage="Nothing on the calendar. Each entity on the Structure tab has at least an annual report and a registered agent renewal."
      >
        {(lapsed.length > 0 || dueSoon.length > 0 || certsExpiring.length > 0) && (
          <div className="space-y-2 border-b border-border px-4 py-3">
            {lapsed.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose-500" />
                <p>
                  <span className="font-medium text-foreground">
                    {lapsed.length} lapsed {lapsed.length === 1 ? 'obligation' : 'obligations'}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    — {lapsed.map((o) => `${o.kind}${o.org_node_name ? ` (${o.org_node_name})` : ''}`).join(', ')}
                  </span>
                </p>
              </div>
            )}
            {dueSoon.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <CalendarClock size={13} className="mt-0.5 shrink-0 text-amber-500" />
                <p>
                  <span className="font-medium text-foreground">
                    {dueSoon.length} due inside 30 days
                  </span>{' '}
                  <span className="text-muted-foreground">
                    — {dueSoon.map((o) => `${o.kind} ${formatDate(o.next_due_on, { year: false })}`).join(', ')}
                  </span>
                </p>
              </div>
            )}
            {certsExpiring.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <CalendarClock size={13} className="mt-0.5 shrink-0 text-amber-500" />
                <p>
                  <span className="font-medium text-foreground">
                    {certsExpiring.length} certification{certsExpiring.length === 1 ? '' : 's'} expiring inside 90
                    days
                  </span>{' '}
                  <span className="text-muted-foreground">
                    — {certsExpiring.map((c) => `${c.name} ${formatDate(c.expiration_date, { year: false })}`).join(', ')}.
                    Renew on the Profile tab.
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </RegisterSection>

      <RegisterSection
        title="Conflict of interest disclosures"
        description="An annual return from every officer and director, plus a disclosure for any transaction they have an interest in. A 'nothing to disclose' return is the record — without it there is no way to tell no conflicts from never asked."
        register="conflicts"
        columns={conflictColumns}
        fields={conflictFields}
        initial={data.conflicts as unknown as Row[]}
        defaults={{ kind: 'annual', period: cycle }}
        canEdit={canEdit}
        addLabel="Record a disclosure"
        emptyMessage="No disclosures on file. With related SPVs and an internal operating company in the structure, the annual return is the first one to run."
      >
        {outstanding.length > 0 && (
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500" />
              <p>
                <span className="font-medium text-foreground">
                  {outstanding.length} {outstanding.length === 1 ? 'person has' : 'people have'} not returned a{' '}
                  {cycle} disclosure
                </span>{' '}
                <span className="text-muted-foreground">
                  — {outstanding.map((p) => p.name).join(', ')}. A missing return is not the same as a clean one.
                </span>
              </p>
            </div>
          </div>
        )}
      </RegisterSection>

      <RegisterSection
        title="Related-party transactions"
        description="Dealings between the group and anyone connected to it — an internal operating company, an officer-owned vendor, a member's family. The columns that matter are how the price was set and who approved it; an amount on its own answers nothing."
        register="related-party"
        columns={rptColumns}
        fields={rptFields}
        initial={data.relatedParty as unknown as Row[]}
        defaults={{ status: 'active', approved_by: 'pending' }}
        canEdit={canEdit}
        addLabel="Record a transaction"
        emptyMessage="Nothing recorded. Dino's billing to Ber Wilson belongs here — /dino tracks the money, this records the disclosure."
      />

      <RegisterSection
        title="Policies"
        description="Each policy at each version, so an acknowledgement means something. Retiring a version keeps its acknowledgements — the question is always whether this person agreed to the clause now in dispute."
        register="policies"
        columns={policyColumns}
        fields={policyFields}
        initial={data.policies as unknown as Row[]}
        defaults={{ category: 'other', requires_acknowledgement: true, acknowledgement_cadence: 'on_change' }}
        canEdit={canEdit}
        addLabel="Add a policy"
        emptyMessage="No policies on file. The handbook, the safety manual and the code of conduct are the three a lender asks for."
      />

      <RegisterSection
        title="Policy acknowledgements"
        description="Who acknowledged which version, when, and how."
        register="acknowledgements"
        columns={ackColumns}
        fields={ackFields}
        initial={data.acknowledgements as unknown as Row[]}
        defaults={{ method: 'signed' }}
        canEdit={canEdit}
        addLabel="Record an acknowledgement"
        emptyMessage={
          data.policies.length === 0
            ? 'Add a policy first — an acknowledgement needs a version to point at.'
            : 'No acknowledgements recorded yet.'
        }
      />
    </div>
  )
}
