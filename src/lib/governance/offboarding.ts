/**
 * The offboarding checklist — a control with dates, not a note.
 *
 * "When was their platform and email access revoked" has to be answerable with a
 * date. Before the personnel register it was not answerable at all: deleting the
 * team_members row destroyed the evidence that the person had ever had access,
 * and the access_grants cascade took the record of WHAT they could see with it.
 *
 * ⚠ EACH STEP IS STORED AS ITS OWN LABEL TEXT, never an FK to this template.
 * When the checklist changes next year, history must keep saying what was
 * actually done rather than being retitled by the current template. That is the
 * opposite call from personnel_note_kinds, deliberately: a note KIND is a
 * classification you filter and report on, so it wants a registry and an
 * `on update cascade`; a step is a line item whose wording is part of the
 * record.
 */

export interface OffboardingStep {
  label: string
  category: 'access' | 'property' | 'payroll' | 'authority' | 'external' | 'other'
  required: boolean
}

/**
 * The default steps, in the order they are worked.
 *
 * Access first because it is the time-critical one and the one an auditor asks
 * about; authority last because removing a signatory needs the bank's
 * confirmation and takes days rather than minutes.
 */
export const OFFBOARDING_TEMPLATE: OffboardingStep[] = [
  // ── Access ─────────────────────────────────────────────────────────────────
  { label: 'Platform access deactivated', category: 'access', required: true },
  { label: 'Google Workspace account suspended', category: 'access', required: true },
  { label: 'Mailbox and Drive ownership transferred', category: 'access', required: true },
  { label: 'Shared drive and folder access removed', category: 'access', required: true },
  { label: 'Password manager / shared credentials rotated', category: 'access', required: true },
  { label: 'Subcontractor and owner portal logins removed', category: 'access', required: false },
  { label: 'VPN / tailnet device removed', category: 'access', required: false },

  // ── Company property ───────────────────────────────────────────────────────
  { label: 'Laptop and devices returned', category: 'property', required: true },
  { label: 'Keys, badges and site access returned', category: 'property', required: true },
  { label: 'Company vehicle returned', category: 'property', required: false },
  { label: 'Tools and equipment returned', category: 'property', required: false },
  { label: 'Company card closed', category: 'property', required: true },

  // ── Pay and benefits ───────────────────────────────────────────────────────
  { label: 'Final pay processed', category: 'payroll', required: true },
  { label: 'Accrued PTO paid out', category: 'payroll', required: true },
  { label: 'Expense reimbursements settled', category: 'payroll', required: false },
  { label: 'Benefits terminated and COBRA notice issued', category: 'payroll', required: true },
  { label: 'Retirement plan notified', category: 'payroll', required: false },

  // ── Authority ──────────────────────────────────────────────────────────────
  // These are the ones that outlive the person if nobody closes them, and the
  // ones a lender's diligence asks about by name.
  { label: 'Signature authority ended (org_roles row closed)', category: 'authority', required: true },
  { label: 'Removed as bank signatory', category: 'authority', required: false },
  { label: 'Removed as registered agent / officer on state filings', category: 'authority', required: false },
  { label: 'Surety and bonding company notified', category: 'authority', required: false },
  { label: 'Contractor licence qualifier replaced', category: 'authority', required: false },

  // ── External ───────────────────────────────────────────────────────────────
  { label: 'Clients and project teams notified of the handover', category: 'external', required: true },
  { label: 'Restrictive covenants reviewed and reminder issued', category: 'external', required: true },
  { label: 'Open tasks reassigned', category: 'external', required: true },
]

/** Rows for a fresh checklist, ordered by the template. */
export function offboardingRowsFor(personnelId: string): Record<string, unknown>[] {
  return OFFBOARDING_TEMPLATE.map((step, index) => ({
    personnel_id: personnelId,
    label: step.label,
    category: step.category,
    required: step.required,
    sort_order: (index + 1) * 10,
  }))
}

/**
 * How far through the checklist a departure is.
 *
 * Counts REQUIRED steps separately, because that is the figure that means
 * anything: a departure with every required step closed and three optional ones
 * open is finished, and one where the optional steps were easy and "signature
 * authority ended" is still open is not. A single percentage of everything would
 * hide exactly the wrong one.
 */
export function offboardingProgress(
  rows: { required: boolean; completed_at: string | null }[]
): { requiredDone: number; requiredTotal: number; total: number; done: number; complete: boolean } {
  const requiredTotal = rows.filter((r) => r.required).length
  const requiredDone = rows.filter((r) => r.required && r.completed_at).length
  const done = rows.filter((r) => r.completed_at).length
  return {
    requiredDone,
    requiredTotal,
    total: rows.length,
    done,
    complete: requiredTotal > 0 && requiredDone === requiredTotal,
  }
}
