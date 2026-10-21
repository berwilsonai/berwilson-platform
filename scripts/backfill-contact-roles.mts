/**
 * Categorise the free-text player roles, and seed what each contact is TO US.
 *
 * Two passes, both fill-only and both idempotent:
 *
 *   1. project_players.role_key  — the category behind the prose in `role`.
 *      The prose is never touched; "Broker — 4% fee" keeps its 4%.
 *   2. party_roles               — what somebody is to the business, seeded
 *      from the deal roles that TRAVEL (see DEAL_SCOPED_ROLES). A law firm is
 *      a law firm on every deal; the seller on one deal is not "a seller".
 *      Plus the `investor` tag, which 7 contacts already carry.
 *
 * ⚠ Prints and writes nothing by default. Run it, read the mapping, then
 * `--apply`. Run it twice: the second run must report nothing done (§12 — a
 * pass that reports what it did must read before it writes).
 *
 * Usage (repo root, on the Studio):
 *   node --experimental-strip-types --import ./scripts/register-aliases.mjs \
 *        --env-file=.env.local scripts/backfill-contact-roles.mts [--apply]
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { listContactRoles } from '@/lib/contacts/roles'
import { mapRoleText, travelsToContact } from '@/lib/contacts/role-mapping'

const APPLY = process.argv.includes('--apply')

async function main() {
  const db = createAdminClient()
  const registry = new Map((await listContactRoles()).map((r) => [r.key, r.label]))

  // ─── Pass 1: categorise the player rows ───────────────────────────────────

  const { data: players, error } = await db
    .from('project_players')
    .select('id, party_id, role, role_key')
  if (error) throw new Error(`Could not read project_players: ${error.message}`)

  const rows = players ?? []
  const proposals = new Map<string, { key: string | null; ids: string[]; n: number }>()
  for (const p of rows) {
    const existing = proposals.get(p.role)
    if (existing) {
      existing.n += 1
      if (!p.role_key) existing.ids.push(p.id)
      continue
    }
    proposals.set(p.role, {
      key: mapRoleText(p.role),
      ids: p.role_key ? [] : [p.id],
      n: 1,
    })
  }

  const ordered = [...proposals.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
  const mapped = ordered.filter(([, v]) => v.key)
  const unmapped = ordered.filter(([, v]) => !v.key)

  console.log(`\n── project_players: ${rows.length} rows, ${proposals.size} distinct role strings ──\n`)
  console.log('MAPPED\n')
  for (const [text, v] of mapped) {
    const label = registry.get(v.key!) ?? `⚠ ${v.key} NOT IN REGISTRY`
    console.log(`  ${String(v.n).padStart(2)}×  ${truncate(text, 62).padEnd(64)} → ${label}`)
  }
  console.log(`\nUNMAPPED — left uncategorised on purpose; the prose stays on \`role\`\n`)
  for (const [text, v] of unmapped) {
    console.log(`  ${String(v.n).padStart(2)}×  ${truncate(text, 62)}`)
  }

  const mappableRows = mapped.reduce((n, [, v]) => n + v.n, 0)
  const toWrite = mapped.flatMap(([, v]) => v.ids.map((id) => ({ id, key: v.key! })))
  console.log(
    `\n  ${mappableRows} of ${rows.length} rows categorised (${pct(mappableRows, rows.length)}), ` +
      `${toWrite.length} still to write.`
  )

  // ─── Pass 2: what each contact is TO US ───────────────────────────────────

  const wanted = new Map<string, Set<string>>()
  for (const p of rows) {
    const key = p.role_key ?? mapRoleText(p.role)
    if (!key || !travelsToContact(key)) continue
    const set = wanted.get(p.party_id) ?? new Set<string>()
    set.add(key)
    wanted.set(p.party_id, set)
  }

  // The `investor` tag is a human's own assertion and the only descriptive tag
  // with any mass (7 of 180 — the rest are provenance markers).
  const { data: tagged } = await db
    .from('parties')
    .select('id, tags')
    .contains('tags', ['investor'])
  for (const p of tagged ?? []) {
    const set = wanted.get(p.id) ?? new Set<string>()
    set.add('equity_investor')
    wanted.set(p.id, set)
  }

  const { data: already } = await db.from('party_roles').select('party_id, role_key')
  const have = new Map<string, Set<string>>()
  for (const r of already ?? []) {
    const set = have.get(r.party_id) ?? new Set<string>()
    set.add(r.role_key)
    have.set(r.party_id, set)
  }

  const inserts: { party_id: string; role_key: string }[] = []
  for (const [partyId, keys] of wanted) {
    for (const key of keys) {
      if (!have.get(partyId)?.has(key)) inserts.push({ party_id: partyId, role_key: key })
    }
  }

  const tally = new Map<string, number>()
  for (const i of inserts) tally.set(i.role_key, (tally.get(i.role_key) ?? 0) + 1)
  console.log(`\n── party_roles: ${wanted.size} contacts would carry a role to the business ──\n`)
  for (const [key, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(2)}×  ${registry.get(key) ?? key}`)
  }
  console.log(`\n  ${inserts.length} rows still to write.`)

  if (!APPLY) {
    console.log('\n  Nothing written. Re-run with --apply.\n')
    return
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  let wrote = 0
  for (const { id, key } of toWrite) {
    const { error: e } = await db.from('project_players').update({ role_key: key }).eq('id', id)
    if (e) throw new Error(`Could not set role_key on ${id}: ${e.message}`)
    wrote += 1
  }

  let seeded = 0
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200)
    const { error: e } = await db.from('party_roles').insert(chunk)
    if (e) throw new Error(`Could not seed party_roles: ${e.message}`)
    seeded += chunk.length
  }

  console.log(`\n  ✓ ${wrote} player rows categorised, ${seeded} contact roles seeded.\n`)
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}
function pct(a: number, b: number): string {
  return b === 0 ? '0%' : `${Math.round((a / b) * 100)}%`
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
