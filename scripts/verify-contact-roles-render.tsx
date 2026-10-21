/**
 * Does the role UI actually render, for every shape the data can take?
 *
 * ⚠ BEHIND AUTH A CURL CANNOT TELL AN ANSWER FROM A THROW (§12) — /contacts
 * returns the same redirect whether the filter works or the page crashes. So
 * the components are rendered directly, on the shapes that actually occur: a
 * contact with no role (54 of 150 on 10-21), one with five, a role the
 * registry has RETIRED, and a role key pointing at nothing at all — which is
 * reachable the moment somebody deletes a row the cache still holds.
 *
 * Run:
 *   export PATH="$HOME/.node/bin:$PATH"
 *   npx tsx scripts/verify-contact-roles-render.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import {
  PathnameContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'

import ContactsClient, { type ContactWithStats } from '../src/components/contacts/ContactsClient'
import ContactRolesEditor from '../src/components/contacts/ContactRolesEditor'
import ContactRoleManager, { type RoleRow } from '../src/components/settings/ContactRoleManager'
import { groupRoles, roleChipClasses, roleLabel } from '../src/lib/utils/contact-roles'
import type { ContactRoleView } from '../src/lib/utils/contact-roles'

/**
 * ⚠ `useRouter`/`useSearchParams` THROW OUTSIDE THE APP ROUTER — "invariant
 * expected app router to be mounted" — so a component that keeps its filter in
 * the URL cannot be rendered by this harness without the contexts mounted.
 *
 * Mounted rather than skipped: skipping would leave the directory, the one
 * surface this change is FOR, with no render check at all, which is the gap
 * §12 means by "a listed route is not an answering one, and behind auth a curl
 * cannot tell you which it is".
 */
const ROUTER = {
  push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {},
} as unknown as React.ContextType<typeof AppRouterContext>

function mounted(node: React.ReactElement, search = ''): string {
  return renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      React.createElement(
        PathnameContext.Provider,
        { value: '/contacts' },
        React.createElement(
          SearchParamsContext.Provider,
          { value: new URLSearchParams(search) as unknown as ReadonlyURLSearchParamsLike },
          node
        )
      )
    )
  )
}
type ReadonlyURLSearchParamsLike = React.ContextType<typeof SearchParamsContext>

let pass = 0
let fail = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const ROLES: ContactRoleView[] = [
  { key: 'lender', label: 'Lender', role_group: 'Finance & Legal', sort_order: 400, active: true, system: false },
  { key: 'legal_counsel', label: 'Legal Counsel', role_group: 'Finance & Legal', sort_order: 440, active: true, system: false },
  { key: 'advisor', label: 'Advisor', role_group: 'Advisory & Relationship', sort_order: 800, active: true, system: false },
  { key: 'endorser', label: 'Endorser', role_group: 'Advisory & Relationship', sort_order: 810, active: true, system: false },
  { key: 'internal', label: 'Ber Wilson Team', role_group: 'Ber Wilson', sort_order: 10, active: true, system: true },
  { key: 'dbe_consultant', label: 'DBE Consultant', role_group: 'Consultants & Other', sort_order: 930, active: false, system: false },
  // ⚠ A group the tone map has never heard of. A human can invent one at
  // /settings/contact-roles, and `roleGroupTone` must answer `neutral` rather
  // than throwing the way `chipTone` does on an unknown TONE.
  { key: 'falconer', label: 'Falconer', role_group: 'Invented By A Human', sort_order: 999, active: true, system: false },
]

function contact(over: Partial<ContactWithStats> = {}): ContactWithStats {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    full_name: 'Jordan Reyes',
    company: 'Highland Title',
    title: 'Managing Director',
    email: 'jordan@example.com',
    phone: null,
    is_organization: false,
    avatar_url: null,
    tags: [],
    relationship_notes: null,
    project_count: 2,
    roles: ['Broker — 4% fee'],
    role_keys: ['lender'],
    last_active: '2026-10-01',
    ...over,
  }
}

console.log('\n── the pure helpers ──')
check('an unknown group falls back to neutral rather than throwing', (() => {
  try {
    return roleChipClasses('Invented By A Human').includes('bg-muted')
  } catch {
    return false
  }
})())
check('a key with no row renders as the key, not as blank', roleLabel('ghost_role', ROLES) === 'ghost_role')
check(
  'groups come back in sort_order, not alphabetically',
  groupRoles(ROLES).map((g) => g.group)[0] === 'Ber Wilson',
  groupRoles(ROLES).map((g) => g.group).join(' → ')
)

console.log('\n── the directory, every shape ──')
const SHAPES: { name: string; contacts: ContactWithStats[] }[] = [
  { name: 'nobody has a role at all', contacts: [contact({ role_keys: [] })] },
  { name: 'one contact, one role', contacts: [contact()] },
  {
    name: 'five roles on one row (the +n path)',
    contacts: [contact({ role_keys: ['lender', 'legal_counsel', 'advisor', 'endorser', 'internal'] })],
  },
  {
    name: 'a RETIRED role somebody still holds',
    contacts: [contact({ role_keys: ['dbe_consultant'] })],
  },
  {
    name: 'a role key the registry does not have',
    contacts: [contact({ role_keys: ['deleted_yesterday'] })],
  },
  { name: 'an organization', contacts: [contact({ is_organization: true, full_name: 'BTR Construction Contracting Inc', role_keys: ['internal'] })] },
  { name: 'no contacts', contacts: [] },
]

for (const shape of SHAPES) {
  let markup = ''
  try {
    markup = mounted(
      React.createElement(ContactsClient, { contacts: shape.contacts, roles: ROLES })
    )
  } catch (e) {
    check(shape.name, false, e instanceof Error ? e.message : String(e))
    continue
  }
  const bad = ['NaN', 'undefined', 'Infinity', '[object Object]'].filter((t) => markup.includes(t))
  check(shape.name, bad.length === 0, bad.join(', '))
}

console.log('\n── the editor ──')
for (const [name, initial] of [
  ['no roles yet', [] as string[]],
  ['a retired role', ['dbe_consultant']],
  ['a key with no row', ['deleted_yesterday']],
] as const) {
  let markup = ''
  try {
    markup = mounted(
      React.createElement(ContactRolesEditor, {
        partyId: '1',
        initialRoles: [...initial],
        roles: ROLES,
      })
    )
  } catch (e) {
    check(name, false, e instanceof Error ? e.message : String(e))
    continue
  }
  check(name, !/NaN|undefined|Infinity/.test(markup))
}
check(
  'an empty role list says so rather than rendering a bare dash',
  mounted(
    React.createElement(ContactRolesEditor, { partyId: '1', initialRoles: [], roles: ROLES })
  ).includes('No role yet')
)

console.log('\n── the settings screen ──')
{
  const rows: RoleRow[] = ROLES.map((r) => ({ ...r, id: r.key, extraction_hint: null }))
  for (const [name, counts] of [
    ['nothing is held yet', {}],
    ['one role held by contacts only', { lender: { contacts: 3, players: 0 } }],
    ['one role held on deals only', { advisor: { contacts: 0, players: 2 } }],
    ['both', { lender: { contacts: 3, players: 2 } }],
  ] as const) {
    let markup = ''
    try {
      markup = mounted(
        React.createElement(ContactRoleManager, { initial: rows, counts: { ...counts } })
      )
    } catch (e) {
      check(name, false, e instanceof Error ? e.message : String(e))
      continue
    }
    check(name, !/NaN|undefined|Infinity/.test(markup))
  }

  // A singular count must not read "1 contacts".
  const one = mounted(
    React.createElement(ContactRoleManager, {
      initial: rows,
      counts: { lender: { contacts: 1, players: 1 } },
    })
  )
  check('counts are singular when they are one', one.includes('1 contact') && !one.includes('1 contacts'))
  check('a role nobody holds reads "unused"', one.includes('unused'))
}

console.log('\n── the filter actually filters ──')
{
  const people = [
    contact({ id: 'a', full_name: 'A Lender', role_keys: ['lender'] }),
    contact({ id: 'b', full_name: 'B Advisor', role_keys: ['advisor'] }),
    contact({ id: 'c', full_name: 'C Nothing', role_keys: [] }),
  ]
  const all = mounted(React.createElement(ContactsClient, { contacts: people, roles: ROLES }))
  check('with no filter, everybody renders',
    all.includes('A Lender') && all.includes('B Advisor') && all.includes('C Nothing'))

  const filtered = mounted(
    React.createElement(ContactsClient, { contacts: people, roles: ROLES }),
    'roles=lender'
  )
  check('?roles=lender keeps the lender', filtered.includes('A Lender'))
  check('…and drops the others', !filtered.includes('B Advisor') && !filtered.includes('C Nothing'))

  const two = mounted(
    React.createElement(ContactsClient, { contacts: people, roles: ROLES }),
    'roles=lender,advisor'
  )
  check('two roles is OR, not AND', two.includes('A Lender') && two.includes('B Advisor'))
  check('…and still excludes the roleless one', !two.includes('C Nothing'))

  const none = mounted(
    React.createElement(ContactsClient, { contacts: people, roles: ROLES }),
    'roles=endorser'
  )
  check('an empty result says the ROLE is empty, not that the search failed',
    none.includes('No contacts hold that role yet'))
}

console.log(fail === 0 ? `\n✓ ${pass} render checks passed\n` : `\n✗ ${fail} of ${pass + fail} failed\n`)
process.exitCode = fail === 0 ? 0 : 1
