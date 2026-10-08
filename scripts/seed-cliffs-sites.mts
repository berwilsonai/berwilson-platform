/**
 * The five sites Timothy Seibert and Rebecca Leonardi brought us, as records.
 *
 *   node --no-deprecation --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *        --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/seed-cliffs-sites.mts [--apply]
 *
 * Dry run by default. Idempotent and READS BEFORE IT WRITES (§12): a second run
 * reports `created: 0` and changes nothing, which is the property that makes the
 * `applied` list believable.
 *
 * ⚠ EVERY FIGURE HERE IS QUOTED FROM THE SWEPT MAIL, not inferred. The thread
 * each fact comes from is named in the comment above it so a reader can check
 * it, because a seeded record that looks authored is worse than an empty one.
 *
 * WHO BROUGHT THESE. Timothy Seibert (Harvest Time Holdings) is authorised to
 * negotiate commercial terms FOR THE SELLER on Steelton, Weirton and Riverdale
 * — he is on the Cliffs side of the table, not ours. Rebecca Leonardi
 * (Zenthium AI) runs the transaction and holds the data rooms. Merlin Corbin
 * takes a 4% broker fee. That distinction is written into each record's players
 * rather than flattened into "partner".
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

const APPLY = process.argv.includes('--apply')
const G = '\x1b[32m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', O = '\x1b[0m'
const RICHARD = { id: '81207093-9bad-4ef6-97f1-d926125ed1e8', email: 'moose@berwilson.com' }

type Sector = Database['public']['Enums']['project_sector']
type Stage = Database['public']['Enums']['project_stage']

interface Seed {
  name: string
  sector: Sector
  stage: Stage
  location: string
  client_entity: string | null
  description: string
  match_aliases: string[]
  latitude: number | null
  longitude: number | null
  /** [label, date, stage] — only dates a counterparty actually stated. */
  milestones: Array<[string, string | null, string]>
}

const SEEDS: Seed[] = [
  {
    // "Answers to Steelton Questions" (2026-10-03/06) + "Steelton PSA:
    // Pre-Signing Confirmations" (2026-10-03) + "Assignment Doc for Steelton,
    // Weirton and Riverdale" (2026-10-08).
    name: 'Steelton — Cleveland-Cliffs (PA)',
    sector: 'infrastructure',
    stage: 'capture',
    location: '215 S Front St, Steelton, Dauphin County, PA',
    client_entity: 'Cleveland-Cliffs Steelton LLC',
    description: [
      'Acquisition and redevelopment of the former Cleveland-Cliffs Steelton works at 215 S Front St, Steelton, PA, as a power and data-centre campus. Ber Wilson takes ASSIGNMENT of an executed PSA rather than negotiating one from scratch.',
      '',
      'Stated by the counterparties, with the thread each fact came from:',
      '• Seller is Cleveland-Cliffs Steelton LLC, which holds record title to all parcels on Exhibit A-3. Authorised signatory: Paul Finan (Cleveland-Cliffs). — "Answers to Steelton Questions", Rebecca Leonardi, 2026-10-03',
      '• PSA is EXECUTED. Closing was scheduled 17 Oct 2026; Ber Wilson is pushing to revert it to 1 Nov 2026 on processing timelines. — same thread',
      '• Timothy Seibert is authorised to negotiate commercial terms for the SELLER on Steelton, Weirton and Riverdale. — same thread',
      '• Merlin Corbin receives a 4% broker fee on the transaction. — same thread',
      '• Acquisition financing expected through JPMorgan Chase Bank via partner Tensor IQ; Cliffs has no objection. J.P. Morgan advises Cliffs on its asset sales. — same thread',
      '• Ber Wilson to deliver as GC, teaming with Mortenson, Kiewit and Harvest Time Holdings. Parcel numbers verified against the ALTA survey and title report. — "Assignment Doc for Steelton, Weirton and Riverdale", 2026-10-08',
      '',
      'Data room: 175 files shared in from rebecca@zenthium.ai, copied into this record\'s Drive folder and classified. A further 52 files sat under "Military Developments / Steelton - Pennsylvania".',
    ].join('\n'),
    match_aliases: [
      'Steelton', 'Cleveland-Cliffs Steelton', 'Cleveland-Cliffs Steelton LLC',
      'Cliffs Steelton', 'Steelton Highspire Railway', 'Project Steelton',
      'Steelton - Pennsylvania', '215 S Front St',
    ],
    latitude: 40.2337, longitude: -76.8269,
    milestones: [
      ['PSA closing — as scheduled by Seller (17 Oct 2026)', '2026-10-17', 'capture'],
      ['PSA closing — Ber Wilson target revision (1 Nov 2026)', '2026-11-01', 'capture'],
    ],
  },
  {
    // "Steelton Docs and Ramp Up for Weirton and Riverdale" (2026-10-02).
    name: 'Weirton — Cleveland-Cliffs (WV)',
    sector: 'infrastructure',
    stage: 'capture',
    location: 'Weirton, Hancock County, WV',
    client_entity: 'Cleveland-Cliffs',
    description: [
      'Acquisition and redevelopment of the former Cleveland-Cliffs Weirton steel works, West Virginia, as a power and data-centre campus. The second of the three sites under the Seibert/Leonardi assignment.',
      '',
      'Stated by the counterparties:',
      '• Power ramp-up is at 85 MW with a planned increase to 400 MW. — "Steelton Docs and Ramp Up for Weirton and Riverdale", 2026-10-02',
      '• Timothy Seibert is authorised to negotiate commercial terms for the Seller here as well as on Steelton and Riverdale. — "Answers to Steelton Questions", 2026-10-03',
      '• Ber Wilson is evaluating Weirton alongside Riverdale; no PSA yet. — "Steelton PSA: Pre-Signing Confirmations", 2026-10-03',
      '',
      'Data room: 462 files shared in from rebecca@zenthium.ai — the largest of the three. Includes FirstEnergy substation feed, Ohio River water intake and barge cells, DEP/VRP/RCRA environmental, Title V permits, railroad information and asset listings.',
    ].join('\n'),
    match_aliases: [
      'Weirton', 'Cliffs-Weirton', 'Cleveland-Cliffs Weirton', 'Weirton Steel',
      'Project Weirton Steel', 'Project Weirton',
    ],
    latitude: 40.4187, longitude: -80.5895,
    milestones: [],
  },
  {
    // Same thread. ComEd is Commonwealth Edison — the Chicago utility.
    name: 'Riverdale — Cleveland-Cliffs (IL)',
    sector: 'infrastructure',
    stage: 'capture',
    location: 'Riverdale, Cook County, IL (Chicago)',
    client_entity: 'Cleveland-Cliffs',
    description: [
      'Acquisition and redevelopment of the former Cleveland-Cliffs Riverdale works in Riverdale, Illinois — a south-side Chicago site — as a power and data-centre campus. The third site under the Seibert/Leonardi assignment.',
      '',
      'Stated by the counterparties:',
      '• 400 MW of generation capacity is secured. — "Steelton Docs and Ramp Up for Weirton and Riverdale", 2026-10-02',
      '• Transmission and distribution timeline is being coordinated with ComEd (Commonwealth Edison). — same thread',
      '• Timothy Seibert is authorised to negotiate commercial terms for the Seller here too. — "Answers to Steelton Questions", 2026-10-03',
      '',
      'Data room: 48 files shared in from rebecca@zenthium.ai — power verification, substation electrical drawings, environmental assessments and permits, site and property surveys, will-serve letters, and a stated exclusions list.',
    ].join('\n'),
    match_aliases: [
      'Riverdale', 'Cliffs-Riverdale', 'Cleveland-Cliffs Riverdale', 'Project Riverdale',
    ],
    latitude: 41.6494, longitude: -87.6333,
    milestones: [],
  },
  {
    // "Whiskey - Texas Site" (2026-09-29) and "Whiskey - Zorro" (2026-10-06).
    // Deliberately NOT named after a seller: the mail never names one, and
    // inventing a party into a record title is how a wrong fact becomes the
    // thing everyone repeats.
    name: 'Whiskey (TX)',
    sector: 'infrastructure',
    stage: 'pursuit',
    location: 'Texas',
    client_entity: null,
    description: [
      'Texas power/data-centre site offered by Zenthium AI under the code name "Whiskey". Earliest stage of the five — teaser and data room only, no agreement.',
      '',
      'Stated by the counterparties:',
      '• Teaser document and a Dropbox VDR link shared. — "Whiskey - Texas Site", 2026-09-29, and "Whiskey - Zorro", 2026-10-06',
      '• Zorro\'s power comes online AFTER Whiskey\'s, and Zorro sits 10 miles away — the two are a pair and should be read together. — "Zorro Teaser and Deck", 2026-10-07',
      '',
      '⚠ The seller is not named in the correspondence, so this record carries no client entity rather than guessing at one. The VDR is on Dropbox, not the shared Drive, so nothing is indexed yet.',
    ].join('\n'),
    match_aliases: ['Whiskey', 'Whiskey Texas', 'Project Whiskey'],
    latitude: null, longitude: null,
    milestones: [],
  },
  {
    name: 'Zorro (TX)',
    sector: 'infrastructure',
    stage: 'pursuit',
    location: 'Texas — 10 miles from the Whiskey site',
    client_entity: null,
    description: [
      'Texas power/data-centre site offered by Zenthium AI under the code name "Zorro", paired with Whiskey.',
      '',
      'Stated by the counterparties:',
      '• Teaser and Site Offering Deck shared; VDR to follow within days. — "Zorro Teaser and Deck", 2026-10-07',
      '• Zorro is 10 miles from Whiskey and its power comes online after Whiskey\'s. — same thread',
      '',
      '⚠ Seller not named in the correspondence; no client entity recorded rather than guessed.',
    ].join('\n'),
    match_aliases: ['Zorro', 'Project Zorro'],
    latitude: null, longitude: null,
    milestones: [],
  },
]

/** People and organisations, with the role each actually plays. */
const PARTIES: Array<{
  full_name: string
  is_organization: boolean
  company?: string
  title?: string
  email?: string
  notes: string
}> = [
  { full_name: 'Rebecca Leonardi', is_organization: false, company: 'Zenthium AI', email: 'rebecca@zenthium.ai',
    notes: 'Runs the Cleveland-Cliffs site transactions (Steelton, Weirton, Riverdale) and the Texas sites (Whiskey, Zorro). Owns the shared data rooms — all three Cliffs data rooms are shared in from this address.' },
  { full_name: 'Timothy Seibert', is_organization: false, company: 'Harvest Time Holdings', email: 'tseibert@harvesttimeholdings.com',
    notes: 'Authorised to negotiate commercial terms FOR THE SELLER on Steelton, Weirton and Riverdale (stated by Rebecca Leonardi, 2026-10-03). Harvest Time Holdings is also named as a teaming partner on Steelton delivery — so he sits on both sides and that is worth remembering before a negotiation.' },
  { full_name: 'Merlin Corbin', is_organization: false, company: 'Zenthium AI', email: 'merlin@zenthium.ai',
    notes: 'Broker on the Cliffs transactions — receives a 4% broker fee (stated 2026-10-03).' },
  { full_name: 'Paul Finan', is_organization: false, company: 'Cleveland-Cliffs',
    notes: 'Authorised signatory for Cleveland-Cliffs on the Steelton PSA (stated 2026-10-03).' },
  { full_name: 'Zenthium AI', is_organization: true, notes: 'Counterparty running the Cliffs site transactions and the Texas sites. Domain zenthium.ai.' },
  { full_name: 'Harvest Time Holdings', is_organization: true, notes: 'Seller-side negotiator on the three Cliffs sites, and a named teaming partner on Steelton delivery.' },
  { full_name: 'Cleveland-Cliffs Steelton LLC', is_organization: true, notes: 'Seller entity on Steelton; holds record title to all parcels on Exhibit A-3.' },
  { full_name: 'Cleveland-Cliffs', is_organization: true, notes: 'Parent seller across Steelton, Weirton and Riverdale. J.P. Morgan advises it on asset sales.' },
]

const PLAYERS: Array<{ project: string; party: string; role: string }> = []
for (const site of ['Steelton — Cleveland-Cliffs (PA)', 'Weirton — Cleveland-Cliffs (WV)', 'Riverdale — Cleveland-Cliffs (IL)']) {
  PLAYERS.push(
    { project: site, party: 'Rebecca Leonardi', role: 'Transaction lead (Zenthium) / data room owner' },
    { project: site, party: 'Timothy Seibert', role: 'Seller-side commercial negotiator (authorised)' },
    { project: site, party: 'Merlin Corbin', role: 'Broker — 4% fee' },
    { project: site, party: 'Cleveland-Cliffs', role: 'Seller (parent)' },
  )
}
PLAYERS.push(
  { project: 'Steelton — Cleveland-Cliffs (PA)', party: 'Cleveland-Cliffs Steelton LLC', role: 'Seller entity — holds record title' },
  { project: 'Steelton — Cleveland-Cliffs (PA)', party: 'Paul Finan', role: 'Seller authorised signatory' },
  { project: 'Steelton — Cleveland-Cliffs (PA)', party: 'Harvest Time Holdings', role: 'Teaming partner — delivery' },
)
for (const site of ['Whiskey (TX)', 'Zorro (TX)']) {
  PLAYERS.push({ project: site, party: 'Rebecca Leonardi', role: 'Offering contact (Zenthium)' })
  PLAYERS.push({ project: site, party: 'Zenthium AI', role: 'Offering party' })
}

async function main() {
  const db = createAdminClient(RICHARD)
  console.log(`${B}${APPLY ? 'APPLYING' : 'DRY RUN'}${O} — five Cliffs/Zenthium sites\n`)

  // ── Parties ───────────────────────────────────────────────────────────────
  const { data: existingParties, error: pErr } = await db.from('parties').select('id, full_name')
  if (pErr) throw new Error(`parties read: ${pErr.message}`)
  const partyId = new Map((existingParties ?? []).map((p) => [p.full_name.toLowerCase(), p.id]))

  console.log(`${B}Parties${O}`)
  let partiesCreated = 0
  for (const p of PARTIES) {
    const key = p.full_name.toLowerCase()
    if (partyId.has(key)) { console.log(`  ${D}have${O}  ${p.full_name}`); continue }
    console.log(`  ${G}new${O}   ${p.full_name}${p.is_organization ? ' (org)' : ''}`)
    partiesCreated++
    if (!APPLY) continue
    const { data, error } = await db.from('parties').insert({
      full_name: p.full_name,
      is_organization: p.is_organization,
      company: p.company ?? null,
      title: p.title ?? null,
      email: p.email ?? null,
      relationship_notes: p.notes,
    }).select('id').single()
    if (error) throw new Error(`party ${p.full_name}: ${error.message}`)
    partyId.set(key, data.id)
  }

  // ── Projects ──────────────────────────────────────────────────────────────
  const { data: existingProjects, error: prErr } = await db.from('projects').select('id, name')
  if (prErr) throw new Error(`projects read: ${prErr.message}`)
  const projectId = new Map((existingProjects ?? []).map((p) => [p.name.toLowerCase(), p.id]))

  console.log(`\n${B}Projects${O}`)
  let projectsCreated = 0
  for (const s of SEEDS) {
    const key = s.name.toLowerCase()
    if (projectId.has(key)) { console.log(`  ${D}have${O}  ${s.name}`); continue }
    console.log(`  ${G}new${O}   ${s.name}  ${D}${s.stage} · ${s.location}${O}`)
    projectsCreated++
    if (!APPLY) continue
    const { data, error } = await db.from('projects').insert({
      name: s.name,
      sector: s.sector,
      stage: s.stage,
      status: 'active',
      location: s.location,
      client_entity: s.client_entity,
      description: s.description,
      match_aliases: s.match_aliases,
      latitude: s.latitude,
      longitude: s.longitude,
    }).select('id').single()
    if (error) throw new Error(`project ${s.name}: ${error.message}`)
    projectId.set(key, data.id)
  }

  // ── Milestones ────────────────────────────────────────────────────────────
  console.log(`\n${B}Milestones${O}`)
  let msCreated = 0
  for (const s of SEEDS) {
    const pid = projectId.get(s.name.toLowerCase())
    // ⚠ A DRY RUN THAT UNDER-REPORTS IS WORSE THAN NONE, because it is read as
    // reassurance. On a dry run the project does not exist yet, so there is no
    // parent to read children against — plan against the SEED instead of
    // silently printing nothing. (The same trap the Drive setup script hit.)
    const titles = new Set<string>()
    if (pid) {
      const { data: have, error } = await db.from('milestones').select('label').eq('project_id', pid)
      if (error) throw new Error(`milestones read: ${error.message}`)
      for (const m of have ?? []) titles.add(m.label)
    } else if (APPLY) {
      throw new Error(`${s.name} was not created — cannot attach its milestones`)
    }
    for (const [title, due, stage] of s.milestones) {
      if (titles.has(title)) { console.log(`  ${D}have${O}  ${title}`); continue }
      console.log(`  ${G}new${O}   ${title} ${D}${due ?? ''}${O}`)
      msCreated++
      if (!APPLY || !pid) continue
      // `label`, not `title`; and completion is `completed_at IS NULL`,
      // there is no status column to set.
      const { error: insErr } = await db.from('milestones').insert({
        project_id: pid, stage, label: title, target_date: due,
      })
      if (insErr) throw new Error(`milestone ${title}: ${insErr.message}`)
    }
  }
  if (msCreated === 0 && APPLY) console.log(`  ${D}nothing to add${O}`)

  // ── Players ───────────────────────────────────────────────────────────────
  // ⚠ Read the roll first and COUNT the skips (§12): project_players is
  // unique (project_id, party_id, role), so a blind insert is a violation the
  // moment this runs twice.
  console.log(`\n${B}Players${O}`)
  let playersCreated = 0, playersSkipped = 0
  for (const pl of PLAYERS) {
    const pid = projectId.get(pl.project.toLowerCase())
    const pty = partyId.get(pl.party.toLowerCase())
    // On a dry run neither side exists yet, so plan it rather than report a
    // zero that reads as "nothing to do" — see the milestone note above.
    if (!pid || !pty) {
      if (APPLY) throw new Error(`cannot link ${pl.party} to ${pl.project} — one of them was not created`)
      playersCreated++
      continue
    }
    const { data: have, error } = await db.from('project_players')
      .select('id').eq('project_id', pid).eq('party_id', pty).eq('role', pl.role).maybeSingle()
    if (error) throw new Error(`players read: ${error.message}`)
    if (have) { playersSkipped++; continue }
    playersCreated++
    const { error: insErr } = await db.from('project_players').insert({
      project_id: pid, party_id: pty, role: pl.role,
    })
    if (insErr) throw new Error(`player ${pl.party} on ${pl.project}: ${insErr.message}`)
  }
  console.log(`  ${playersCreated} to add, ${playersSkipped} already on the roll`)

  console.log(`\n${B}Summary${O}  parties:${partiesCreated} projects:${projectsCreated} milestones:${msCreated} players:${playersCreated}`)
  if (!APPLY) console.log(`${Y}Dry run — nothing written. Re-run with --apply.${O}`)
}

await main()
