/**
 * scripts/seed.ts
 * Realistic seed data for 3 Ber Wilson test projects.
 * Run: npx tsx scripts/seed.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch {
  // env vars already set externally
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insert(table: string, rows: Record<string, unknown> | Record<string, unknown>[]): Promise<any[]> {
  const arr = Array.isArray(rows) ? rows : [rows]
  const { data, error } = await db.from(table).insert(arr).select()
  if (error) {
    console.error(`  ✗ insert ${table}:`, error.message)
    throw error
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any[]
}

function log(msg: string) {
  console.log(msg)
}

// ---------------------------------------------------------------------------
// WIPE existing seed data (any project matching our names)
// ---------------------------------------------------------------------------
async function wipe() {
  log('\n⚠️  Wiping existing seed data…')

  // Delete projects by name (cascades to all child tables: updates, milestones, players, financing, dd_items, compliance_items, documents, entity_projects)
  const { data: existingProjects } = await db
    .from('projects')
    .select('id')
    .in('name', [
      'USACE Fort Bragg Barracks Renovation',
      'Salt Lake Mixed-Use Development',
      'Rocky Mountain Quantum Data Center',
    ])
  if (existingProjects && existingProjects.length > 0) {
    const ids = existingProjects.map((p: { id: string }) => p.id)

    // Explicitly delete child tables first to handle any orphaned rows from previous failed runs
    // (cascade should handle this, but belt-and-suspenders after multi-run DB drift)
    await db.from('updates').delete().in('project_id', ids)
    await db.from('milestones').delete().in('project_id', ids)
    await db.from('financing_structures').delete().in('project_id', ids)
    await db.from('dd_items').delete().in('project_id', ids)
    await db.from('compliance_items').delete().in('project_id', ids)
    await db.from('documents').delete().in('project_id', ids)
    await db.from('entity_projects').delete().in('project_id', ids)
    await db.from('project_players').delete().in('project_id', ids)
    await db.from('review_queue').delete().in('project_id', ids)

    await db.from('projects').delete().in('id', ids)
    log(`  Deleted ${ids.length} project(s) and all associated records`)
  }

  // Delete ALL seed parties by collecting their IDs first (safer than .like on delete)
  const { data: existingParties } = await db
    .from('parties')
    .select('id')
    .like('email', '%@seed.berwilson.com')
  if (existingParties && existingParties.length > 0) {
    const ids = existingParties.map((p: { id: string }) => p.id)
    await db.from('parties').delete().in('id', ids)
    log(`  Deleted ${ids.length} seed parties`)
  }

  // Delete seed entities by name
  const seedEntityNames = [
    'Ber Wilson Construction LLC', 'BW-Fort Bragg JV LLC',
    'KEB Private Equity Fund IV LP', 'BW-SLC Mixed Use Partners LLC',
    'Rocky Mountain Infrastructure Partners LLC', 'BW Quantum Ventures LLC',
    'RMI-BW Data Center JV LLC',
  ]
  const { data: existingEntities } = await db.from('entities').select('id').in('name', seedEntityNames)
  if (existingEntities && existingEntities.length > 0) {
    const ids = existingEntities.map((e: { id: string }) => e.id)
    await db.from('entities').delete().in('id', ids)
    log(`  Deleted ${ids.length} seed entities`)
  }
}

// ---------------------------------------------------------------------------
// PARTIES  (global rolodex)
// ---------------------------------------------------------------------------
async function seedParties() {
  log('\n👤 Seeding parties…')

  const rows = [
    // --- Fort Bragg ---
    {
      full_name: 'Col. Patricia Hendricks',
      company: 'USACE Wilmington District',
      title: 'Contracting Officer',
      email: 'p.hendricks@seed.berwilson.com',
      phone: '910-555-0101',
      relationship_notes: 'Primary KO on the Fort Bragg BQ-22 task order. Responsive, by-the-book. Gets on calls same day.',
      is_organization: false,
    },
    {
      full_name: 'Marcus Delgado',
      company: 'Ber Wilson Construction',
      title: 'Project Manager',
      email: 'm.delgado@seed.berwilson.com',
      phone: '801-555-0102',
      relationship_notes: 'Our PM running day-to-day at Fort Bragg. Strong on schedule, needs support on change order tracking.',
      is_organization: false,
    },
    {
      full_name: 'Sarah Okonkwo',
      company: 'Jacobs Engineering',
      title: 'Architect of Record',
      email: 's.okonkwo@seed.berwilson.com',
      phone: '704-555-0103',
      relationship_notes: 'Architect on BQ-22. Has worked USACE projects for 15 years. Good relationship with USACE QA.',
      is_organization: false,
    },
    {
      full_name: 'Danny Kowalski',
      company: 'Tri-State Electrical',
      title: 'Superintendent',
      email: 'd.kowalski@seed.berwilson.com',
      phone: '910-555-0104',
      relationship_notes: 'Electrical sub. Family business out of Fayetteville. Davis-Bacon certified, SB preference met.',
      is_organization: false,
    },
    {
      full_name: 'Rosa Menendez',
      company: 'Atlantic Concrete & Masonry',
      title: 'Project Executive',
      email: 'r.menendez@seed.berwilson.com',
      phone: '910-555-0105',
      relationship_notes: 'Concrete sub. HUBZone certified — counts toward our small business sub plan.',
      is_organization: false,
    },
    {
      full_name: 'Lt. Col. James Barrera',
      company: 'USACE Fort Bragg DPW',
      title: 'COR / Owner Rep',
      email: 'j.barrera@seed.berwilson.com',
      phone: '910-555-0106',
      relationship_notes: 'COR on site daily. Pushes hard on punch list but fair.',
      is_organization: false,
    },
    // --- Salt Lake ---
    {
      full_name: 'Todd Whitmore',
      company: 'KEB Private Equity',
      title: 'Managing Director',
      email: 't.whitmore@seed.berwilson.com',
      phone: '212-555-0201',
      relationship_notes: 'Key PE partner contact at KEB. Decision-maker on equity commitment and waterfall. Met through NAIOP.',
      is_organization: false,
    },
    {
      full_name: 'Anita Sorensen',
      company: 'Sorensen Land Holdings',
      title: 'Principal',
      email: 'a.sorensen@seed.berwilson.com',
      phone: '801-555-0202',
      relationship_notes: 'Land owner contributing site to JV. Needs senior position in waterfall. Represented by Parsons Behle.',
      is_organization: false,
    },
    {
      full_name: 'Derek Lau',
      company: 'FFKR Architects',
      title: 'Principal-in-Charge',
      email: 'd.lau@seed.berwilson.com',
      phone: '801-555-0203',
      relationship_notes: 'Design-build architect. Strong SLC mixed-use portfolio. Selected based on relationship and local market knowledge.',
      is_organization: false,
    },
    {
      full_name: 'Jennifer Nakamura',
      company: 'Mountain West Civil Engineers',
      title: 'Lead Civil Engineer',
      email: 'j.nakamura@seed.berwilson.com',
      phone: '801-555-0204',
      relationship_notes: 'Civil engineer on the SLC site. Working through entitlement process with Salt Lake City Planning.',
      is_organization: false,
    },
    {
      full_name: 'Brian Taft',
      company: 'Wells Fargo Construction Finance',
      title: 'Senior Relationship Manager',
      email: 'b.taft@seed.berwilson.com',
      phone: '801-555-0205',
      relationship_notes: 'Construction lender. Term sheet pending. Wants full KEB equity commitment before finalizing.',
      is_organization: false,
    },
    // --- Rocky Mountain ---
    {
      full_name: 'Dr. Elena Vasquez',
      company: 'QantumEdge Computing',
      title: 'VP Infrastructure',
      email: 'e.vasquez@seed.berwilson.com',
      phone: '720-555-0301',
      relationship_notes: 'End user / owner representative. Former Google data center lead. Technically sophisticated. Drives hard on SLA.',
      is_organization: false,
    },
    {
      full_name: 'Michael Chen',
      company: 'Rocky Mountain Infrastructure Partners',
      title: 'Principal',
      email: 'm.chen@seed.berwilson.com',
      phone: '303-555-0302',
      relationship_notes: 'Infrastructure PE firm sponsoring the deal. Wants CMAR delivery with Ber Wilson as builder.',
      is_organization: false,
    },
    {
      full_name: 'Robert Finch',
      company: 'Xcel Energy',
      title: 'Large Commercial Accounts',
      email: 'r.finch@seed.berwilson.com',
      phone: '720-555-0303',
      relationship_notes: 'Utility contact for 100MW power commitment. Critical path item — negotiating PSA now.',
      is_organization: false,
    },
    {
      full_name: 'Stephanie Park',
      company: 'Mortenson Construction',
      title: 'VP Business Development',
      email: 's.park@seed.berwilson.com',
      phone: '303-555-0304',
      relationship_notes: 'Potential teaming partner / co-GC on the data center. Bringing MEP specialty capability.',
      is_organization: false,
    },
    {
      full_name: 'Carlos Whitfield',
      company: 'AECOM',
      title: 'Program Director',
      email: 'c.whitfield@seed.berwilson.com',
      phone: '303-555-0305',
      relationship_notes: 'Owner\'s program management firm. Controls RFP process and selection criteria. Key influencer.',
      is_organization: false,
    },
  ]

  const created = await insert('parties', rows)
  log(`  Created ${created.length} parties`)
  return created
}

// ---------------------------------------------------------------------------
// ENTITIES
// ---------------------------------------------------------------------------
async function seedEntities() {
  log('\n🏛  Seeding entities…')

  const rows = [
    {
      name: 'Ber Wilson Construction LLC',
      entity_type: 'llc',
      jurisdiction: 'Utah',
      ownership_pct: 100,
      notes: 'Primary operating entity for all construction operations.',
    },
    {
      name: 'BW-Fort Bragg JV LLC',
      entity_type: 'jv',
      jurisdiction: 'North Carolina',
      ownership_pct: null,
      formation_date: '2024-11-01',
      notes: 'JV entity for Fort Bragg task order. Ber Wilson 100% — no teaming partner needed on this award.',
    },
    {
      name: 'KEB Private Equity Fund IV LP',
      entity_type: 'fund',
      jurisdiction: 'Delaware',
      ownership_pct: null,
      notes: 'KEB PE vehicle for SLC mixed-use equity investment. ~$22M equity commitment pending.',
    },
    {
      name: 'BW-SLC Mixed Use Partners LLC',
      entity_type: 'jv',
      jurisdiction: 'Utah',
      ownership_pct: null,
      formation_date: '2025-09-15',
      notes: 'Development JV entity. Ber Wilson 40%, KEB Fund IV 45%, Sorensen Land 15% via land contribution.',
    },
    {
      name: 'Rocky Mountain Infrastructure Partners LLC',
      entity_type: 'llc',
      jurisdiction: 'Colorado',
      ownership_pct: null,
      notes: 'RMIP sponsor entity for the data center development.',
    },
    {
      name: 'BW Quantum Ventures LLC',
      entity_type: 'llc',
      jurisdiction: 'Utah',
      ownership_pct: null,
      notes: 'Ber Wilson vehicle for equity co-invest and builder role on Rocky Mountain Quantum Data Center.',
    },
    {
      name: 'RMI-BW Data Center JV LLC',
      entity_type: 'jv',
      jurisdiction: 'Colorado',
      ownership_pct: null,
      notes: 'Development and ownership JV — RMIP 60%, BW Quantum Ventures 40%. CMAR contract will flow to Ber Wilson Construction LLC.',
    },
  ]

  const created = await insert('entities', rows)
  log(`  Created ${created.length} entities`)
  return created
}

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------
async function seedProjects() {
  log('\n🏗  Seeding projects…')

  const rows = [
    {
      name: 'USACE Fort Bragg Barracks Renovation',
      sector: 'government',
      status: 'active',
      stage: 'execution',
      description: 'Multi-building barracks renovation under USACE IDIQ task order BQ-22-0047. Scope includes MEP upgrades, envelope restoration, and interior renovation of 4 barracks buildings (B-1108, B-1109, B-1110, B-1111) at Fort Liberty (formerly Fort Bragg). Performance period 18 months from NTP.',
      estimated_value: 20400000,
      contract_type: 'FFP',
      delivery_method: 'design_bid_build',
      location: 'Fort Liberty (Fort Bragg), NC',
      client_entity: 'US Army Corps of Engineers, Wilmington District',
      solicitation_number: 'W912PM-23-R-0047',
      award_date: '2024-09-12',
      ntp_date: '2024-11-04',
      substantial_completion_date: '2026-05-04',
    },
    {
      name: 'Salt Lake Mixed-Use Development',
      sector: 'real_estate',
      status: 'active',
      stage: 'pursuit',
      description: 'Ground-up 14-story mixed-use tower in the Sugar House district of Salt Lake City. 280 market-rate residential units, 22,000 SF ground-floor retail, structured parking. Design-build delivery with FFKR as architect. PE partnership with KEB Fund IV providing majority equity. Site control secured via Sorensen Land contribution to JV.',
      estimated_value: 85000000,
      contract_type: 'lump_sum',
      delivery_method: 'design_build',
      location: 'Sugar House District, Salt Lake City, UT',
      client_entity: 'BW-SLC Mixed Use Partners LLC',
      solicitation_number: null,
      award_date: null,
      ntp_date: null,
      substantial_completion_date: '2028-06-01',
    },
    {
      name: 'Rocky Mountain Quantum Data Center',
      sector: 'infrastructure',
      status: 'active',
      stage: 'capture',
      description: 'Hyperscale data center campus for QantumEdge Computing — a next-generation quantum computing infrastructure provider. 450,000 SF across three buildings with 100MW of IT load capacity. Critical power and cooling infrastructure. CMAR delivery model. Ber Wilson competing as builder/CMAR contractor in partnership with Mortenson. RFP expected Q3 2026.',
      estimated_value: 2100000000,
      contract_type: 'GMP',
      delivery_method: 'cmar',
      location: 'Adams County, CO (near Denver)',
      client_entity: 'RMI-BW Data Center JV LLC',
      solicitation_number: 'RMQE-2026-DC-001',
      award_date: null,
      ntp_date: null,
      substantial_completion_date: '2029-12-01',
    },
  ]

  const created = await insert('projects', rows)
  log(`  Created ${created.length} projects`)
  return created
}

// ---------------------------------------------------------------------------
// PROJECT PLAYERS
// ---------------------------------------------------------------------------
async function seedPlayers(
  projects: Array<{ id: string; name: string }>,
  parties: Array<{ id: string; full_name: string }>,
) {
  log('\n👥 Seeding project players…')

  const byName = (name: string) => {
    const p = parties.find((x) => x.full_name === name)
    if (!p) throw new Error(`Party not found: ${name}`)
    return p.id
  }
  const proj = (name: string) => {
    const p = projects.find((x) => x.name === name)
    if (!p) throw new Error(`Project not found: ${name}`)
    return p.id
  }

  const rows = [
    // Fort Bragg
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      party_id: byName('Col. Patricia Hendricks'),
      role: 'contracting_officer',
      is_primary: true,
      notes: 'Sole KO authority for contract modifications and final acceptance.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      party_id: byName('Lt. Col. James Barrera'),
      role: 'cor',
      is_primary: false,
      notes: 'COR on site. Receives daily reports. First point of contact for RFIs.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      party_id: byName('Marcus Delgado'),
      role: 'project_manager',
      is_primary: true,
      notes: 'Ber Wilson PM. Running schedule, submittals, and sub coordination.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      party_id: byName('Sarah Okonkwo'),
      role: 'architect',
      is_primary: false,
      notes: 'AOR. Handles RFIs and ASIs.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      party_id: byName('Danny Kowalski'),
      role: 'sub_electrical',
      is_primary: false,
      notes: 'All electrical scope. $2.1M subcontract.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      party_id: byName('Rosa Menendez'),
      role: 'sub_concrete',
      is_primary: false,
      notes: 'Concrete and masonry. $1.4M. HUBZone — counts toward SB sub plan.',
    },
    // Salt Lake
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      party_id: byName('Todd Whitmore'),
      role: 'pe_partner',
      is_primary: true,
      notes: 'KEB Fund IV decision-maker. ~45% equity. Requires monthly LP-style reporting.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      party_id: byName('Anita Sorensen'),
      role: 'land_contributor',
      is_primary: false,
      notes: 'Contributing land valued at ~$12.75M. Represented by Parsons Behle & Latimer.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      party_id: byName('Derek Lau'),
      role: 'architect',
      is_primary: false,
      notes: 'Design-build AOR. Contracted directly to BW-SLC JV entity.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      party_id: byName('Jennifer Nakamura'),
      role: 'civil_engineer',
      is_primary: false,
      notes: 'Leading entitlement process with SLC Planning. Target conditional approval Q3 2026.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      party_id: byName('Brian Taft'),
      role: 'construction_lender',
      is_primary: false,
      notes: 'Wells Fargo — $55M construction loan. Term sheet received. Closing conditioned on entitlements and full equity stack.',
    },
    // Rocky Mountain
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      party_id: byName('Dr. Elena Vasquez'),
      role: 'owner_rep',
      is_primary: true,
      notes: 'End-user VP. Controls technical requirements and vendor selection scoring criteria.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      party_id: byName('Michael Chen'),
      role: 'pe_sponsor',
      is_primary: false,
      notes: 'RMIP principal. Provides development capital and owns the land/entitlements.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      party_id: byName('Robert Finch'),
      role: 'utility',
      is_primary: false,
      notes: 'Xcel Energy contact. 100MW PSA negotiation in progress. Critical path.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      party_id: byName('Stephanie Park'),
      role: 'teaming_partner',
      is_primary: false,
      notes: 'Mortenson BD contact. Evaluating teaming structure — co-GC vs. specialty sub relationship.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      party_id: byName('Carlos Whitfield'),
      role: 'program_manager',
      is_primary: false,
      notes: 'AECOM owns the RFP process. Carlos controls scoring weights. High-influence target.',
    },
  ]

  const created = await insert('project_players', rows)
  log(`  Created ${created.length} project players`)
}

// ---------------------------------------------------------------------------
// MILESTONES
// ---------------------------------------------------------------------------
async function seedMilestones(projects: Array<{ id: string; name: string }>) {
  log('\n📍 Seeding milestones…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id

  const rows = [
    // Fort Bragg — execution stage, milestones leading up to and including execution
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'pursuit',
      label: 'Solicitation Identified',
      target_date: '2023-06-15',
      completed_at: '2023-06-10T00:00:00Z',
      notes: 'W912PM-23-R-0047 posted to SAM.gov',
      sort_order: 1,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'capture',
      label: 'Capture Plan Approved',
      target_date: '2023-09-01',
      completed_at: '2023-08-28T00:00:00Z',
      notes: 'Win strategy approved. Targeting FFP award, leveraging prior USACE barracks work.',
      sort_order: 2,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'bid',
      label: 'Proposal Submitted',
      target_date: '2024-05-30',
      completed_at: '2024-05-29T17:00:00Z',
      notes: 'Technical and price volumes submitted. Scored 94/100 technical.',
      sort_order: 3,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'award',
      label: 'Contract Awarded',
      target_date: '2024-09-15',
      completed_at: '2024-09-12T00:00:00Z',
      notes: 'Award notification received. Contract W912PM-24-C-0047 executed.',
      sort_order: 4,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'mobilization',
      label: 'Site Mobilization Complete',
      target_date: '2024-11-15',
      completed_at: '2024-11-18T00:00:00Z',
      notes: 'Three days late due to base access badge delays. No impact to schedule.',
      sort_order: 5,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'execution',
      label: '25% Construction Complete',
      target_date: '2025-02-04',
      completed_at: '2025-02-07T00:00:00Z',
      notes: 'B-1108 and B-1109 rough-in complete. Slight delay from MEP coordination.',
      sort_order: 6,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'execution',
      label: '50% Construction Complete',
      target_date: '2025-08-04',
      completed_at: null,
      notes: 'On track per latest schedule. B-1110 and B-1111 rough-in underway.',
      sort_order: 7,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'execution',
      label: '75% Construction Complete',
      target_date: '2025-11-04',
      completed_at: null,
      notes: null,
      sort_order: 8,
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      stage: 'closeout',
      label: 'Substantial Completion',
      target_date: '2026-05-04',
      completed_at: null,
      notes: 'Per contract. 18-month performance period from NTP.',
      sort_order: 9,
    },
    // Salt Lake — pursuit stage
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      stage: 'pursuit',
      label: 'Site Control Secured',
      target_date: '2025-06-01',
      completed_at: '2025-05-22T00:00:00Z',
      notes: 'Sorensen land contribution MOU executed. 90-day exclusivity period.',
      sort_order: 1,
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      stage: 'pursuit',
      label: 'JV Term Sheet with KEB Signed',
      target_date: '2025-09-30',
      completed_at: '2025-09-18T00:00:00Z',
      notes: 'KEB Fund IV term sheet signed. 45/40/15 equity split. Formal JV docs in process.',
      sort_order: 2,
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      stage: 'pursuit',
      label: 'Entitlement Application Filed',
      target_date: '2026-02-28',
      completed_at: '2026-02-19T00:00:00Z',
      notes: 'SLC Planning application submitted. Pre-app meeting held Feb 5.',
      sort_order: 3,
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      stage: 'capture',
      label: 'Entitlement Conditional Approval',
      target_date: '2026-08-30',
      completed_at: null,
      notes: 'Planning commission vote scheduled. Jennifer Nakamura leading.',
      sort_order: 4,
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      stage: 'bid',
      label: 'Construction Loan Closing',
      target_date: '2026-11-30',
      completed_at: null,
      notes: 'Conditioned on entitlements and full equity stack.',
      sort_order: 5,
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      stage: 'award',
      label: 'GMP/Lump Sum Contract Execution',
      target_date: '2027-01-15',
      completed_at: null,
      notes: null,
      sort_order: 6,
    },
    // Rocky Mountain — capture stage
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      stage: 'pursuit',
      label: 'Opportunity Identified',
      target_date: '2025-10-01',
      completed_at: '2025-09-28T00:00:00Z',
      notes: 'AECOM program management role confirmed. QantumEdge is the end user.',
      sort_order: 1,
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      stage: 'capture',
      label: 'Teaming Agreement with Mortenson Executed',
      target_date: '2026-04-30',
      completed_at: null,
      notes: 'Evaluating teaming structure. Mortenson brings hyperscale MEP experience.',
      sort_order: 2,
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      stage: 'capture',
      label: 'Xcel Energy PSA Executed',
      target_date: '2026-06-30',
      completed_at: null,
      notes: '100MW commitment required before RFP response. Critical path for win.',
      sort_order: 3,
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      stage: 'bid',
      label: 'RFP Release',
      target_date: '2026-09-01',
      completed_at: null,
      notes: 'AECOM-managed selection. RMQE-2026-DC-001 expected Q3 2026.',
      sort_order: 4,
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      stage: 'bid',
      label: 'CMAR Proposal Submitted',
      target_date: '2026-10-31',
      completed_at: null,
      notes: null,
      sort_order: 5,
    },
  ]

  const created = await insert('milestones', rows)
  log(`  Created ${created.length} milestones`)
}

// ---------------------------------------------------------------------------
// FINANCING
// ---------------------------------------------------------------------------
async function seedFinancing(projects: Array<{ id: string; name: string }>) {
  log('\n💰 Seeding financing structures…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id

  const rows = [
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      structure_type: 'self_funded',
      senior_debt: null,
      mezzanine: null,
      equity_amount: 20400000,
      equity_pct: 100,
      ltv: null,
      interest_rate: null,
      lender: null,
      pe_partner: null,
      waterfall_notes: 'FFP government contract — progress billing against schedule of values. Monthly payment applications to USACE. No external financing required.',
      draw_schedule: [
        { milestone: 'Mobilization (5%)', amount: 1020000, drawn: 1020000, date: '2024-11-30' },
        { milestone: '25% Complete', amount: 5100000, drawn: 5100000, date: '2025-02-28' },
        { milestone: '50% Complete', amount: 5100000, drawn: 0, date: '2025-08-31' },
        { milestone: '75% Complete', amount: 5100000, drawn: 0, date: '2025-11-30' },
        { milestone: 'Substantial Completion', amount: 3060000, drawn: 0, date: '2026-05-31' },
        { milestone: 'Final Acceptance', amount: 1020000, drawn: 0, date: '2026-07-31' },
      ],
      notes: 'Retention: 10% withheld through 50%, then 5% through substantial completion. Currently $612K in retention.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      structure_type: 'pe_partnership',
      senior_debt: 55000000,
      mezzanine: 8500000,
      equity_amount: 21500000,
      equity_pct: 25.3,
      ltv: 64.7,
      interest_rate: 7.125,
      lender: 'Wells Fargo Construction Finance',
      pe_partner: 'KEB Private Equity Fund IV LP',
      waterfall_notes: 'Preferred return: 8% IRR to all equity. Then 70/30 pro rata (KEB 45 / BW 40 / Sorensen 15) until 1.8x equity multiple. Above 1.8x — 60/40 split BW / KEB. Land valued at $12.75M for Sorensen contribution.',
      draw_schedule: [
        { milestone: 'Site Prep & Foundation', amount: 12000000, drawn: 0, date: '2027-03-31' },
        { milestone: 'Structural Frame', amount: 18000000, drawn: 0, date: '2027-09-30' },
        { milestone: 'Envelope & MEP Rough-in', amount: 25000000, drawn: 0, date: '2028-03-31' },
        { milestone: 'Interior Finish & Certificate of Occupancy', amount: 18000000, drawn: 0, date: '2028-07-31' },
      ],
      notes: 'Total project cost basis $85M. Construction loan commitment $55M. KEB equity $22M. BW equity $3.5M cash + overhead and profit. Sorensen $12.75M land. Mezzanine from KEB affiliate at 12% PIK.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      structure_type: 'pe_partnership',
      senior_debt: 1400000000,
      mezzanine: 200000000,
      equity_amount: 500000000,
      equity_pct: 23.8,
      ltv: 66.7,
      interest_rate: null,
      lender: 'TBD — RMIP arranging institutional construction debt',
      pe_partner: 'Rocky Mountain Infrastructure Partners LLC',
      waterfall_notes: 'RMIP 60% equity / BW Quantum Ventures 40% equity in JV. Ber Wilson Construction LLC earns GMP margin as CMAR, separate from equity upside. Exact waterfall to be negotiated in JV agreement.',
      draw_schedule: null,
      notes: 'Pre-development stage. Capital structure estimated. RMIP targeting institutional debt from life insurance companies at 6.5–7.0%. BW equity contribution ~$200M — may require outside co-invest. Structure TBD pending RFP award.',
    },
  ]

  const created = await insert('financing_structures', rows)
  log(`  Created ${created.length} financing structures`)
}

// ---------------------------------------------------------------------------
// DD ITEMS
// ---------------------------------------------------------------------------
async function seedDdItems(
  projects: Array<{ id: string; name: string }>,
  parties: Array<{ id: string; full_name: string }>,
) {
  log('\n🔍 Seeding DD items…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id
  const party = (name: string) => parties.find((x) => x.full_name === name)!.id

  const rows = [
    // Fort Bragg
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      category: 'bonding',
      item: 'Performance and Payment Bond — $20.4M. Bonds executed and delivered to USACE at contract award.',
      status: 'resolved',
      severity: 'info',
      assigned_to: party('Marcus Delgado'),
      notes: 'Surety: Travelers Casualty. Bond number TB-2024-09847.',
      resolved_at: '2024-09-20T00:00:00Z',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      category: 'regulatory',
      item: 'Davis-Bacon Act compliance — certified payrolls required weekly. All subs must comply.',
      status: 'in_progress',
      severity: 'watch',
      assigned_to: party('Marcus Delgado'),
      notes: 'Tri-State Electrical submitted Week 1–8 payrolls. Atlantic Concrete Week 1–6 only. Missing weeks 7–8 for Atlantic. Follow up required.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      category: 'legal',
      item: 'RFI #14 — Structural discrepancy between architectural and structural drawings at B-1110 second floor framing. Potential change order scope.',
      status: 'open',
      severity: 'watch',
      assigned_to: party('Sarah Okonkwo'),
      notes: 'RFI submitted 2025-02-20. Jacobs Engineering response pending. If structural redesign required, estimate $45K–80K CO.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      category: 'regulatory',
      item: 'Small Business Subcontracting Plan — must achieve 25% SB utilization. Currently at 21.3%.',
      status: 'in_progress',
      severity: 'watch',
      assigned_to: party('Marcus Delgado'),
      notes: 'Atlantic Concrete (HUBZone) counts. Need to identify additional SB sub opportunities on remaining scope.',
    },
    // Salt Lake
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      category: 'title',
      item: 'Title search and insurance for Sorensen land parcel. Survey shows potential encroachment on east boundary.',
      status: 'in_progress',
      severity: 'critical',
      assigned_to: party('Anita Sorensen'),
      notes: 'Title company (First American) identified potential easement conflict on east lot line. Sorensen\'s counsel (Parsons Behle) disputing. Must resolve before closing.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      category: 'environmental',
      item: 'Phase I ESA complete — no RECs identified. Phase II triggered by historical dry cleaning adjacent parcel.',
      status: 'in_progress',
      severity: 'watch',
      assigned_to: party('Jennifer Nakamura'),
      notes: 'Phase I by Terracon showed recognized environmental condition (REC) from adjacent dry cleaner (1965–1988). Phase II sampling ordered. Results expected 6 weeks.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      category: 'partner_dd',
      item: 'KEB Fund IV LP agreements and investor consent for JV investment above $20M threshold.',
      status: 'in_progress',
      severity: 'info',
      assigned_to: party('Todd Whitmore'),
      notes: 'Todd confirmed LP consent process underway. Formal commitment letter expected within 30 days of receiving final proforma.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      category: 'legal',
      item: 'JV Operating Agreement — BW-SLC Mixed Use Partners LLC. Drafts exchanged, 3 open items remaining.',
      status: 'in_progress',
      severity: 'watch',
      assigned_to: party('Todd Whitmore'),
      notes: 'Open items: (1) Promote calculation methodology at liquidation, (2) KEB put right trigger, (3) Decision rights at impasse. Kirkland & Ellis representing KEB, Van Cott representing BW.',
    },
    // Rocky Mountain
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      category: 'regulatory',
      item: 'Adams County entitlement and zoning — site requires rezoning from agricultural to industrial/data center use.',
      status: 'not_started',
      severity: 'blocker',
      assigned_to: party('Michael Chen'),
      notes: 'RMIP owns land and will lead rezoning process. No application filed yet. Expected 12–18 month process. Could be critical path.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      category: 'regulatory',
      item: 'Xcel Energy Power Purchase / Service Agreement for 100MW. Current grid capacity in Adams County limited.',
      status: 'in_progress',
      severity: 'blocker',
      assigned_to: party('Robert Finch'),
      notes: 'Xcel has capacity on 230kV transmission line 4 miles from site. Interconnection study commissioned. 12–18 month timeline. Required before RFP submittal per QantumEdge requirements.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      category: 'partner_dd',
      item: 'Mortenson teaming agreement — define co-GC vs. specialty sub relationship, exclusivity, and IP rights.',
      status: 'in_progress',
      severity: 'watch',
      assigned_to: party('Stephanie Park'),
      notes: 'Stephanie Park receptive to teaming. Her legal team reviewing draft. Key issue: exclusivity on hyperscale MEP work if we win.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      category: 'legal',
      item: 'Competitive intelligence — identify other teams likely responding to RMQE-2026-DC-001.',
      status: 'open',
      severity: 'info',
      assigned_to: party('Carlos Whitfield'),
      notes: 'Likely competitors: Turner + JLL, Hensel Phelps, McCarthy. Intel from industry contacts. Need to understand scoring weights from AECOM.',
    },
  ]

  const created = await insert('dd_items', rows)
  log(`  Created ${created.length} DD items`)
}

// ---------------------------------------------------------------------------
// COMPLIANCE ITEMS
// ---------------------------------------------------------------------------
async function seedCompliance(
  projects: Array<{ id: string; name: string }>,
  parties: Array<{ id: string; full_name: string }>,
) {
  log('\n✅ Seeding compliance items…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id
  const party = (name: string) => parties.find((x) => x.full_name === name)!.id

  const rows = [
    // Fort Bragg
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      framework: 'davis_bacon',
      requirement: 'Weekly certified payroll submissions for all workers on site. FAR 52.222-6.',
      status: 'in_progress',
      due_date: null,
      responsible_party: party('Marcus Delgado'),
      notes: 'BW and Atlantic Concrete current. Tri-State missing weeks 7–8.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      framework: 'bonding',
      requirement: 'Miller Act Performance and Payment Bond — 100% of contract value.',
      status: 'compliant',
      due_date: '2024-09-20',
      responsible_party: party('Marcus Delgado'),
      notes: 'Travelers Casualty. Bond on file with USACE. Annual renewal not required on this contract type.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      framework: 'far_dfars',
      requirement: 'FAR 52.204-21 Basic Safeguarding of Covered Contractor Information Systems.',
      status: 'compliant',
      due_date: null,
      responsible_party: party('Marcus Delgado'),
      notes: 'Documented in contract compliance plan. No CUI handled on this task order.',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      framework: 'dbe_eeo',
      requirement: 'Small Business Subcontracting Plan — 25% utilization target.',
      status: 'in_progress',
      due_date: '2026-05-04',
      responsible_party: party('Marcus Delgado'),
      notes: 'Currently at 21.3%. Need to increase SB utilization on finish work.',
    },
    // Salt Lake
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      framework: 'state_license',
      requirement: 'Utah DOPL General Contractor License — active and in good standing.',
      status: 'compliant',
      due_date: '2027-06-30',
      responsible_party: party('Marcus Delgado'),
      notes: 'BW license #5512847. Renews biennially. Current through June 2027.',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      framework: 'bonding',
      requirement: 'Construction completion guarantee to construction lender (Wells Fargo). Will be required at loan closing.',
      status: 'not_started',
      due_date: '2026-11-30',
      responsible_party: party('Brian Taft'),
      notes: 'Form of completion guaranty in Wells Fargo term sheet. BW must provide. May require parent guarantee.',
    },
    // Rocky Mountain
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      framework: 'state_license',
      requirement: 'Colorado General Contractor License — not currently licensed in CO.',
      status: 'not_started',
      due_date: '2026-09-01',
      responsible_party: party('Marcus Delgado'),
      notes: 'Must obtain before RFP submission. Reciprocity with Utah possible. Legal counsel to advise.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      framework: 'bonding',
      requirement: 'Surety capacity — $2.1B project will require very large bonding capacity. Assess with current surety.',
      status: 'not_started',
      due_date: '2026-08-01',
      responsible_party: party('Michael Chen'),
      notes: 'Ber Wilson\'s current bonding capacity insufficient for this project size alone. CMAR delivery may reduce bonding requirement. Teaming with Mortenson may help. Discuss with Travelers.',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      framework: 'cmmc',
      requirement: 'CMMC L2 assessment may be required if any federal customers at the data center. Confirm with QantumEdge.',
      status: 'not_started',
      due_date: null,
      responsible_party: party('Dr. Elena Vasquez'),
      notes: 'QantumEdge serves commercial clients but may have DOD contracts. Confirm data classification requirements with Elena.',
    },
  ]

  const created = await insert('compliance_items', rows)
  log(`  Created ${created.length} compliance items`)
}

// ---------------------------------------------------------------------------
// UPDATES
// ---------------------------------------------------------------------------
async function seedUpdates(projects: Array<{ id: string; name: string }>) {
  log('\n📝 Seeding updates…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id

  const rows = [
    // -----------------------------------------------------------------------
    // Fort Bragg — 5 updates
    // -----------------------------------------------------------------------
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      source: 'manual_paste',
      raw_content: `From: Marcus Delgado <m.delgado@berwilson.com>
To: Richard White <r.white@berwilson.com>
Subject: Fort Bragg Weekly Update – Week Ending 4/25/26
Date: April 25, 2026

Richard,

Quick update on Fort Bragg status for the week:

SCHEDULE: We're currently 6 days behind on B-1110 due to the MEP coordination issue I flagged last month. The structural RFI response from Jacobs finally came back today — they approved our proposed alternative without additional cost. This clears the path on B-1110 and we should be able to recover most of the delay in the next 3 weeks.

DAVIS-BACON: Rosa from Atlantic Concrete still hasn't submitted certified payrolls for weeks 7 and 8. I've called twice and sent a written notice. If she doesn't submit by Tuesday I'll need to withhold their next payment application per contract. Can you make a call to her directly?

SMALL BUSINESS: We're tracking at 21.3% SB utilization against our 25% plan. I'm working with procurement to identify if the building signage scope ($180K) can go to Patriot Signs & Graphics — they're SB verified. That would bump us to 22.1%. Still need more.

BUDGET: No budget issues. Contingency at $412K remaining (original $680K). The RFI resolution came in without a cost change so we preserved that.

UPCOMING: Col. Hendricks is coming on site April 30 for a progress walk with Lt. Col. Barrera. Please advise if you want to join.

Marcus`,
      summary: 'Week ending 4/25: B-1110 MEP delay resolving after structural RFI response from Jacobs. Atlantic Concrete missing certified payrolls weeks 7-8 — written notice issued. SB utilization at 21.3% against 25% plan; evaluating Patriot Signs scope. Contingency at $412K.',
      action_items: [
        { text: 'Call Rosa Menendez directly re: missing Davis-Bacon payrolls weeks 7–8', assignee: 'Richard White', due_date: '2026-04-27', completed: false },
        { text: 'Withhold Atlantic Concrete payment app if payrolls not submitted by Tuesday', assignee: 'Marcus Delgado', due_date: '2026-04-28', completed: false },
        { text: 'Evaluate Patriot Signs & Graphics scope ($180K) to increase SB utilization', assignee: 'Marcus Delgado', due_date: '2026-05-02', completed: false },
        { text: 'Confirm attendance at Col. Hendricks site walk April 30', assignee: 'Richard White', due_date: '2026-04-26', completed: false },
      ],
      waiting_on: [
        { text: 'Certified payrolls weeks 7–8 from Atlantic Concrete', party: 'Rosa Menendez', since: '2026-04-10' },
      ],
      risks: [
        { text: 'SB utilization at 21.3% — 3.7% below 25% plan target. Risk of USACE noncompliance finding on final audit.', severity: 'watch', mitigation: 'Evaluate Patriot Signs scope and other remaining work for SB-eligible subs' },
        { text: 'Atlantic Concrete Davis-Bacon noncompliance — missing payrolls could trigger USACE labor compliance review', severity: 'critical', mitigation: 'Direct call from Richard + written payment withhold notice' },
      ],
      decisions: [
        { text: 'RFI #14 resolved — Jacobs approved BW\'s structural alternative at B-1110 with no cost change', made_by: 'Sarah Okonkwo / Jacobs Engineering', date: '2026-04-25' },
      ],
      confidence: 0.97,
      review_state: 'approved',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      source: 'manual_paste',
      raw_content: `MEETING NOTES — Fort Bragg Progress Meeting #8
Date: March 28, 2026
Location: USACE Wilmington District Ops Center (video + site)
Attendees: Richard White (BW), Marcus Delgado (BW), Lt. Col. James Barrera (USACE COR), Sarah Okonkwo (Jacobs)

ITEMS DISCUSSED:

1. Schedule Review
   - Current status: 9 calendar days behind on B-1110 (MEP rough-in). All other buildings on track.
   - Root cause: Mechanical and electrical subs crossed paths in second floor corridor. Resolved through re-sequencing.
   - Recovery plan: Add one additional crew to B-1110 for 3 weeks. Barrera accepted recovery plan.

2. RFIs
   - RFI #12: Closed. Window replacement spec clarified.
   - RFI #13: Closed. Paint system approved equal accepted.
   - RFI #14: OPEN. Structural discrepancy B-1110 second floor. Jacobs response overdue by 10 days.
   - Action: Sarah to expedite Jacobs structural response by April 4.

3. Submittals
   - 47 of 62 submittals approved. 15 remaining.
   - BW to push remaining 15 in April to stay ahead of installation dates.

4. Safety
   - No incidents. 0 recordables through March.
   - USACE QA completed monthly safety audit — satisfactory rating.

5. Next meeting: April 25.`,
      summary: 'Progress meeting #8: B-1110 9 days behind on MEP rough-in due to trade sequencing conflict — recovery plan accepted by USACE. RFI #14 (structural B-1110) overdue from Jacobs. 47/62 submittals approved. Safety — zero recordables.',
      action_items: [
        { text: 'Sarah Okonkwo to expedite Jacobs structural response on RFI #14', assignee: 'Sarah Okonkwo', due_date: '2026-04-04', completed: true },
        { text: 'Push remaining 15 submittals in April ahead of installation dates', assignee: 'Marcus Delgado', due_date: '2026-04-30', completed: false },
        { text: 'Add additional crew to B-1110 for 3-week recovery', assignee: 'Marcus Delgado', due_date: '2026-03-31', completed: true },
      ],
      waiting_on: [
        { text: 'RFI #14 structural response from Jacobs Engineering', party: 'Sarah Okonkwo', since: '2026-03-18' },
      ],
      risks: [
        { text: 'B-1110 MEP delay 9 days — could extend if RFI #14 requires structural rework', severity: 'watch' },
      ],
      decisions: [
        { text: 'Recovery plan for B-1110 approved — additional crew for 3 weeks', made_by: 'Lt. Col. Barrera', date: '2026-03-28' },
      ],
      confidence: 0.95,
      review_state: 'approved',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      source: 'manual_paste',
      raw_content: `Text message thread — Marcus Delgado to Richard White
April 18, 2026, 7:42 AM

Marcus: Hey Richard — bad news this morning. Electrical inspector failed the B-1108 panel room rough inspection. Found 3 code violations. Danny Kowalski is there now. Looks like Tri-State used old NEC 2017 standards on some of the conduit spacing. USACE NEC 2023 requirement.

Richard: How bad?

Marcus: Not catastrophic. Danny says 1–2 day fix. But USACE QA is watching. If Barrera writes it up formally we could get a deficiency notice.

Richard: Who called the inspection prematurely?

Marcus: Danny's crew. He thought it was ready. I'm going to have a direct conversation with him today.

Richard: Get ahead of Barrera. Call him before he finds out from QA. Transparency is the play here.

Marcus: On it. Will call him at 9am. Also checking if this affects the B-1109 rough — similar scope.`,
      summary: 'B-1108 panel room rough inspection failed — Tri-State Electrical used NEC 2017 vs. required NEC 2023 conduit spacing. 1–2 day repair. Marcus reaching out to USACE COR proactively before formal deficiency notice. Checking if B-1109 is affected.',
      action_items: [
        { text: 'Call Lt. Col. Barrera proactively before QA writes up deficiency notice', assignee: 'Marcus Delgado', due_date: '2026-04-18', completed: true },
        { text: 'Inspect B-1109 panel room rough for same NEC 2023 compliance issue', assignee: 'Danny Kowalski', due_date: '2026-04-18', completed: false },
        { text: 'Discuss quality control expectations with Tri-State Electrical (Danny Kowalski)', assignee: 'Marcus Delgado', due_date: '2026-04-18', completed: true },
      ],
      waiting_on: [
        { text: 'Re-inspection of B-1108 panel room after NEC 2023 correction', party: 'Tri-State Electrical', since: '2026-04-18' },
      ],
      risks: [
        { text: 'USACE formal deficiency notice if COR documents the failed inspection before corrections made', severity: 'watch' },
        { text: 'B-1109 may have same NEC code violation — inspection not yet done', severity: 'watch' },
      ],
      decisions: [
        { text: 'Proactive disclosure to Barrera instead of waiting for QA report — transparency play', made_by: 'Richard White', date: '2026-04-18' },
      ],
      confidence: 0.88,
      review_state: 'approved',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      source: 'manual_paste',
      raw_content: `CHANGE ORDER LOG UPDATE — Fort Bragg BQ-22-0047
As of April 15, 2026 | Prepared by: Marcus Delgado

EXECUTED CHANGES:
CO #001 — Owner-directed scope addition: Emergency generator tie-in B-1108. +$47,200. Approved 2/15/26.
CO #002 — Differing site condition: Unmarked underground conduit encountered during B-1109 foundation work. +$28,400. Approved 3/3/26.

PENDING CHANGES:
CO #003 — RFI #14 resolution (if structural redesign required at B-1110): Est. $45,000–$80,000. Status: PENDING RFI response.
CO #004 — Exterior concrete staining spec owner-directed upgrade: +$22,000. Submitted 4/10/26. USACE response pending.

TOTAL CONTRACT VALUE TO DATE: $20,495,600 (base $20,400,000 + CO #001 + CO #002)
TOTAL PENDING: Up to $102,000 additional

CHANGE ORDER BUDGET: $500,000 allocated. $75,600 consumed. $424,400 remaining.`,
      summary: 'CO log current: 2 approved changes totaling $95,600 (generator tie-in + underground conduit). 2 pending — RFI #14 structural ($45–80K) and staining upgrade ($22K). Contract value at $20.495M. $424K of $500K CO budget remaining.',
      action_items: [
        { text: 'Follow up with USACE on CO #004 (exterior staining) — submitted 4/10, no response', assignee: 'Marcus Delgado', due_date: '2026-04-22', completed: false },
      ],
      waiting_on: [
        { text: 'CO #003 value determination — pending RFI #14 structural resolution', party: 'Sarah Okonkwo', since: '2026-04-01' },
        { text: 'CO #004 approval from USACE (exterior staining $22K)', party: 'Col. Patricia Hendricks', since: '2026-04-10' },
      ],
      risks: [
        { text: 'CO #003 up to $80K could consume 19% of remaining CO budget if structural redesign required', severity: 'info' },
      ],
      decisions: [],
      confidence: 0.96,
      review_state: 'approved',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      source: 'manual_paste',
      raw_content: `Phone call notes — Richard White
Call with Col. Patricia Hendricks, USACE KO
April 22, 2026, 2:00 PM

Patricia called to touch base on the project. Main topics:

1. Very pleased with project transparency and communication from our team. She specifically mentioned Marcus Delgado being proactive on the B-1108 inspection issue. Said it's rare and she appreciates it.

2. She raised the possibility of a sole-source follow-on for the remaining 2 barracks buildings (B-1112, B-1113) — scope not yet defined but estimated $8–12M. She said informally that if BQ-22 finishes on time with good CPARS she would have strong justification for J&A. She can't promise it but it's "very likely."

3. She asked about our manufacturing capability for prefab modules — mentioned upcoming BOA for prefab barracks at another installation. Sent me to her colleague CPT Nguyen as the lead.

4. CO #004 (exterior staining) — she's approving it. Formal mod coming next week.

Relationship note: Patricia is a 28-year veteran, retiring in 18 months. Good relationship to maintain.`,
      summary: 'Col. Hendricks called to commend team transparency. Raised informal possibility of sole-source follow-on task order (B-1112/1113, est. $8–12M) contingent on strong CPARS finish. Also flagged upcoming prefab barracks BOA — connected us with CPT Nguyen. CO #004 ($22K) approved verbally.',
      action_items: [
        { text: 'Contact CPT Nguyen re: prefab barracks BOA opportunity', assignee: 'Richard White', due_date: '2026-04-29', completed: false },
        { text: 'Document Col. Hendricks relationship note and follow-on opportunity in project file', assignee: 'Richard White', due_date: '2026-04-23', completed: false },
        { text: 'Ensure CPARS self-assessment submitted on time — strong finish is prerequisite for follow-on', assignee: 'Marcus Delgado', due_date: '2026-05-04', completed: false },
      ],
      waiting_on: [
        { text: 'Formal contract modification for CO #004 ($22K exterior staining)', party: 'Col. Patricia Hendricks', since: '2026-04-22' },
      ],
      risks: [],
      decisions: [
        { text: 'CO #004 ($22K exterior staining) verbally approved by KO. Formal mod expected next week.', made_by: 'Col. Patricia Hendricks', date: '2026-04-22' },
      ],
      confidence: 0.93,
      review_state: 'approved',
    },

    // -----------------------------------------------------------------------
    // Salt Lake — 3 updates
    // -----------------------------------------------------------------------
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      source: 'manual_paste',
      raw_content: `From: Todd Whitmore <t.whitmore@kebpe.com>
To: Richard White
Subject: SLC Mixed Use — KEB LP Consent Update
Date: April 20, 2026

Richard,

Quick update from the LP front. We presented the SLC mixed-use deal at our quarterly LP meeting last Thursday. Strong reception. Two main items:

1. LP Consent: We need 60% approval from our Fund IV LPs for any investment over $20M. Based on the room Thursday I'm confident we'll get there, but the formal written consent process takes 3–4 weeks. I'll have a letter to you by May 16.

2. Equity Sizing: Our modeling team ran the proforma with 280 units at $2,350/SF avg rent. IRR comes in at 14.2% unlevered, 19.8% levered at current Wells Fargo terms. Our IC approved at those numbers. If construction costs go up more than 8% our levered return drops below our 18% hurdle — keep that in mind as you're finishing the GMP.

3. They want monthly GP reports once we're in construction. Standard KEB format. Will send template.

One other thing — our LP group had a question about the title issue on the east boundary. Who is our title rep? They want to know it's being actively managed.

Best,
Todd`,
      summary: 'KEB Fund IV LP consent process underway — formal letter by May 16. IRR models at 14.2% unlevered / 19.8% levered. IC approved. LP concern about title boundary issue — they want confirmation it\'s being managed. Monthly GP report format required in construction.',
      action_items: [
        { text: 'Provide Todd Whitmore with title rep contact and status on east boundary encroachment issue', assignee: 'Richard White', due_date: '2026-04-24', completed: false },
        { text: 'Review KEB monthly GP report template when received and set up reporting process', assignee: 'Richard White', due_date: '2026-05-20', completed: false },
        { text: 'Confirm GMP contingency strategy to stay within 8% cost increase threshold', assignee: 'Richard White', due_date: '2026-05-01', completed: false },
      ],
      waiting_on: [
        { text: 'KEB Fund IV formal LP consent letter ($22M equity commitment)', party: 'Todd Whitmore', since: '2026-04-20' },
        { text: 'KEB monthly GP report template', party: 'Todd Whitmore', since: '2026-04-20' },
      ],
      risks: [
        { text: 'Construction cost increase above 8% drops levered IRR below KEB\'s 18% hurdle rate — could jeopardize equity commitment', severity: 'watch', mitigation: 'Tight GMP scope definition, contingency management' },
        { text: 'Title boundary dispute could create LP-level concern and delay equity commitment if not resolved', severity: 'critical', mitigation: 'Parsons Behle actively disputing. Update Todd this week.' },
      ],
      decisions: [
        { text: 'KEB Investment Committee approved SLC mixed-use investment at 14.2% unlevered / 19.8% levered IRR', made_by: 'KEB Fund IV IC', date: '2026-04-17' },
      ],
      confidence: 0.96,
      review_state: 'approved',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      source: 'manual_paste',
      raw_content: `Notes from call with Jennifer Nakamura — SLC Planning / Entitlement Update
April 17, 2026

Jennifer called with update on SLC Planning Department status:

- Pre-application meeting was positive. City planner (Ben Oaks) indicated he doesn't see fundamental obstacles to conditional approval.
- Biggest issue flagged: height variance. Our 14-story design is 2 floors above the current Sugar House Station Area Plan. We'll need a height variance which goes to a public hearing. Ben estimated 6–8 months from application.
- Parking: City is moving toward reduced parking minimums in transit corridors. Our 1.1 spaces/unit may be more than required — we could potentially reduce structure by 30 spaces, saving ~$450K. Jennifer recommends we study this.
- Environmental: Phase II results expected within 4–5 weeks. If soil contamination found it could require remediation which would add 3–6 months and $500K–$2M.

Jennifer's overall assessment: project is proceeding well but the height variance is the real schedule risk. She recommends we hire a land use attorney to shepherd the variance.`,
      summary: 'Entitlement update: SLC planner positive but height variance required for 14-story (2 floors above Sugar House plan) — adds 6–8 months via public hearing. Phase II environmental results in 4–5 weeks. Potential parking reduction saves $450K. Land use attorney recommended for variance.',
      action_items: [
        { text: 'Retain SLC land use attorney for height variance process', assignee: 'Richard White', due_date: '2026-05-01', completed: false },
        { text: 'Study parking reduction from 1.1 to 0.85 spaces/unit — potential $450K savings', assignee: 'Jennifer Nakamura', due_date: '2026-05-15', completed: false },
        { text: 'Track Phase II environmental results — expected in 4–5 weeks', assignee: 'Jennifer Nakamura', due_date: '2026-05-21', completed: false },
      ],
      waiting_on: [
        { text: 'Phase II ESA results from Terracon', party: 'Jennifer Nakamura', since: '2026-04-10' },
        { text: 'SLC Planning formal application review timeline from Ben Oaks', party: 'Jennifer Nakamura', since: '2026-04-17' },
      ],
      risks: [
        { text: 'Height variance required — 6–8 month public hearing process is single biggest schedule risk on entitlement', severity: 'critical', mitigation: 'Hire land use attorney immediately, engage neighborhood stakeholders early' },
        { text: 'Phase II environmental — if contamination found, $500K–$2M remediation cost and 3–6 month delay', severity: 'watch', mitigation: 'Results in 4–5 weeks — stay close to Jennifer and Terracon' },
      ],
      decisions: [
        { text: 'Recommend retaining land use attorney to manage height variance hearing', made_by: 'Jennifer Nakamura', date: '2026-04-17' },
      ],
      confidence: 0.94,
      review_state: 'approved',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      source: 'manual_paste',
      raw_content: `Voicemail transcription — Brian Taft, Wells Fargo, April 24, 2026

"Hi Richard, Brian Taft here from Wells Fargo. Wanted to follow up on the construction loan term sheet we sent over in March. We're ready to move forward to commitment letter once we have two things: one, the full equity stack confirmed in writing — so that means the KEB letter plus confirmation of the Sorensen land contribution value — and two, the title issue on the east boundary resolved or at least a credible plan.

Our credit committee is also asking about the Phase II environmental. That's going to need to come back clean or with a remediation plan and cost estimate before we can close. Give me a call back, happy to talk through the timeline. I think we can close in Q4 if everything comes together. Thanks."`,
      summary: 'Wells Fargo construction loan moving to commitment letter once: (1) full equity stack confirmed in writing — KEB letter + Sorensen land value, (2) title boundary issue resolved, (3) Phase II environmental clean or remediation plan. Q4 2026 close possible.',
      action_items: [
        { text: 'Call Brian Taft back and confirm KEB consent timeline (May 16) and Sorensen land contribution documentation', assignee: 'Richard White', due_date: '2026-04-25', completed: false },
        { text: 'Get Sorensen land value appraisal or broker opinion in writing for lender package', assignee: 'Anita Sorensen', due_date: '2026-05-15', completed: false },
      ],
      waiting_on: [
        { text: 'KEB equity commitment letter — May 16', party: 'Todd Whitmore', since: '2026-04-20' },
        { text: 'Phase II ESA results', party: 'Jennifer Nakamura', since: '2026-04-10' },
        { text: 'Title issue resolution on east boundary', party: 'Anita Sorensen', since: '2026-03-15' },
      ],
      risks: [
        { text: 'Lender requires all 3 conditions before committing — any one delay cascades to loan close and construction start', severity: 'critical' },
      ],
      decisions: [],
      confidence: 0.72,
      review_state: 'pending',
    },

    // -----------------------------------------------------------------------
    // Rocky Mountain — 2 updates
    // -----------------------------------------------------------------------
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      source: 'manual_paste',
      raw_content: `From: Michael Chen <m.chen@rmipllc.com>
To: Richard White
Subject: Rocky Mountain Quantum — Update + Next Steps
Date: April 21, 2026

Richard,

Good call last week. Wanted to summarize where we are and what needs to happen in the next 90 days:

DEAL STATUS: RMI-BW JV agreement term sheet agreed in principle. Formal JV docs should be executed by end of May. Our counsel (Brownstein Hyatt) reviewing BW's redlines.

AECOM: Carlos Whitfield's firm is running a compliant procurement. RMQE-2026-DC-001 RFP expected September 1. They'll be evaluating on: (1) data center experience, (2) schedule credibility, (3) GMP commitment, (4) team qualifications. The Mortenson partnership is critical — QantumEdge will want hyperscale MEP credibility.

POWER: Met with Robert Finch at Xcel last week. Interconnection study is progressing. He estimates PSA can be executed by August if the study results are favorable. The 230kV transmission upgrade they need is estimated at $42M — QantumEdge has indicated they'll reimburse over the PSA term.

ENTITLEMENT: Adams County pre-application meeting scheduled May 12. This is a 12–18 month process. We need to start now.

BONDING: I know this is a big one. Have you talked to Travelers about capacity? A $2.1B CMAR bond is unusual. You may need multiple sureties or a GMP cap.

- Michael`,
      summary: 'RMI-BW JV term sheet agreed, formal docs by end of May. RFP September 1 — scoring on data center experience, schedule, GMP, team. Xcel PSA possible by August ($42M interconnect, QantumEdge reimburses). Adams County entitlement pre-app May 12. Surety capacity for $2.1B CMAR needs addressing.',
      action_items: [
        { text: 'Execute RMI-BW Data Center JV LLC operating agreement — redlines to Brownstein Hyatt', assignee: 'Richard White', due_date: '2026-05-31', completed: false },
        { text: 'Finalize teaming agreement with Mortenson (Stephanie Park) before RFP release', assignee: 'Richard White', due_date: '2026-08-15', completed: false },
        { text: 'Discuss $2.1B CMAR surety capacity with Travelers — evaluate multi-surety or GMP cap options', assignee: 'Richard White', due_date: '2026-05-15', completed: false },
        { text: 'Attend Adams County entitlement pre-application meeting May 12', assignee: 'Michael Chen', due_date: '2026-05-12', completed: false },
        { text: 'Monitor Xcel interconnection study — PSA target August 2026', assignee: 'Robert Finch', due_date: '2026-08-31', completed: false },
      ],
      waiting_on: [
        { text: 'Brownstein Hyatt review of JV redlines', party: 'Michael Chen', since: '2026-04-21' },
        { text: 'Xcel Energy PSA — pending interconnection study completion', party: 'Robert Finch', since: '2026-04-15' },
        { text: 'Mortenson teaming agreement execution', party: 'Stephanie Park', since: '2026-04-10' },
      ],
      risks: [
        { text: 'Adams County rezoning 12–18 months — if not started immediately this becomes critical path and could push project by 12+ months', severity: 'blocker', mitigation: 'Pre-app meeting May 12. Hire land use attorney ASAP.' },
        { text: 'Surety capacity insufficient for $2.1B CMAR without major restructuring. Could be a disqualifying issue.', severity: 'critical', mitigation: 'Talk to Travelers immediately. CMAR GMP cap may reduce bonded amount.' },
        { text: 'Xcel interconnection study — unfavorable results could eliminate site or add $100M+ in grid costs', severity: 'critical' },
      ],
      decisions: [
        { text: 'RMI-BW JV term sheet agreed in principle — proceed to formal JV operating agreement', made_by: 'Richard White / Michael Chen', date: '2026-04-18' },
      ],
      confidence: 0.95,
      review_state: 'approved',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      source: 'manual_paste',
      raw_content: `Notes — Stephanie Park (Mortenson) call re: teaming
April 23, 2026, 3:30 PM

Called Stephanie Park at Mortenson to advance teaming discussion.

Key points:
- Mortenson is interested but has one competing option — Turner approached them first. They have not committed to Turner yet.
- Stephanie says Mortenson's value-add is their dedicated hyperscale MEP team (20 people, done Amazon, Meta, and Google data centers). This is the primary differentiator QantumEdge will care about.
- Structure preference: Mortenson wants to be listed as 50/50 co-CMAR, not a sub. They believe AECOM won't give full credit for hyperscale experience if Mortenson is listed as a sub.
- Exclusivity: They'll agree to exclusivity for this specific RFP only. Not willing to pass up other data center pursuits generally.
- Next step: Stephanie will get redlines back on our draft teaming agreement by April 30. Key negotiation point is decision rights — they don't want to be outvoted on technical submittals.

Assessment: Mortenson partnership is worth the 50/50 co-CMAR concession. Their MEP team alone differentiates us from Turner/Hensel Phelps. Need to move fast — Turner relationship is a real threat.`,
      summary: 'Mortenson wants 50/50 co-CMAR structure (not sub) for full evaluation credit. Turner approached them first — we need to move. Mortenson hyperscale MEP team (Amazon, Meta, Google) is key differentiator. Redlines on teaming agreement by April 30. Key issue: decision rights on technical submittals.',
      action_items: [
        { text: 'Respond to Mortenson teaming agreement redlines promptly after April 30 — do not let Turner win this', assignee: 'Richard White', due_date: '2026-05-05', completed: false },
        { text: 'Decide on co-CMAR vs. sub structure — 50/50 co-CMAR is likely the right call to win', assignee: 'Richard White', due_date: '2026-04-28', completed: false },
      ],
      waiting_on: [
        { text: 'Mortenson redlines on teaming agreement', party: 'Stephanie Park', since: '2026-04-23' },
      ],
      risks: [
        { text: 'Turner is pursuing Mortenson — if we don\'t move fast we lose the best hyperscale MEP team available in this market', severity: 'critical', mitigation: 'Respond to redlines same day received. Be flexible on decision rights.' },
      ],
      decisions: [],
      confidence: 0.65,
      review_state: 'pending',
    },
  ]

  const created = await insert('updates', rows)
  log(`  Created ${created.length} updates`)
  return created
}

// ---------------------------------------------------------------------------
// DOCUMENTS (placeholder records — no actual files)
// ---------------------------------------------------------------------------
async function seedDocuments(projects: Array<{ id: string; name: string }>) {
  log('\n📄 Seeding document records…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id

  const rows = [
    // Fort Bragg
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      storage_path: `placeholder/${proj('USACE Fort Bragg Barracks Renovation')}/W912PM-24-C-0047_signed.pdf`,
      file_name: 'W912PM-24-C-0047_Contract_Signed.pdf',
      file_size_bytes: 4200000,
      mime_type: 'application/pdf',
      doc_type: 'contract',
      classification: 'sensitive',
      ai_summary: 'Executed FFP contract W912PM-24-C-0047 for barracks renovation at Fort Liberty. $20,400,000 base value, 18-month performance period. Key terms: Davis-Bacon compliance, Miller Act bonding, FAR 52.204-21 cybersecurity.',
      confidence: 0.94,
      source: 'document',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      storage_path: `placeholder/${proj('USACE Fort Bragg Barracks Renovation')}/schedule_of_values.xlsx`,
      file_name: 'Schedule_of_Values_Rev3.xlsx',
      file_size_bytes: 185000,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      doc_type: 'report',
      classification: 'standard',
      ai_summary: 'Schedule of values revision 3. 42 line items totaling $20,400,000. Major items: MEP rough-in $6.1M, interior finishes $4.8M, structural repairs $2.9M, mobilization $420K.',
      confidence: 0.91,
      source: 'document',
    },
    {
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      storage_path: `placeholder/${proj('USACE Fort Bragg Barracks Renovation')}/rfi_14_response.pdf`,
      file_name: 'RFI-014_Jacobs_Response_042526.pdf',
      file_size_bytes: 890000,
      mime_type: 'application/pdf',
      doc_type: 'correspondence',
      classification: 'standard',
      ai_summary: 'RFI #14 response from Jacobs Engineering. Approved BW\'s proposed structural alternative at B-1110 second floor framing. No cost impact. Clarifies header sizing at gridline 4.',
      confidence: 0.96,
      source: 'document',
    },
    // Salt Lake
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      storage_path: `placeholder/${proj('Salt Lake Mixed-Use Development')}/keb_term_sheet.pdf`,
      file_name: 'KEB_Fund_IV_Term_Sheet_Executed_091826.pdf',
      file_size_bytes: 1450000,
      mime_type: 'application/pdf',
      doc_type: 'contract',
      classification: 'sensitive',
      ai_summary: 'KEB Private Equity Fund IV LP equity investment term sheet. $22M equity commitment, 45% ownership interest in BW-SLC Mixed Use Partners LLC. 8% preferred return, 70/30 split above pref, 60/40 above 1.8x. LP consent process required within 60 days.',
      confidence: 0.93,
      source: 'document',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      storage_path: `placeholder/${proj('Salt Lake Mixed-Use Development')}/phase1_esa_report.pdf`,
      file_name: 'Phase_I_ESA_SugarHouse_Terracon_2026.pdf',
      file_size_bytes: 8700000,
      mime_type: 'application/pdf',
      doc_type: 'report',
      classification: 'standard',
      ai_summary: 'Phase I Environmental Site Assessment by Terracon. One recognized environmental condition (REC): historical dry cleaning operation at adjacent parcel 1965–1988. Recommends Phase II subsurface investigation to assess potential solvent migration to subject property.',
      confidence: 0.97,
      source: 'document',
    },
    {
      project_id: proj('Salt Lake Mixed-Use Development'),
      storage_path: `placeholder/${proj('Salt Lake Mixed-Use Development')}/wells_fargo_term_sheet.pdf`,
      file_name: 'WF_ConstructionLoan_TermSheet_032626.pdf',
      file_size_bytes: 2100000,
      mime_type: 'application/pdf',
      doc_type: 'contract',
      classification: 'sensitive',
      ai_summary: 'Wells Fargo Construction Finance term sheet. $55M construction loan, 24-month term plus 2 six-month extensions. SOFR + 2.85% (7.125% all-in at time of term sheet). Interest reserve 8 months. Requires full equity stack, entitlements, and clean environmental before closing.',
      confidence: 0.95,
      source: 'document',
    },
    // Rocky Mountain
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      storage_path: `placeholder/${proj('Rocky Mountain Quantum Data Center')}/rmip_bw_jv_term_sheet.pdf`,
      file_name: 'RMI-BW_JV_Term_Sheet_Agreed_041826.pdf',
      file_size_bytes: 1200000,
      mime_type: 'application/pdf',
      doc_type: 'contract',
      classification: 'sensitive',
      ai_summary: 'RMI-BW Data Center JV LLC term sheet. RMIP 60% / BW Quantum Ventures 40% equity split. CMAR agreement flows to Ber Wilson Construction LLC as builder. BW receives GMP margin independent of equity returns. JV operating agreement to be executed by May 31.',
      confidence: 0.92,
      source: 'document',
    },
    {
      project_id: proj('Rocky Mountain Quantum Data Center'),
      storage_path: `placeholder/${proj('Rocky Mountain Quantum Data Center')}/xcel_interconnection_study.pdf`,
      file_name: 'Xcel_Interconnection_Study_Scoping_2026.pdf',
      file_size_bytes: 3400000,
      mime_type: 'application/pdf',
      doc_type: 'report',
      classification: 'standard',
      ai_summary: 'Xcel Energy interconnection study scoping document for 100MW data center load at Adams County site. 230kV transmission line upgrade required at estimated cost of $42M. Study duration 6–8 months. PSA execution contingent on favorable study result.',
      confidence: 0.89,
      source: 'document',
    },
  ]

  const created = await insert('documents', rows)
  log(`  Created ${created.length} document records`)
}

// ---------------------------------------------------------------------------
// ENTITY–PROJECT LINKS
// ---------------------------------------------------------------------------
async function seedEntityProjects(
  projects: Array<{ id: string; name: string }>,
  entities: Array<{ id: string; name: string }>,
) {
  log('\n🔗 Seeding entity-project links…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id
  const ent = (name: string) => {
    const e = entities.find((x) => x.name === name)
    if (!e) throw new Error(`Entity not found: ${name}`)
    return e.id
  }

  const rows = [
    // Fort Bragg
    {
      entity_id: ent('Ber Wilson Construction LLC'),
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      relationship: 'owner',
      equity_pct: 100,
      notes: 'Prime contractor. FFP contract holder.',
    },
    {
      entity_id: ent('BW-Fort Bragg JV LLC'),
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      relationship: 'jv_partner',
      equity_pct: 100,
      notes: 'JV shell entity — BW 100%. Formed for USACE purposes.',
    },
    // Salt Lake
    {
      entity_id: ent('Ber Wilson Construction LLC'),
      project_id: proj('Salt Lake Mixed-Use Development'),
      relationship: 'jv_partner',
      equity_pct: 40,
      notes: 'BW contributes 40% equity ($3.5M cash + overhead). Also serves as GC.',
    },
    {
      entity_id: ent('BW-SLC Mixed Use Partners LLC'),
      project_id: proj('Salt Lake Mixed-Use Development'),
      relationship: 'owner',
      equity_pct: null,
      notes: 'JV development entity. Holds the land, entitlements, and will hold the construction loan.',
    },
    {
      entity_id: ent('KEB Private Equity Fund IV LP'),
      project_id: proj('Salt Lake Mixed-Use Development'),
      relationship: 'jv_partner',
      equity_pct: 45,
      notes: 'KEB majority equity at 45%. Investment committee approved.',
    },
    // Rocky Mountain
    {
      entity_id: ent('BW Quantum Ventures LLC'),
      project_id: proj('Rocky Mountain Quantum Data Center'),
      relationship: 'jv_partner',
      equity_pct: 40,
      notes: 'BW equity co-invest vehicle. 40% of development JV.',
    },
    {
      entity_id: ent('Rocky Mountain Infrastructure Partners LLC'),
      project_id: proj('Rocky Mountain Quantum Data Center'),
      relationship: 'jv_partner',
      equity_pct: 60,
      notes: 'RMIP sponsor. 60% equity, owns land and leads entitlement.',
    },
    {
      entity_id: ent('RMI-BW Data Center JV LLC'),
      project_id: proj('Rocky Mountain Quantum Data Center'),
      relationship: 'owner',
      equity_pct: null,
      notes: 'Development JV LLC. Will be the project owner and CMAR client.',
    },
    {
      entity_id: ent('Ber Wilson Construction LLC'),
      project_id: proj('Rocky Mountain Quantum Data Center'),
      relationship: 'sub_entity',
      equity_pct: null,
      notes: 'CMAR/GC role. GMP contract will flow to Ber Wilson Construction LLC from the JV.',
    },
  ]

  const created = await insert('entity_projects', rows)
  log(`  Created ${created.length} entity-project links`)
}

// ---------------------------------------------------------------------------
// REVIEW QUEUE — manually add low-confidence update entries
// ---------------------------------------------------------------------------
async function seedReviewQueue(
  projects: Array<{ id: string; name: string }>,
  updates: Array<{ id: string; project_id: string; confidence: number; review_state: string }>,
) {
  log('\n🔔 Seeding review queue…')

  // Find updates that are "pending" (low confidence flagged)
  const pendingUpdates = updates.filter((u) => u.review_state === 'pending')

  if (pendingUpdates.length === 0) {
    log('  No pending updates found — skipping review queue')
    return
  }

  const rows = pendingUpdates.map((u) => {
    const project = projects.find((p) => p.id === u.project_id)!
    const isVeryLow = u.confidence < 0.7

    let reason = 'low_confidence'
    let explanation = `AI extraction confidence score ${(u.confidence * 100).toFixed(0)}% is below the 80% threshold. Key entities and action items extracted but some ambiguity in party identification and project references.`

    if (project.name === 'Salt Lake Mixed-Use Development') {
      reason = 'low_confidence'
      explanation = `Confidence ${(u.confidence * 100).toFixed(0)}%: Voicemail transcription quality affected extraction. Multiple conditions referenced (equity, title, environmental) — extracted correctly but cross-references between conditions need human verification.`
    } else if (project.name === 'Rocky Mountain Quantum Data Center') {
      reason = 'ambiguous_project'
      explanation = `Confidence ${(u.confidence * 100).toFixed(0)}%: Meeting notes reference both Rocky Mountain Quantum Data Center and a potential Mortenson co-venture on an unrelated project. Action items may belong to different projects.`
    }

    return {
      source_table: 'updates',
      record_id: u.id,
      project_id: u.project_id,
      reason,
      confidence: u.confidence,
      ai_explanation: explanation,
    }
  })

  const created = await insert('review_queue', rows)
  log(`  Created ${created.length} review queue items`)
}

// ---------------------------------------------------------------------------
// ACTIVITY LOG — manual seed entries (in addition to trigger-generated ones)
// ---------------------------------------------------------------------------
async function seedActivityLog(projects: Array<{ id: string; name: string }>) {
  log('\n📋 Seeding manual activity log entries…')

  const proj = (name: string) => projects.find((x) => x.name === name)!.id

  const rows = [
    {
      actor_id: null,
      actor_type: 'system',
      action: 'SEED',
      table_name: 'projects',
      record_id: proj('USACE Fort Bragg Barracks Renovation'),
      project_id: proj('USACE Fort Bragg Barracks Renovation'),
      metadata: { note: 'Initial seed data loaded', project: 'USACE Fort Bragg Barracks Renovation' },
    },
    {
      actor_id: null,
      actor_type: 'system',
      action: 'SEED',
      table_name: 'projects',
      record_id: proj('Salt Lake Mixed-Use Development'),
      project_id: proj('Salt Lake Mixed-Use Development'),
      metadata: { note: 'Initial seed data loaded', project: 'Salt Lake Mixed-Use Development' },
    },
    {
      actor_id: null,
      actor_type: 'system',
      action: 'SEED',
      table_name: 'projects',
      record_id: proj('Rocky Mountain Quantum Data Center'),
      project_id: proj('Rocky Mountain Quantum Data Center'),
      metadata: { note: 'Initial seed data loaded', project: 'Rocky Mountain Quantum Data Center' },
    },
  ]

  await insert('activity_log', rows)
  log(`  Created ${rows.length} manual activity entries`)
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  console.log('🌱 BER WILSON — Seed Script')
  console.log('='.repeat(50))

  try {
    await wipe()

    const parties = await seedParties()
    const entities = await seedEntities()
    const projects = await seedProjects()

    await seedPlayers(projects, parties)
    await seedMilestones(projects)
    await seedFinancing(projects)
    await seedDdItems(projects, parties)
    await seedCompliance(projects, parties)
    await seedDocuments(projects)

    const updates = await seedUpdates(projects)
    await seedEntityProjects(projects, entities)
    await seedReviewQueue(projects, updates)
    await seedActivityLog(projects)

    console.log('\n' + '='.repeat(50))
    console.log('✅ Seed complete!')
    console.log('\nProjects created:')
    for (const p of projects) {
      console.log(`  • ${p.name} (${p.id})`)
    }

    console.log('\nQuick stats:')
    const [partyCount, entityCount, playerCount, milestoneCount, updateCount, ddCount, complianceCount, docCount, reviewCount] =
      await Promise.all([
        db.from('parties').select('id', { count: 'exact', head: true }),
        db.from('entities').select('id', { count: 'exact', head: true }),
        db.from('project_players').select('id', { count: 'exact', head: true }),
        db.from('milestones').select('id', { count: 'exact', head: true }),
        db.from('updates').select('id', { count: 'exact', head: true }),
        db.from('dd_items').select('id', { count: 'exact', head: true }),
        db.from('compliance_items').select('id', { count: 'exact', head: true }),
        db.from('documents').select('id', { count: 'exact', head: true }),
        db.from('review_queue').select('id', { count: 'exact', head: true }),
      ])

    console.log(`  Parties: ${partyCount.count}`)
    console.log(`  Entities: ${entityCount.count}`)
    console.log(`  Players: ${playerCount.count}`)
    console.log(`  Milestones: ${milestoneCount.count}`)
    console.log(`  Updates: ${updateCount.count}`)
    console.log(`  DD Items: ${ddCount.count}`)
    console.log(`  Compliance Items: ${complianceCount.count}`)
    console.log(`  Documents: ${docCount.count}`)
    console.log(`  Review Queue: ${reviewCount.count}`)
  } catch (err) {
    console.error('\n❌ Seed failed:', err)
    process.exit(1)
  }
}

main()
