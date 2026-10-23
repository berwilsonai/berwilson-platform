/**
 * Attach the counterparties an opportunity's own correspondence already names.
 *
 * MEASURED 2026-10-22: `project_players` held 104 rows and every one of them
 * hung off a PROJECT. Not one of the ten opportunities had a single person
 * attached — including GridEdge (45 documents, 21 linked threads, 36 notes)
 * and Elite Solutions (34 linked threads), both at `negotiating`. So "who is
 * the counterparty on this deal" had no structured answer anywhere, while the
 * people themselves sat in `parties` on the deal's own confirmed threads.
 *
 * This derives the link rather than asking a human to retype it, which is the
 * platform's second job (CLAUDE.md: prefer the option that removes data entry
 * from a human).
 *
 * ⚠ IT CREATES NO CONTACT AND NO RECORD. §11 reserves that for a human
 * confirm. Both the party and the opportunity must already exist; the only row
 * written is the link between them, and `auto_derived` in the notes is the
 * undo handle for a whole run.
 *
 * ⚠ ONLY `certainty='linked'` THREADS COUNT. A suggested or ambiguous link is
 * the fuzzy matcher's guess; a `linked` one is a human's filing decision or a
 * deterministic resolve (§12 — a container a human filed into is an
 * assertion). Deriving from a guess would put a stranger on a live deal.
 *
 * ⚠ AND OUR OWN PEOPLE ARE EXCLUDED STRUCTURALLY, TWICE OVER. Eric is on 7 of
 * 7 opportunities and Richard on GridEdge — of course they are, they are the
 * two executives — so a naive pass "discovers" them on every deal and buries
 * the four people who are actually the counterparty. The tests are additive
 * (§12): `internalAddresses()` for the mailboxes and alternates, and
 * `team_members.party_id` for the roster, which is the link §9 says exists so
 * a task owner and a contact are one person. Deliberately NOT the `internal`
 * contact role — Trent Staggs carries it because his role prose on Myton Rail
 * reads "Internal reviewer" while he is at the SBA Office of Advocacy, so that
 * tag would have excluded a government official and kept nobody out.
 *
 * ⚠ THE ROLE IS LEFT FOR A HUMAN. What this pass knows is that the person took
 * part in the deal's correspondence, which is a FACT; what they are TO the
 * deal is a judgement, and §12 is explicit that a new placement is a
 * destination for the human, never a classification for the model. So the
 * prose says exactly what was derived, `categorizePlayerRole` is still the one
 * door (it returns null here, which is the honest answer), and re-roling is
 * one click in the picker. Where the person already holds a `party_roles` key
 * it is named in the notes as a hint, never written as the deal role: an
 * endorser TO US is not automatically the endorser ON GridEdge.
 *
 *   node --import ./deploy/register.mjs scripts/derive-opportunity-players.mts
 *   node --import ./deploy/register.mjs scripts/derive-opportunity-players.mts --apply
 */
import { createAdminClient } from '../src/lib/supabase/admin'
import { categorizePlayerRole } from '../src/lib/contacts/roles'
import { internalAddresses } from '../src/lib/commitments/internal-tasks'
import { loadPepperMembers } from '../src/lib/pepper/attribution'

const APPLY = process.argv.includes('--apply')

/** Written on every derived row, so one run is selectable and reversible. */
const DERIVED_MARK = 'auto_derived'

type Row = Record<string, unknown>

function lower(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : ''
}

async function main() {
  const db = createAdminClient()

  // ── Who is ours ────────────────────────────────────────────────────────────
  const members = await loadPepperMembers(db)
  const internal = internalAddresses(members)
  const { data: roster } = await db.from('team_members').select('party_id')
  const internalPartyIds = new Set(
    (roster ?? []).map((r) => (r as Row).party_id).filter((v): v is string => typeof v === 'string')
  )

  // ── The directory, by address ──────────────────────────────────────────────
  // Merged-away rows are excluded by their tombstone: a merge points them at
  // the winner, and linking the loser would re-fragment what the merge joined.
  const { data: parties, error: pErr } = await db
    .from('parties')
    .select('id, full_name, email, is_organization, status, merged_into_party_id')
    .not('email', 'is', null)
  if (pErr) throw new Error(`parties: ${pErr.message}`)

  const byAddress = new Map<string, { id: string; name: string }>()
  for (const raw of parties ?? []) {
    const p = raw as Row
    if (p.is_organization === true) continue
    if (p.status === 'archived') continue
    if (p.merged_into_party_id) continue
    const email = lower(p.email)
    if (!email) continue
    // Two parties on one address is a data problem, not a match (§12) — the
    // same rule the curator's matcher applies.
    if (byAddress.has(email)) {
      byAddress.delete(email)
      continue
    }
    byAddress.set(email, { id: String(p.id), name: String(p.full_name ?? '') })
  }

  // ── Roles held, as a hint only ─────────────────────────────────────────────
  const { data: heldRoles } = await db.from('party_roles').select('party_id, role_key')
  const roleHint = new Map<string, string[]>()
  for (const raw of heldRoles ?? []) {
    const r = raw as Row
    const key = String(r.party_id)
    roleHint.set(key, [...(roleHint.get(key) ?? []), String(r.role_key)])
  }

  // ── Opportunities and the threads a human filed onto them ─────────────────
  const { data: opps, error: oErr } = await db.from('opportunities').select('id, name')
  if (oErr) throw new Error(`opportunities: ${oErr.message}`)
  const oppName = new Map((opps ?? []).map((o) => [String((o as Row).id), String((o as Row).name)]))

  const { data: links, error: lErr } = await db
    .from('thread_links')
    .select('thread_id, record_id')
    .eq('record_kind', 'opportunity')
    .eq('certainty', 'linked')
  if (lErr) throw new Error(`thread_links: ${lErr.message}`)

  const threadIds = [...new Set((links ?? []).map((l) => String((l as Row).thread_id)))]
  // ⚠ Chunked apart from the row cap: a filter rides in the query string, so
  // `.in()` with a thousand uuids is a 37KB GET that Kong refuses (§12).
  const participants = new Map<string, string[]>()
  for (let i = 0; i < threadIds.length; i += 200) {
    const { data, error } = await db
      .from('email_threads')
      .select('id, participants')
      .in('id', threadIds.slice(i, i + 200))
    if (error) throw new Error(`email_threads: ${error.message}`)
    for (const raw of data ?? []) {
      const t = raw as Row
      participants.set(String(t.id), Array.isArray(t.participants) ? (t.participants as string[]) : [])
    }
  }

  // ── READ BEFORE WRITING, so a report of "added 14" has added fourteen ─────
  const { data: existing, error: eErr } = await db
    .from('project_players')
    .select('opportunity_id, party_id')
    .not('opportunity_id', 'is', null)
  if (eErr) throw new Error(`project_players: ${eErr.message}`)
  const already = new Set(
    (existing ?? []).map((r) => `${(r as Row).opportunity_id}:${(r as Row).party_id}`)
  )

  // ── Derive ─────────────────────────────────────────────────────────────────
  type Candidate = { oppId: string; partyId: string; partyName: string; via: string }
  const candidates = new Map<string, Candidate>()
  let internalSkipped = 0
  let unknownAddresses = 0

  for (const raw of links ?? []) {
    const link = raw as Row
    const oppId = String(link.record_id)
    if (!oppName.has(oppId)) continue
    for (const p of participants.get(String(link.thread_id)) ?? []) {
      // A participant is rendered as a bare address or as `Name <addr>`.
      const addr = lower(p.includes('<') ? p.slice(p.indexOf('<') + 1).replace('>', '') : p)
      if (!addr) continue
      if (internal.has(addr)) {
        internalSkipped++
        continue
      }
      const hit = byAddress.get(addr)
      if (!hit) {
        unknownAddresses++
        continue
      }
      if (internalPartyIds.has(hit.id)) {
        internalSkipped++
        continue
      }
      const key = `${oppId}:${hit.id}`
      if (already.has(key)) continue
      if (!candidates.has(key)) {
        candidates.set(key, { oppId, partyId: hit.id, partyName: hit.name, via: addr })
      }
    }
  }

  // ── Report, then write ─────────────────────────────────────────────────────
  const grouped = new Map<string, Candidate[]>()
  for (const c of candidates.values()) {
    grouped.set(c.oppId, [...(grouped.get(c.oppId) ?? []), c])
  }

  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} — ${candidates.size} link(s) to add across ${grouped.size} opportunity(ies)`
  )
  console.log(
    `  internal participants skipped: ${internalSkipped}; addresses not in the directory: ${unknownAddresses}; links already present: ${already.size}`
  )

  // The prose is identical for every derived row, so the role key is asked
  // once rather than once per person.
  const prose = 'In correspondence on this opportunity (derived from filed threads)'
  const roleKey = await categorizePlayerRole(prose)

  let written = 0
  for (const [oppId, list] of [...grouped.entries()].sort()) {
    console.log(`\n  ${oppName.get(oppId)}`)
    for (const c of list.sort((a, b) => a.partyName.localeCompare(b.partyName))) {
      const hints = roleHint.get(c.partyId) ?? []
      console.log(`    + ${c.partyName} <${c.via}>${hints.length ? `  [to us: ${hints.join(', ')}]` : ''}`)
      if (!APPLY) continue
      const { error } = await db.from('project_players').insert({
        opportunity_id: oppId,
        party_id: c.partyId,
        role: prose,
        role_key: roleKey,
        notes: `${DERIVED_MARK} 2026-10-22 — found on this deal's filed correspondence as ${c.via}.${
          hints.length ? ` Holds to us: ${hints.join(', ')} — not applied as the deal role.` : ''
        }`,
      })
      if (error) {
        console.error(`      ! ${error.message}`)
        continue
      }
      written++
    }
  }

  if (APPLY) console.log(`\nwrote ${written} link(s). Undo: delete project_players where notes like '${DERIVED_MARK}%'`)
  else console.log(`\nnothing written. Re-run with --apply.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
