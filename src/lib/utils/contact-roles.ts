/**
 * Contact-role vocabulary — the pure half.
 *
 * ⚠ IN src/lib AND NOT A `'use client'` MODULE (§12). The registry itself
 * (`src/lib/contacts/roles.ts`) holds the service-role client and is
 * server-only; everything a browser component needs to RENDER a role lives
 * here, and the dependency points one way — the registry imports these types,
 * nothing imports the registry from the browser.
 *
 * Mirrors the arrangement of src/lib/utils/leads.ts beside src/lib/leads/categories.ts.
 */

import { chipTone, type Tone } from '@/lib/ui/tone'

/**
 * A role as a client component sees it. The whole row, minus `extraction_hint`
 * — that is written for the model, is paragraph-length, and has no reader in a
 * browser.
 */
export interface ContactRoleView {
  key: string
  label: string
  role_group: string
  sort_order: number
  active: boolean
  system: boolean
}

/**
 * Group → tone.
 *
 * The GROUP is a text column a human can invent a new value for at
 * /settings/contact-roles, so this cannot throw the way `chipTone` does: an
 * unrecognised group gets `neutral`, which reads as a role with no colour
 * rather than a 500. The class strings stay literal in source, which is the
 * half of §12 that actually matters ("a Tailwind class string stored in the
 * database is never generated").
 *
 * Hues are chosen so the three groups that carry MEANING for a reader scanning
 * the directory stand apart: Ber Wilson is our own people, Advisory is the
 * counsel relationship, Finance & Legal is the money.
 */
const GROUP_TONES: Record<string, Tone> = {
  'Ber Wilson': 'info',
  'Ownership & Development': 'violet',
  Construction: 'orange',
  'Design & Engineering': 'sky',
  'Finance & Legal': 'teal',
  Government: 'indigo',
  'Energy & Technology': 'cyan',
  'Transaction & Commercial': 'rose',
  'Advisory & Relationship': 'positive',
  'Consultants & Other': 'neutral',
}

export function roleGroupTone(group: string): Tone {
  return GROUP_TONES[group] ?? 'neutral'
}

export function roleChipClasses(group: string): string {
  return chipTone(roleGroupTone(group))
}

/** Label for a key, falling back to the key itself so a retired role still reads. */
export function roleLabel(key: string, roles: ContactRoleView[]): string {
  return roles.find((r) => r.key === key)?.label ?? key
}

/**
 * Roles bucketed by group, groups in `sort_order` order.
 *
 * Reading order IS declaration order (§12: "make its declaration order the
 * reading order"), and `sort_order` is group-major in tens, so a group's
 * position is simply its lowest-sorting member.
 */
export function groupRoles(roles: ContactRoleView[]): { group: string; roles: ContactRoleView[] }[] {
  const byGroup = new Map<string, ContactRoleView[]>()
  for (const r of [...roles].sort((a, b) => a.sort_order - b.sort_order)) {
    const list = byGroup.get(r.role_group)
    if (list) list.push(r)
    else byGroup.set(r.role_group, [r])
  }
  return [...byGroup.entries()].map(([group, rs]) => ({ group, roles: rs }))
}
