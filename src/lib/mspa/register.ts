/**
 * Every project and opportunity on the platform, classified against the
 * TensorIQ Master Strategic Partnership Agreement.
 *
 * ⚠ EVERY FIGURE HERE WAS READ OUT OF THE CORPUS, AND EACH ONE CARRIES WHERE
 * IT CAME FROM. Nothing is invented and nothing is averaged. Where a record's
 * megawatt figure does not say which load it measures, `mwBasis` is null and
 * the assessment refuses to pick one — that is the unit trap, and it is live on
 * real deals here, not hypothetical.
 *
 * ⚠ AND MOST OF THESE RECORDS ARE NOT MSPA DEALS. 26 records exist; the
 * partnership covers data center, power and related infrastructure. A garage
 * conversion, a state office building and a gold mine are classified `out` with
 * a reason, because running Schedule 1 fee logic over them would produce a
 * number that looks real and means nothing.
 *
 * Re-measure before trusting a figure: `scripts/measure-mspa-register.mts`.
 */

import type { MwBasis } from './capacity'
import type { ScopeKey } from './fees'

/** Whether the MSPA's fee and protection machinery applies at all. */
export type MspaScope =
  /** A live data center / power opportunity the partnership covers. */
  | 'in'
  /** Covered in principle but with no capacity figure yet, so nothing computes. */
  | 'unsized'
  /** Not a data center or power deal. Schedule 1 does not apply. */
  | 'out'

export interface RegisterRecord {
  name: string
  kind: 'project' | 'opportunity'
  mspaScope: MspaScope
  /** Why it is in, unsized or out. Always stated. */
  rationale: string
  state: string | null
  /** The headline capacity as the corpus states it. */
  statedMw: number | null
  /**
   * The basis, where a document actually says. ⚠ NULL IS THE COMMON CASE and
   * is a blocker, not a gap to be filled with a default.
   */
  mwBasis: MwBasis | null
  /** Where the figure came from, quoted closely enough to find again. */
  mwSource: string | null
  /** Other capacity figures in the corpus for the same record, which disagree. */
  conflictingFigures: readonly string[]
  /** Scopes Ber Wilson holds, where a PCA says. Empty where unknown. */
  scopesHeld: readonly ScopeKey[]
  pcaSigned: boolean
  siteControl: boolean
  /** The PCA's power role protection amount. Null = blank = zero. */
  powerProtectionAmount: number | null
  notes: readonly string[]
}

/**
 * ⚠ STEELTON IS THE ONLY RECORD WITH A SIGNED PROJECT COLLABORATION AGREEMENT,
 * and therefore the only one whose MW basis is contractually settled. PCA No. 1
 * item 3 reads "Planned IT Capacity and phasing: Up to 900 MW", and the MSPA
 * defines Planned IT Capacity as IT load. Every other record's figure is grid
 * or interconnection language, which is utility load — but said loosely enough
 * that it cannot be relied on, so it is recorded as unconfirmed.
 */
export const MSPA_REGISTER: readonly RegisterRecord[] = [
  {
    name: 'Steelton — Cleveland-Cliffs (PA)',
    kind: 'project',
    mspaScope: 'in',
    rationale:
      'Project Collaboration Agreement No. 1, signed by both TensorIQ officers 2026-10-12. A Ber Wilson Project with Ber Wilson as exclusive general contractor under Section 4.4(a).',
    state: 'PA',
    statedMw: 900,
    mwBasis: 'it',
    mwSource: 'PCA No. 1 item 3: "Planned IT Capacity and phasing — Up to 900 MW, developed in phases."',
    conflictingFigures: [
      'Grid Expansion Roadmap: Phase 1 300 MW, Phase 2 500 MW, Phase 3 700 MW — grid capacity, so utility load',
      'PPL interconnection "supports up to 300 MW" today; "capacity above 300 MW" needs network upgrades',
      'Existing configuration up to 120 MW; $135,000,000 at closing for the first 120 MW',
      'A supplemental PJM queue application is described for 500–700 MW',
    ],
    scopesHeld: ['A', 'B', 'C', 'D'],
    pcaSigned: true,
    siteControl: true,
    powerProtectionAmount: null,
    notes: [
      '⚠ THE PLANNED IT CAPACITY AND THE GRID ROADMAP DO NOT MEET. 900 IT MW needs about 1,260 utility MW at PUE 1.4 (1,080 even at immersion’s 1.2), while the roadmap tops out at 700 MW and PPL supports 300 MW today. Either the 900 MW is utility load mislabelled as Planned IT Capacity in the PCA, or the project needs roughly 560 MW more than its own roadmap plans for. This is the single most consequential open question on the deal.',
      'Fee adjustments to Schedule 1: "None." Tiered fees apply, subject to the 9.0% cap per phase.',
      'Fixed-price conversion exception: "none." Scope B is EPCM at 7.0%.',
      'Every phase is at Stage 2 (Secured) by the PCA’s own words, until that phase’s Scope Agreement is signed.',
      'Per-phase Planned IT Capacity is BLANK for all three phases, and so is every per-phase cost estimate.',
      'Target PSA closing 2026-11-01. Seller Cleveland-Cliffs Steelton LLC; broker fee 4% to Merlin Corbin.',
    ],
  },
  {
    name: 'Weirton — Cleveland-Cliffs (WV)',
    kind: 'project',
    mspaScope: 'in',
    rationale:
      'A Cleveland-Cliffs site in the same family as Steelton, in capture stage, with grid studies on file. No PCA yet, so Schedule 1 applies by default under Section 8.1 if and when Ber Wilson is engaged.',
    state: 'WV',
    statedMw: 300,
    mwBasis: null,
    mwSource: '"300 MW — power now, with a future ramp up of an additional 200-300MW"',
    conflictingFigures: [
      '"Total Ramp = 400MW" and, elsewhere in the same material, "Total Ramp = 220MW"',
      '"The substations are capable and have the capacity to deliver 480MW"',
      '"onsite and 900 MW" — the 900 figure also appears here, as it does on Steelton and Riverdale',
      'Phase I costed at "$550K per MW x 220MW"; Total Grid Power Evaluation = $234M',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'The basis is grid and substation language throughout, which is utility load — but it is never said, so it is recorded unconfirmed.',
      '⚠ A "Will Serve" letter from PPL confirming 120 MW appears in this record’s correspondence. PPL is a Pennsylvania utility and Weirton is in West Virginia, so either the thread covers both sites or a Steelton figure has been filed here.',
      '⚠ 900 MW appears on Steelton, Weirton AND Riverdale. Confirm the three are separate figures and not one number copied across three teasers.',
    ],
  },
  {
    name: 'Riverdale — Cleveland-Cliffs (IL)',
    kind: 'project',
    mspaScope: 'in',
    rationale:
      'A Cleveland-Cliffs site in capture stage with an energy services agreement in hand. No PCA yet.',
    state: 'IL',
    statedMw: 300,
    mwBasis: null,
    mwSource: '"now power, 300MW"; the teaser states 300 MW of initial power availability',
    conflictingFigures: [
      '"up to 900MW" and "The additional 600MW"',
      '"280–400 MW from the grid"; "200-300 MW" of initial availability',
      '"Estimated Value $250K per MW = Total Capacity = 400MW"',
      '"We have an ESA in hand for 65MW" — the only contracted figure on the record',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      '⚠ RIVERDALE IS IN COOK COUNTY, ILLINOIS — WHICH IS CHICAGO. TensorIQ materials carry a "Chicago" line treated as retired on our side; it is very likely this site under another name. ComEd feeds it, which is consistent.',
      'The 65 MW ESA is the only capacity here with a contract behind it; everything else is availability.',
    ],
  },
  {
    name: 'Whiskey (TX)',
    kind: 'project',
    mspaScope: 'in',
    rationale: 'A Texas power/data center site with a defined Oncor interconnection tranche.',
    state: 'TX',
    statedMw: 74.9,
    mwBasis: 'utility',
    mwSource: '"ONCOR TRANCHE 74.9 MW", "deliberately below the 75 MW" threshold',
    conflictingFigures: [
      'Two gas wells carry a 150 MW capability at 50,000 MMBtu/d',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'The 74.9 MW is an interconnection tranche, so it is unambiguously utility load — and it is deliberately set just under the 75 MW threshold, which is a regulatory design choice rather than a capacity estimate.',
      'At PUE 1.4 a 74.9 MW utility tranche carries about 53.5 IT MW — which is almost exactly the 74 MW reference tearsheet, making this the one record directly comparable to TensorIQ’s own worked example.',
    ],
  },
  {
    name: 'Zorro (TX)',
    kind: 'project',
    mspaScope: 'in',
    rationale: 'A Texas site 10 miles from Whiskey, on SPP rather than Oncor.',
    state: 'TX',
    statedMw: 55,
    mwBasis: null,
    mwSource: '"7 AC · 50–60 MW" — the midpoint is recorded',
    conflictingFigures: [
      '"Initial load 65–75 MW"',
      '"SPP · SOUTHWEST POWER POOL 15MW" — an order of magnitude below the others',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      '⚠ Three figures span 15 MW to 75 MW on one record. The 15 MW is tied to SPP and is probably a firm interconnection today against a 50–75 MW ambition. Confirm before any figure reaches a proposal.',
    ],
  },
  {
    name: 'West Wendover',
    kind: 'project',
    mspaScope: 'in',
    rationale:
      'A municipal power and quantum data center campus with a Bloom fuel cell PPA and an SMR master plan. Power and facility scopes are squarely MSPA work, though TensorIQ is not named on it.',
    state: 'NV',
    statedMw: 50,
    mwBasis: 'utility',
    mwSource: '"N+2 Base Load Capacity Required 50 MW"; power delivery target 50–100 MW',
    conflictingFigures: [
      'Site master plan 200–300 MW; switchyard sized for 154 MW',
      'NuScale 2x77 MW recommended; Oklo Aurora 60 MW as an alternative',
      'Bloom: 208 units of 250 kW = 52 MW installed for a 50 MW N+2 base load',
      'Excess capacity for grid export put at 54 MW',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'Generation-led rather than IT-led: the 50 MW is a base load to be served, not an IT load. The 208-unit Bloom count reconciles to it exactly, which is why the basis is recorded as utility with confidence.',
      'Phase 4 (2045–2050) adds 50 MW. A 2037–2041 operations date puts this outside any TensorIQ deployment horizon.',
    ],
  },
  {
    name: 'DUBHES Helper / Giovanni Resilience Campus',
    kind: 'project',
    mspaScope: 'in',
    rationale: 'A hardened modular data center campus in capture stage, with a real service inquiry.',
    state: 'UT',
    statedMw: 5,
    mwBasis: null,
    mwSource: '"Phase 1 comprises a planned 5 MW" and "first energisation to become a 5 MW" facility',
    conflictingFigures: [
      '"A nonbinding preliminary service inquiry at 6–8 MW"',
      '"Scale path: Modular, to 120 MW nameplate capacity"',
      'Anchor enclave at 250 kW; white floor racks at 50 kW, giving 0.31 MW',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'At 5 MW this is two orders of magnitude below the 74 MW reference case, so none of the TensorIQ per-MW rates should be assumed to scale down to it — fixed costs dominate at this size.',
      'The 120 MW scale path is an ambition, not a plan with power behind it.',
    ],
  },
  {
    name: 'Stockton Power Nexus - ER Hospital & Medevac Airport Tower',
    kind: 'project',
    mspaScope: 'in',
    rationale:
      'A power nexus with a $152.5M proposal already on the platform — the best candidate for the first full economics model.',
    state: 'UT',
    statedMw: 300,
    mwBasis: null,
    mwSource: '"Envelope sized to a generic 300 MW"',
    conflictingFigures: [
      '⚠ "1,011,984 MW" appears in the corpus and is an artefact, not a capacity — most likely MWh or a spreadsheet cell. It must never be read as a figure.',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      '"Envelope sized to a generic 300 MW" is explicitly a placeholder in its own wording, so it is a planning envelope rather than a project capacity.',
      'The $152.5M proposal is an ANNUAL figure on the platform’s own reading; it must not be compared against a contract-value total.',
    ],
  },
  {
    name: 'Myton Development',
    kind: 'project',
    mspaScope: 'unsized',
    rationale:
      'A real development, but every capacity figure in the corpus is a gigawatt-scale third-party ambition rather than a Ber Wilson scope.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [
      '"Co-location with 5 GW" and "The co-located 5 GW" of immediate captive demand',
      '"DGITK/Oracle 1 GW" in Phase 1B; "Phased Deployment: 500 MW"',
      '"333 MW" of Bloom fuel cells; "solar + 400MW"',
      '"Development of over 500MW" — a counterparty’s track record, not this site',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      '⚠ THE GIGAWATT FIGURES HERE DESCRIBE ORACLE AND DGITK AMBITIONS, NOT A CONTRACTED SCOPE. A 5 GW co-location is 70x the entire TensorIQ tracked pipeline; nothing should be sized off it.',
      'Needs one stated figure for Ber Wilson’s own scope before anything can be computed.',
    ],
  },
  {
    name: 'Myton Rail',
    kind: 'project',
    mspaScope: 'unsized',
    rationale:
      'A rail corridor project. The MW figures belong to the data centers it would serve, not to the rail scope.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [
      '"Anchor tenants DGITK and Oracle have provided 2 GW"; Phase 2 at 3 GW',
      '"We will start with 100 MW" and "modular style phased deployment of 25 MW"',
      '"4-6% of required 80-125 GW" — a national market figure',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'Rail is Scope C-adjacent site work at most. The 25 MW and 100 MW figures are the only ones at a plausible scale and belong to the campus, not the corridor.',
    ],
  },
  {
    name: 'Box Elder Quantum Campus',
    kind: 'project',
    mspaScope: 'unsized',
    rationale:
      'In capture stage, but every figure in the corpus is a cited press release about other companies.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [
      '"Bloom Energy and Oracle expand strategic partnership to deploy up to 2.8 GW" — a press release',
      '"O’Leary ventures partners with West GenCo for 15 GW" — a press release',
      '"7.5 GW" appears twice, cited to Ber Wilson LLC 2026a',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      '⚠ ALL THREE GIGAWATT FIGURES ARE CITATIONS TO OTHER PARTIES’ ANNOUNCEMENTS. The 7.5 GW is cited to our own prior document, which is not the same as a site with 7.5 GW behind it.',
    ],
  },
  {
    name: 'Delta Industrial Campus — Daves Farms',
    kind: 'project',
    mspaScope: 'unsized',
    rationale:
      'The only record with vehicles already standing (Delta Land, Energy and Data Center LLC), but no capacity figure anywhere in the corpus.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'Three SPVs exist with Ber Wilson flagged as sponsor and equity_pct deliberately NULL, so our share reads undetermined and Delta’s revenue is held out of any net total.',
      '⚠ The rezone application states HD-5534-A-1 at 13.00 acres against Millard County’s 4.69, and an exhibit total of 928.98 acres against a cadastral 920.67. Resolve with the recorder before any figure goes into an application or a price.',
      'A data center SPV with no megawatt figure cannot be sized at all. One number would unlock the whole model here.',
    ],
  },
  {
    name: 'GridEdge',
    kind: 'opportunity',
    mspaScope: 'unsized',
    rationale:
      'A genuine power and modular data center infrastructure opportunity, but the figures are a business plan ramp rather than a site.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [
      'BladeRoom DC deployments scaling 10 → 70 → 170 → 320 → 520 MW, reaching 1,820 MW',
      '"Ber Wilson (1+ GW), Global Connect Communications (up to 3 GW)" as pipeline',
      '"the signed Thundercat 10 MW" — the only contracted figure, in a $42–58M pipeline',
      'Enterprise and government customers engage at 2 to 20 MW',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'The signed Thundercat 10 MW is the one figure with a contract behind it. The 1,820 MW is a 2035 cumulative deployment target.',
      '⚠ "Ber Wilson (1+ GW)" appears here as a pipeline entry about US. Confirm what it refers to — it is not any of the sited projects on this register.',
    ],
  },
  {
    name: 'Tooele',
    kind: 'project',
    mspaScope: 'unsized',
    rationale: 'Infrastructure in pursuit, with one chunk of correspondence and no capacity figure.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      '38 documents were re-filed onto Tooele from the Corporate/M&A shelf after an alias was asserted, so the record has paperwork but no stated capacity.',
    ],
  },
  {
    name: 'American Energy Rail Corridor - Community Development',
    kind: 'project',
    mspaScope: 'unsized',
    rationale: 'A corridor development; the energy figures cited are regional and third-party.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [
      '"SMR nuclear integration: Myton 2 GW maximum potential"',
      '"Stargate advances with 4.5 GW"; "Utah’s flagship renewable energy asset enabling 4.0 GW"',
    ],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: ['Every figure is a regional potential or another party’s project.'],
  },
  {
    name: 'Heber Development',
    kind: 'project',
    mspaScope: 'unsized',
    rationale: 'Named on the brief’s Project Register, but a real estate development with no capacity figure.',
    state: 'UT',
    statedMw: null,
    mwBasis: null,
    mwSource: null,
    conflictingFigures: [],
    scopesHeld: [],
    pcaSigned: false,
    siteControl: false,
    powerProtectionAmount: null,
    notes: [
      'Has no coordinates and is not on the map; its site plan has no legend or survey basis, and was photographed rather than exported.',
    ],
  },
  // ── Out of scope. Schedule 1 does not apply to any of these. ──────────────
  {
    name: 'Case Garage',
    kind: 'project',
    mspaScope: 'out',
    rationale: 'A Salt Lake City real estate / prefab steel job. Not a data center or power project.',
    state: 'UT',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: ['Prefab steel collaboration; belongs to the /steel pipeline, not the MSPA.'],
  },
  {
    name: 'DFCM Camp Williams Bldg. 4140 project',
    kind: 'project',
    mspaScope: 'out',
    rationale: 'A Utah state facilities construction bid. Government contracting, outside the partnership.',
    state: 'UT',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [],
  },
  {
    name: 'Alaska Strategic Materials JV',
    kind: 'project',
    mspaScope: 'out',
    rationale: 'A mining and geologic hydrogen joint venture. Not within the MSPA scopes.',
    state: 'AK',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: ['⚠ Genuinely in Alaska, unlike TensorIQ’s "Newport, AK" line, which is almost certainly Arkansas.'],
  },
  {
    name: 'Tonga Development Project',
    kind: 'project',
    mspaScope: 'out',
    rationale: 'Real estate development in Nuku’alofa. Outside the United States and outside the partnership.',
    state: null,
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [],
  },
  {
    name: 'Alaska Golden Summit / True North Gold & Geologic Hydrogen JV',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale: 'Mining and hydrogen JV. Not an MSPA scope.',
    state: 'AK',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [],
  },
  {
    name: 'Gold mine',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale: 'Mining. Not an MSPA scope, and the record carries no location.',
    state: null,
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [],
  },
  {
    name: 'Dino Plumbing',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale:
      'The acquired plumbing and HVAC operating company, tracked at /dino. An internal operating company, not a deal.',
    state: 'CO',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      '⚠ Its sector was set to `technology` by the curator and should read plumbing/HVAC. Fixing it on the record marks the field as human-typed, after which the curator proposes rather than overwrites.',
    ],
  },
  {
    name: 'Elite Solutions',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale:
      'A party to the MSPA rather than a deal under it: Technology Advisor for Internal Technology Systems through the AVANT ecosystem.',
    state: 'CO',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      'Earns 1.5% of total AVANT Ecosystem commissions on Internal Technology Systems, paid only from provider-funded commissions. Never charged to Ber Wilson, TensorIQ or the owner.',
      '⚠ The commission base is unresolved: 1.5% a year of the internals CAPITAL value is about $26.25M a year to us on 200 MW, against 1.5% of its annual revenue — two orders of magnitude apart.',
    ],
  },
  {
    name: 'IAN (EMP) Technology aquisition',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale: 'A technology acquisition, not a project. The 2 MW mentioned is incidental.',
    state: null,
    statedMw: null, mwBasis: null, mwSource: null,
    conflictingFigures: ['"the addition of approximately 2 MW" — incidental to the acquisition'],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: ['IAN_Company_Report 4.0 053126.docx is the one genuinely ambiguous filing left on /decide.'],
  },
  {
    name: 'Zenthium Partnership',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale: 'A partnership opportunity with no capacity or construction scope on the record.',
    state: 'CO',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      'The recorded call of 09-29 is now FILED on this record (2026-10-21), resolved from the organiser\'s own title "Ber Wilson / Zenthium" against an asserted alias. The model had retitled it "Steelton & Riverdale Site Reviews & Power Capacity Analysis", which is why it had looked like a Steelton call in every list.',
    ],
  },
  // ── Added 2026-10-21, on Richard's instruction, from evidence already on file.
  // Each was a real engagement sitting on no record; all three are `out` or
  // `unsized` rather than `in`, because none has a capacity figure a document
  // actually states — which is the register's whole discipline.
  {
    name: 'Synetra',
    kind: 'opportunity',
    mspaScope: 'out',
    rationale:
      'An MNDA and one call. No site, no capacity and no construction scope on the record, so Schedule 1 has nothing to apply to.',
    state: null,
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      'Bahadir Yetki. The MNDA with non-circumvention was eSigned by both sides at 10:57 on 2026-10-19, and a second MNDA (Firm Power) at 11:14.',
      '⚠ What was SAID on the 10:00 call is on no record: no recording of it exists. The invite and both signatures are on file; the substance is not.',
    ],
  },
  {
    name: 'Deseret / Bonanza Power Generation',
    kind: 'opportunity',
    mspaScope: 'unsized',
    rationale:
      'A power generation deal the partnership would cover, but the 438 MW figure is the PLANT\'s nameplate rather than a load Ber Wilson is contracted to deliver — so nothing computes until a scope exists.',
    state: 'UT',
    statedMw: 438,
    // ⚠ NULL ON PURPOSE AND IT IS A BLOCKER, NOT A GAP. 438 MW is generation
    // capacity at the plant, which is neither IT load nor utility load drawn by
    // a data centre — the two quantities Schedule 1 is written in. Guessing a
    // basis here is the unit trap this register exists to refuse.
    mwBasis: null,
    mwSource: '"Bonanza, which is a coal fire plant on the border of Eastern Utah… 438 megawatts" — recorded call, 2026-08-20',
    conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      'Operated by Deseret Power Electric Cooperative, which the call described as community-first and not for-profit.',
      'The call set a hard next step: a conditional partnership agreement to be drafted within 10 days (from 2026-08-20). That date has long passed — worth checking whether it was ever drafted.',
      'A $5B funding structure and three unresolved regulatory items were named on the call.',
    ],
  },
  {
    name: 'Tensor Site Construction Management',
    kind: 'opportunity',
    mspaScope: 'unsized',
    rationale:
      'Construction management across the whole Tensor site — squarely MSPA scope — with no site-level capacity figure stated, so the fee base cannot be computed yet.',
    state: null,
    statedMw: null, mwBasis: null,
    mwSource: '120 MW was named for the DEMO PHASE only, not for the site',
    conflictingFigures: [
      '"120 MW of power will be activated for the demo phase within two to four weeks" — recorded call, 2026-10-09. A phase figure, not the site figure.',
    ],
    // Left empty rather than guessed: the call confirmed the CM ROLE in words,
    // and no PCA naming its Schedule 1 scopes is on file.
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      'Ber Wilson confirmed on the 2026-10-09 call that it will serve as construction management firm for the ENTIRE Tensor site.',
      'State licensing strategy and the teaming-agreement structure were discussed on the same call.',
      '⚠ Deliberately its own record rather than folded into a Cleveland-Cliffs site: the scope is site-wide CM, which no existing record carries.',
    ],
  },
  {
    name: 'Eagle Mountain Data Center & Land Acquisition',
    kind: 'project',
    mspaScope: 'unsized',
    rationale:
      'A Utah data-centre and land play from the Project Register, with nothing in the corpus beyond its name.',
    state: 'UT',
    statedMw: null, mwBasis: null, mwSource: null, conflictingFigures: [],
    scopesHeld: [], pcaSigned: false, siteControl: false, powerProtectionAmount: null,
    notes: [
      'Created 2026-10-21 so correspondence has somewhere to file; status is on_hold, not active.',
      '⚠ This is §12\'s own worked example for why a similarity score cannot match a record name — "Eagle Mountain Development" scored 0.487 against Myton Development, higher than a correct match elsewhere. Its aliases are asserted for that reason.',
    ],
  },
]

/** The records the MSPA machinery can actually compute something for. */
export function inScopeRecords(): RegisterRecord[] {
  return MSPA_REGISTER.filter((r) => r.mspaScope === 'in')
}

/** Records whose MW figure does not say which load it measures. */
export function unconfirmedBasisRecords(): RegisterRecord[] {
  return MSPA_REGISTER.filter((r) => r.statedMw != null && r.mwBasis == null)
}

export interface RegisterSummary {
  total: number
  inScope: number
  unsized: number
  outOfScope: number
  withStatedMw: number
  withConfirmedBasis: number
  withSignedPca: number
  withSiteControl: number
  withCostEstimate: number
}

/**
 * The register in one line, which is the honest headline: of 26 records, one
 * has a signed agreement and none has a cost estimate.
 */
export function summarizeRegister(): RegisterSummary {
  const r = MSPA_REGISTER
  return {
    total: r.length,
    inScope: r.filter((x) => x.mspaScope === 'in').length,
    unsized: r.filter((x) => x.mspaScope === 'unsized').length,
    outOfScope: r.filter((x) => x.mspaScope === 'out').length,
    withStatedMw: r.filter((x) => x.statedMw != null).length,
    withConfirmedBasis: r.filter((x) => x.mwBasis != null).length,
    withSignedPca: r.filter((x) => x.pcaSigned).length,
    withSiteControl: r.filter((x) => x.siteControl).length,
    // ⚠ ZERO. No record on the platform has a per-phase cost estimate, which is
    // why every fee figure anywhere in this folder is modelled.
    withCostEstimate: 0,
  }
}

/**
 * Default export, so a verification script can import this module.
 *
 * ⚠ A SCRIPT CANNOT NAMED-IMPORT AN `export const` FROM `src/lib` — Node's CJS
 * lexer surfaces an `export function` and not a const, so `measure-mspa-register`
 * would die on `MSPA_REGISTER` while Next compiles it fine. The default export
 * is the way in.
 */
const registerModule = {
  MSPA_REGISTER,
  inScopeRecords,
  unconfirmedBasisRecords,
  summarizeRegister,
}

export default registerModule
