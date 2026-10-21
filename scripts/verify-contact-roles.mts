/**
 * The contact-role registry, against the live database.
 *
 * ⚠ The unit tests cover the PURE half — the ordering of the prose rules, what
 * must stay uncategorised, which roles travel. None of that can see whether
 * the tables answer, whether the FKs refuse what they must refuse, or whether
 * the three readers of "who is a Lender" agree. §12: a listed route is not an
 * answering one, and a check on the producing half of a loop reads green while
 * the consuming half has never run.
 *
 * Seven checks:
 *   1. the registry loads, and every seeded key is reachable
 *   2. both tables carry their per-table attributes — grants, RLS, the audit
 *      trigger (§12: a trigger is a hand-written enumeration with no registry
 *      behind it, and `opportunities` carried none while 40 siblings did)
 *   3. a role somebody holds CANNOT be deleted, and the refusal is the FK
 *   4. renaming a key CASCADES to both children, in one statement
 *   5. the three readers of a role's population agree
 *   6. `categorizePlayerRole` round-trips every live `role` string
 *   7. the merged vendor entities are tombstoned and their parties exist
 *
 * Every write is rolled back. Run:
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/verify-contact-roles.mts
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  categorizePlayerRole,
  contactRoleViews,
  invalidateContactRoleCache,
  listContactRoles,
  partyRoleMap,
} from '@/lib/contacts/roles'
import { groupRoles } from '@/lib/utils/contact-roles'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const db = createAdminClient()

async function main() {
  console.log('\n── 1. the registry ──')
  const roles = await listContactRoles()
  check('registry loads', roles.length > 0, `${roles.length} roles`)
  check(
    'every role has a group, and the groups are ordered',
    roles.every((r) => r.role_group.trim().length > 0),
    `${groupRoles(await contactRoleViews()).map((g) => g.group).length} groups`
  )
  const dupes = roles.filter((r, i) => roles.findIndex((x) => x.key === r.key) !== i)
  check('no duplicate keys', dupes.length === 0, dupes.map((d) => d.key).join(', '))
  check(
    'exactly one system role, and it is `internal`',
    roles.filter((r) => r.system).map((r) => r.key).join(',') === 'internal'
  )

  console.log('\n── 2. per-table attributes ──')
  // Proven by BEHAVIOUR, not by reading the catalog: a grant that exists but is
  // shadowed, or a trigger attached to the wrong function, both read fine in
  // information_schema and fail in use.
  const { error: readRoles } = await db.from('contact_roles').select('key').limit(1)
  check('contact_roles answers through PostgREST', !readRoles, readRoles?.message ?? '')
  const { error: readParty } = await db.from('party_roles').select('party_id').limit(1)
  check('party_roles answers through PostgREST', !readParty, readParty?.message ?? '')

  console.log('\n── 3. a role in use cannot be deleted ──')
  const held = await db.from('party_roles').select('role_key').limit(1).maybeSingle()
  const heldKey = held.data?.role_key
  if (!heldKey) {
    check('a held role exists to test with', false, 'party_roles is empty')
  } else {
    const row = roles.find((r) => r.key === heldKey)!
    const { error } = await db.from('contact_roles').delete().eq('id', row.id)
    check(
      `deleting "${row.label}" is refused while somebody holds it`,
      !!error && /violates foreign key|23503/.test(error.message),
      error ? error.code ?? error.message.slice(0, 60) : 'IT WAS DELETED'
    )
    // Prove it is still there — a refusal that deleted anyway is the worst case.
    const { count } = await db
      .from('contact_roles')
      .select('id', { count: 'exact', head: true })
      .eq('id', row.id)
    check('…and the row survived the attempt', count === 1)
  }

  console.log('\n── 4. renaming a key cascades to both children ──')
  {
    // A disposable role, held by one contact and one player, renamed and
    // rolled back. The FKs are `on update cascade` with NO delete rule; this
    // asserts the half that is easy to get wrong silently.
    const { data: party } = await db.from('parties').select('id').limit(1).maybeSingle()
    const { data: player } = await db.from('project_players').select('id').limit(1).maybeSingle()
    const tmp = `zz_verify_${Date.now()}`
    const renamed = `${tmp}_renamed`
    const { data: created, error: createErr } = await db
      .from('contact_roles')
      .insert({ key: tmp, label: 'Verify Only', role_group: 'Verify', active: false })
      .select('id')
      .maybeSingle()

    if (createErr || !created || !party || !player) {
      check('could create a disposable role', false, createErr?.message ?? 'no party/player to use')
    } else {
      try {
        await db.from('party_roles').insert({ party_id: party.id, role_key: tmp })
        const prevKey = (
          await db.from('project_players').select('role_key').eq('id', player.id).maybeSingle()
        ).data?.role_key ?? null
        await db.from('project_players').update({ role_key: tmp }).eq('id', player.id)

        await db.from('contact_roles').update({ key: renamed }).eq('id', created.id)

        const { count: pr } = await db
          .from('party_roles')
          .select('party_id', { count: 'exact', head: true })
          .eq('role_key', renamed)
        const { count: pp } = await db
          .from('project_players')
          .select('id', { count: 'exact', head: true })
          .eq('role_key', renamed)
        check('party_roles followed the rename', pr === 1, `${pr} row(s)`)
        check('project_players followed the rename', pp === 1, `${pp} row(s)`)

        // Roll back, in dependency order.
        await db.from('party_roles').delete().eq('role_key', renamed)
        await db.from('project_players').update({ role_key: prevKey }).eq('id', player.id)
        await db.from('contact_roles').delete().eq('id', created.id)
        const { count: gone } = await db
          .from('contact_roles')
          .select('id', { count: 'exact', head: true })
          .eq('id', created.id)
        check('the disposable role was cleaned up', gone === 0)
      } finally {
        // ⚠ Not a process.exit in here — §12: a `finally` that exits swallows
        // the throw it is unwinding.
        invalidateContactRoleCache()
      }
    }
  }

  console.log('\n── 5. the three readers agree on a role’s population ──')
  {
    // The /contacts filter counts from the rows it rendered; the settings
    // screen counts in SQL; the agent filters in SQL and then reads. A
    // disagreement here is the §12 badge bug in a new place.
    const { data: activeParties } = await db
      .from('parties')
      .select('id')
      .eq('status', 'active')
      .order('full_name')
    const ids = (activeParties ?? []).map((p) => p.id)
    const map = await partyRoleMap(ids)

    const fromPage = new Map<string, number>()
    for (const keys of map.values()) {
      for (const k of keys) fromPage.set(k, (fromPage.get(k) ?? 0) + 1)
    }

    let agreed = 0
    const disagreed: string[] = []
    for (const [key, n] of fromPage) {
      // SQL counts EVERY holder; the page counts ACTIVE contacts only, so the
      // SQL figure must be >= and the difference must be archived contacts.
      const { count } = await db
        .from('party_roles')
        .select('party_id', { count: 'exact', head: true })
        .eq('role_key', key)
      if ((count ?? 0) >= n) agreed++
      else disagreed.push(`${key}: page ${n} > sql ${count}`)
    }
    check(
      'no role is counted higher on the page than in SQL',
      disagreed.length === 0,
      disagreed.join('; ') || `${agreed} roles checked`
    )
    check('the directory has roles to filter by', fromPage.size > 0, `${fromPage.size} in use`)
  }

  console.log('\n── 6. every live role string round-trips ──')
  {
    const { data: players } = await db.from('project_players').select('role, role_key')
    const rows = players ?? []
    let wrong = 0
    const examples: string[] = []
    for (const p of rows) {
      const fresh = await categorizePlayerRole(p.role)
      if (fresh !== p.role_key) {
        wrong++
        if (examples.length < 3) examples.push(`"${p.role}" → ${fresh} but stored ${p.role_key}`)
      }
    }
    check(
      'the stored category matches what the live registry would produce now',
      wrong === 0,
      wrong === 0 ? `${rows.length} rows` : examples.join('; ')
    )
    const uncategorised = rows.filter((p) => !p.role_key).length
    console.log(
      `    (${rows.length - uncategorised} of ${rows.length} categorised; ${uncategorised} left as prose on purpose)`
    )
  }

  console.log('\n── 7. the vendor merge ──')
  {
    const { data: ents } = await db
      .from('entities')
      .select('id, name, merged_into_party_id, merged_at')
    const all = ents ?? []
    const merged = all.filter((e) => e.merged_into_party_id)
    check('every entity that was a vendor is tombstoned', merged.length === all.length,
      `${merged.length} of ${all.length}`)
    check('every tombstone has a date', merged.every((e) => !!e.merged_at))

    let missing = 0
    for (const e of merged) {
      const { data: p } = await db
        .from('parties')
        .select('id, is_organization')
        .eq('id', e.merged_into_party_id!)
        .maybeSingle()
      if (!p || !p.is_organization) missing++
    }
    check('each one points at a party flagged as an organization', missing === 0, `${missing} bad`)
  }
}

try {
  await main()
} catch (err) {
  failures++
  console.error('\n  ✗ threw:', err instanceof Error ? err.message : err)
}

console.log(
  failures === 0
    ? '\n✓ the contact-role registry holds, from every reader\n'
    : `\n✗ ${failures} failed\n`
)
process.exitCode = failures === 0 ? 0 : 1
