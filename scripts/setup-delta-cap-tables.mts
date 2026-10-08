/**
 * Seed the Delta vehicles' cap tables, and file the land owner in the cast.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/setup-delta-cap-tables.mts [--apply]
 *
 * Richard's two decisions, taken 2026-10-08:
 *   1. Seed Ber Wilson as sponsor on each vehicle with the SPLIT LEFT BLANK.
 *   2. Daves Farms is a SELLER, not a holder — it goes in the project's cast,
 *      not in any cap table.
 *
 * ⚠ `equity_pct` IS OMITTED, NOT SET TO 0. Nothing on file states a split, and
 * 0% says a holder owns none of the vehicle where NULL says nobody has agreed —
 * different facts about a deal, and `resolveBwShare` reads this exact column as
 * our share. An invented percentage would be reported as fact by the engine,
 * the brief and Ber AI. NULL is held out of the net total instead.
 *
 * ⚠ AND THE ABSENT FIELDS ARE OMITTED RATHER THAN NULLED, because an explicit
 * NULL does not fall back to a column's DEFAULT — it violates its NOT NULL
 * (CLAUDE.md §12, 10-06). `status` and `class` take their defaults here.
 *
 * ⚠ `is_ber_wilson` IS THE FLAG OUR SHARE IS READ FROM, never a name match —
 * "Ber Wilson" appears in half the entity names in this business. At most one
 * per vehicle, enforced by `uniq_spv_participants_bw`.
 *
 * Dry run by default; `--apply` writes. Idempotent: it reads the roll first and
 * reports what it skipped, so a second run claims nothing it did not do
 * (§12, 09-30).
 */

import { spvDb, spvDbAs } from '@/lib/spvs/db'
import { loadProjectSpvs } from '@/lib/spvs/queries'
import { participantTotals, resolveBwShare, splitWarnings } from '@/lib/spvs/ownership'
import { SPV_PURPOSE_LABELS } from '@/lib/spvs/types'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const apply = process.argv.includes('--apply')
const PROJECT_NAME_MATCH = 'Delta Industrial Campus'

/** From `company_profile.legal_name` — the name that goes on a signature block. */
const BW_LEGAL_NAME = 'Ber Wilson Corporation'

const LAND_OWNER = {
  fullName: 'Daves Farms Property Holdings, LLC',
  // ⚠ NOT 'Owner'. That value exists in `PROJECT_PLAYER_ROLES` but in a
  // construction CRM it reads as the project OWNER — the client — which Daves
  // Farms is not. Free text is idiomatic for this column (the live data holds
  // 23 descriptive roles) and `EditRoleButton` round-trips an unknown value
  // through its `__custom__` branch, so nothing renders blank.
  role: 'Land Owner / Seller',
  notes:
    'Record owner of all 11 subject parcels (928.98 acres per the rezone exhibit; ' +
    '920.67 per the Millard County assessor). Counterparty on a purchase or option — ' +
    'NOT a participant in Delta Land LLC. Added 2026-10-08 on Richard’s instruction.',
}

let failures = 0
function fail(message: string) {
  failures += 1
  console.log(`  ${RED}✗${OFF} ${message}`)
}

async function main() {
  const db = spvDb()
  const actor = { id: '00000000-0000-0000-0000-000000000000', email: 'setup@berwilson.com' }
  const write = spvDbAs(actor)

  // ── the project, refusing ambiguity ─────────────────────────────────────
  const { data: projects, error } = await db
    .from('projects')
    .select('id,name')
    .ilike('name', `%${PROJECT_NAME_MATCH}%`)
  if (error) throw new Error(`Could not read projects: ${error.message}`)
  const rows = (projects ?? []) as { id: string; name: string }[]
  if (rows.length !== 1) {
    throw new Error(
      rows.length === 0
        ? `No project matches "${PROJECT_NAME_MATCH}".`
        : `${rows.length} projects match "${PROJECT_NAME_MATCH}". Refusing to guess.`
    )
  }
  const project = rows[0]
  console.log(`${BOLD}${project.name}${OFF} ${DIM}${project.id}${OFF}`)

  // ── 1. the Ber Wilson sponsor row on each vehicle ───────────────────────
  const vehicles = await loadProjectSpvs('project', project.id)
  if (vehicles.length === 0) {
    throw new Error('This deal has no vehicles. Run scripts/setup-delta-vehicles.mts first.')
  }

  console.log(`\n${BOLD}1. Ber Wilson as sponsor, split left blank${OFF}`)
  const toSeed: { id: string; label: string }[] = []
  for (const v of vehicles) {
    const existing = v.participants.find((p) => p.isBerWilson)
    if (existing) {
      console.log(
        `  ${DIM}· ${v.label} — already has a Ber Wilson row (${existing.holderName}), skipping${OFF}`
      )
      continue
    }
    console.log(`  ${GREEN}+${OFF} ${v.label} ${DIM}(${SPV_PURPOSE_LABELS[v.purpose]})${OFF}`)
    toSeed.push({ id: v.id, label: v.label })
  }

  // The Ber Wilson organisation already in the directory, so the ledger row
  // links to a real contact rather than carrying a loose string.
  const { data: bwParty, error: bwError } = await db
    .from('parties')
    .select('id,full_name')
    .eq('is_organization', true)
    .ilike('full_name', 'Ber Wilson')
    .maybeSingle()
  if (bwError) throw new Error(`Could not read parties: ${bwError.message}`)
  const bwPartyId = (bwParty as { id: string } | null)?.id ?? null
  console.log(
    bwPartyId
      ? `  ${DIM}holder linked to the "Ber Wilson" directory record${OFF}`
      : `  ${YELLOW}!${OFF} no "Ber Wilson" organisation in the directory — the row will carry the name only`
  )

  // ── 2. the land owner in the cast ───────────────────────────────────────
  console.log(`\n${BOLD}2. ${LAND_OWNER.fullName} in the cast as ${LAND_OWNER.role}${OFF}`)
  const { data: ownerParty, error: ownerError } = await db
    .from('parties')
    .select('id,full_name')
    .ilike('full_name', LAND_OWNER.fullName)
    .maybeSingle()
  if (ownerError) throw new Error(`Could not read parties: ${ownerError.message}`)
  let ownerPartyId = (ownerParty as { id: string } | null)?.id ?? null
  console.log(
    ownerPartyId
      ? `  ${DIM}· already in the directory${OFF}`
      : `  ${GREEN}+${OFF} new directory record (organisation)`
  )

  let playerExists = false
  if (ownerPartyId) {
    const { data: player } = await db
      .from('project_players')
      .select('id,role')
      .eq('project_id', project.id)
      .eq('party_id', ownerPartyId)
      .maybeSingle()
    playerExists = player != null
    if (playerExists) {
      console.log(`  ${DIM}· already on this project's cast as "${(player as { role: string }).role}"${OFF}`)
    }
  }

  if (!apply) {
    console.log(`\n${DIM}Dry run. Re-run with --apply to write.${OFF}`)
    return
  }

  // ── write ───────────────────────────────────────────────────────────────
  if (toSeed.length > 0) {
    // One statement, one uniform column list. `equity_pct`, `capital_committed`
    // and the rest are ABSENT on purpose — see the header.
    const { error: insertError } = await write.from('project_spv_participants').insert(
      toSeed.map((v) => ({
        spv_id: v.id,
        holder_name: BW_LEGAL_NAME,
        holder_party_id: bwPartyId,
        is_ber_wilson: true,
        role: 'sponsor',
        sort_order: 0,
        note:
          'Sponsor and developer. Equity split not yet agreed — left undetermined rather than ' +
          'assumed, so the engine holds this vehicle’s revenue out of the net total instead of ' +
          'counting it as wholly ours.',
      }))
    )
    if (insertError) fail(`Could not seed the sponsor rows: ${insertError.message}`)
  }

  if (!ownerPartyId) {
    const { data: created, error: createError } = await write
      .from('parties')
      .insert({
        full_name: LAND_OWNER.fullName,
        is_organization: true,
        relationship_notes: LAND_OWNER.notes,
      })
      .select('id')
      .single()
    if (createError) fail(`Could not create the land owner: ${createError.message}`)
    else ownerPartyId = (created as { id: string }).id
  }

  if (ownerPartyId && !playerExists) {
    const { error: playerError } = await write.from('project_players').insert({
      project_id: project.id,
      party_id: ownerPartyId,
      role: LAND_OWNER.role,
      is_primary: false,
      notes: LAND_OWNER.notes,
    })
    if (playerError) fail(`Could not add the land owner to the cast: ${playerError.message}`)
  }

  // ── read back, do not trust the writes ──────────────────────────────────
  console.log(`\n${BOLD}On the deal now:${OFF}`)
  const after = await loadProjectSpvs('project', project.id)
  for (const v of after) {
    const share = resolveBwShare(v, v.participants)
    const totals = participantTotals(v.participants)
    console.log(`\n  ${BOLD}${v.label}${OFF} ${DIM}(${SPV_PURPOSE_LABELS[v.purpose]})${OFF}`)
    for (const p of v.participants) {
      console.log(
        `    ${p.isBerWilson ? '★' : '·'} ${p.holderName} ${DIM}— ${p.role}, equity ` +
          `${p.equityPct == null ? 'undetermined' : `${p.equityPct}%`}, committed ` +
          `${p.capitalCommitted == null ? 'none recorded' : p.capitalCommitted}${OFF}`
      )
    }
    console.log(
      `    ${DIM}our share: ${share.pct == null ? 'undetermined' : `${share.pct}%`} ` +
        `(${share.from}); ledger equity total: ${totals.equityPct ?? 'none'}${OFF}`
    )
    for (const w of splitWarnings(v, v.participants)) {
      console.log(`    ${YELLOW}⚠${OFF} ${w}`)
    }
    // The flag has to be there for a typed percentage to land anywhere useful.
    if (!v.participants.some((p) => p.isBerWilson)) {
      fail(`${v.label} has no row flagged as Ber Wilson`)
    }
  }

  const { data: cast, error: castError } = await db
    .from('project_players')
    .select('role, party:parties(full_name, is_organization)')
    .eq('project_id', project.id)
  if (castError) fail(`Could not read the cast: ${castError.message}`)
  console.log(`\n  ${BOLD}Cast${OFF}`)
  for (const row of (cast ?? []) as { role: string; party: { full_name: string } | null }[]) {
    console.log(`    · ${row.party?.full_name ?? 'unknown'} ${DIM}— ${row.role}${OFF}`)
  }

  console.log(
    failures === 0
      ? `\n${GREEN}${BOLD}Done.${OFF} No percentage was invented: every vehicle reports our share as undetermined until you set one.`
      : `\n${RED}${BOLD}${failures} problem(s).${OFF}`
  )
  if (failures > 0) process.exit(1)
}

main().catch((err) => {
  console.error(`${RED}✗ ${err instanceof Error ? err.message : String(err)}${OFF}`)
  process.exit(1)
})
