/**
 * THE DATA ROOM — the one declaration of what a project's folders are.
 *
 * Richard's standard, 2026-10-29: three sections and nineteen subfolders, so a
 * partner or a lender opening any deal's room finds the same shelf in the same
 * place. The point is not tidiness. A diligence index answers "what is still
 * missing", and the scheme this replaces — `Contracts & Legal`, `Diligence/…`,
 * `_Unsorted` — could only ever answer "where does this document live".
 *
 * ⚠ ONE HOME, AND IT HAS TO STAY ONE. Six things derive from the list below:
 * the folders built in Drive (`setup-drive-structure.mts`), the re-filing pass
 * (`refile-to-data-room.mts`), the classifier's candidate set (`classify.ts`),
 * the Documents tab's shelves, the Data Room tab, and the 00.2 tracker
 * published back into Drive. A second copy of the names anywhere is a drift
 * that shows up as a document filed into a folder nobody is looking at.
 *
 * ⚠ THE CANDIDATE IS THE KEY (`01.5`), NEVER THE LABEL. The labels collide as
 * substrings in every direction — `title` is in both `01.1 Site Control &
 * Title` and `01.2 Zoning & Entitlements`, `permits` in `01.2` and `01.4`,
 * `insurance` in `01.1` (title insurance) and `01.8`, `power` in `01.5` and
 * `01.6`. Under the old label-substring hints every one of those rules would be
 * refused as ambiguous and fall silently to the model — which is exactly what
 * happened when the Diligence lanes shipped and killed every land/title rule
 * (§12, 10-08). Keying on `NN.N` makes the whole collision class unreachable,
 * and `ambiguousHintRules()` asserts it.
 *
 * ⚠ ONLY SOME RECORDS USE IT (Richard's decision, 10-29). The template is
 * written for power and data-center deals; section 02 is compute offtake and
 * means nothing on a plumbing acquisition or a DFCM building job. So two
 * templates live at once and the record says which it is — see
 * {@link ROOM_TEMPLATES}.
 */

/**
 * `Ber Wilson Proper (HQ)` on the `Ber Wilson Proper` shared drive, and the
 * shelf the rooms sit on.
 *
 * ⚠ IN src/lib BECAUSE FOUR CALLERS MUST AGREE ON THEM EXACTLY, which is the
 * same reason `driveFolderName` lives in `classify.ts`:
 * `setup-drive-structure.mts` creates `02 Projects/<name>` and
 * `migrate-drive-structure.mts` looks it up by that name, and the second had
 * already grown its own copy of the string. Hard-coded ids rather than a search
 * by name — a vendor's folder name is a UI string, not an API contract (§12,
 * 09-28: matching "Meet Recordings" by name reported success 192 times against
 * a Drive that had one).
 */
export const HQ_FOLDER_ID = '1RmNqygvuzKeEAMvX_3tAQ0FNszXet0K9'

/** The shared drive the HQ folder lives on. `listSubfolders` needs it
 *  explicitly (`corpora=drive`) or it reads as an empty folder, not an error. */
export const SHARED_DRIVE_ID = '0ANJNCh7N8A9MUk9PVA'

export const PROJECTS_SHELF = '02 Projects'

/** One shelf of the room. A parent section, or one of the nineteen leaves. */
export interface DataRoomSection {
  /** `00`, `01.5`. The matcher's candidate and the tracker's key. */
  key: string
  /** `Utility Power Commitment`. Display only — never matched on. */
  label: string
  /** The parent section's key, or null for a top-level section. */
  parent: string | null
  /**
   * The documents expected here, in Richard's own words — which is what makes
   * them usable as the 00.2 tracker's rows rather than a second list somebody
   * has to keep in step with this one.
   */
  expects: string[]
  /**
   * A section that is legitimately empty on some deals, so its absence is not
   * a gap. Richard's own instruction for 01.6: "Mark this folder Not Applicable
   * for projects without on-site generation."
   */
  optional?: boolean
}

/**
 * Where the classifier puts a document it is not confident about.
 *
 * `00.0` so it sorts ABOVE every real section: it is the one shelf that is
 * asking for a decision rather than holding an answer, and the Documents tab
 * already ranks `_Unsorted` first for the same reason.
 */
export const UNSORTED_SECTION = '00.0'

/**
 * Richard's three sections and nineteen subfolders, in his order.
 *
 * Order is load-bearing twice over: it is the reading order a partner gets
 * (Drive sorts by name and the numbers make the sort the intent), and it is the
 * row order of the 00.2 tracker.
 */
export const DATA_CENTER_ROOM: DataRoomSection[] = [
  { key: UNSORTED_SECTION, label: '_Unsorted', parent: null, expects: [], optional: true },

  { key: '00', label: 'Start Here', parent: null, expects: [] },
  {
    key: '00.1',
    label: 'Project Summary',
    parent: '00',
    expects: [
      'Site, development plan, project phase and key counterparties',
      'Capacity by phase — utility import MW, total facility MW, usable IT MW, GPU configuration and count',
      'Key dates — site-control expiration, permitting, energization, commissioning, customer service commencement',
      'Total project cost, financing requirement, equity committed, contracted compute revenue',
      'Principal outstanding conditions and risks',
    ],
  },
  {
    key: '00.2',
    label: 'Master Document Index & Outstanding Items',
    parent: '00',
    expects: ['Master document index and outstanding-items tracker'],
  },
  {
    key: '00.3',
    label: 'Project Entities & Ownership',
    parent: '00',
    expects: [
      'Organization chart — sponsor, landowner, developer, facility owner, compute operator, borrower, customer',
      'Formation documents',
      'Ownership and capitalization information',
      'Good-standing certificates',
      'Signing authorizations',
      'Intercompany leases and services agreements',
      'Existing financing documents, liens and restrictions affecting the project',
    ],
  },
  {
    key: '00.4',
    label: 'Financial Model & Funding',
    parent: '00',
    expects: [
      'Current financial model and supporting assumptions',
      'Sources and uses',
      'Phased development budget',
      'Operating budget and contingency',
      'Financing proposals and term sheets',
      'Executed financing documents',
      'Equity commitment documents and evidence of funds contributed',
      'Base and downside cases, debt-service analysis, liquidity requirements',
      'Sponsor completion guarantee or cost-overrun support',
    ],
  },

  { key: '01', label: 'Power & Property', parent: null, expects: [] },
  {
    key: '01.1',
    label: 'Site Control & Title',
    parent: '01',
    expects: [
      'Recorded deed, purchase agreement, purchase option, ground lease or facility lease',
      'Amendments, extensions, deposit receipts and closing documents',
      'Title commitment and title exception documents',
      'Final title insurance policy',
      'ALTA/NSPS survey and parcel/legal descriptions',
      'Access, utility, transmission, water and fiber easements',
      'Assignment and mortgage consents, landlord estoppels, nondisturbance agreements',
    ],
  },
  {
    key: '01.2',
    label: 'Zoning & Entitlements',
    parent: '01',
    expects: [
      'Written zoning verification and zoning map',
      'Applicable permitted-use provisions',
      'Rezoning approvals, conditional/special-use permits, variances',
      'Approved site plans',
      'Development agreements and conditions attached to approvals',
      'Documentation for data center use, substations, generation, fuel storage, cooling equipment',
      'Status of appeals, challenges, public hearings and remaining approvals',
    ],
  },
  {
    key: '01.3',
    label: 'Environmental & Remediation',
    parent: '01',
    expects: [
      'Current Phase I environmental site assessment',
      'Historical environmental reports',
      'Phase II testing and other investigations',
      'Environmental agency correspondence and notices',
      'Remediation plans, budgets, schedules and cleanup contracts',
      'Cleanup completion reports and agency closure / no-further-action documentation',
      'Ongoing monitoring requirements and environmental restrictions',
      'Allocation of cleanup responsibility',
      'Consultant reliance letters and environmental insurance',
    ],
  },
  {
    key: '01.4',
    label: 'Physical Site Studies & Permits',
    parent: '01',
    expects: [
      'Geotechnical report',
      'Topographic survey',
      'Floodplain, drainage, stormwater and wetlands studies',
      'Ecological, cultural-resource, noise and other site-specific studies',
      'Permit register — required permits, issuing authorities, status, conditions, expirations',
      'Issued grading, building, stormwater, wetland, air, water and wastewater permits',
    ],
  },
  {
    key: '01.5',
    label: 'Utility Power Commitment',
    parent: '01',
    expects: [
      'Power summary — MW by phase, delivery point, estimated vs committed energization, costs, remaining conditions',
      'Utility capacity / service letters and material correspondence',
      'Load applications and study agreements',
      'Feasibility, system-impact and facilities studies',
      'Executed electric service agreements and applicable tariffs',
      'Line-extension, substation and other utility construction agreements',
      'Upgrade cost allocations, deposit receipts, collateral and security documentation',
      'Phased energization schedule and remaining utility or regulatory conditions',
      'Service characteristics, curtailment rights, minimum billing obligations, cancellation exposure',
    ],
  },
  {
    key: '01.6',
    label: 'On-Site / Behind-the-Meter Generation',
    parent: '01',
    optional: true,
    expects: [
      'Generation ownership documents or executed power purchase / tolling agreements',
      'Fuel supply and fuel transportation agreements',
      'Generation permits and operating / emissions restrictions',
      'Equipment purchase, construction and O&M agreements',
      'Grid-parallel, standby, import/export and interconnection approvals',
      'Shared-site arrangements, easements and lender consents',
      'Generation capacity, availability, backup and commissioning documentation',
    ],
  },
  {
    key: '01.7',
    label: 'Design, Infrastructure & Construction',
    parent: '01',
    expects: [
      'Basis of design, site layouts, electrical single-line diagrams, cooling design',
      'Facility capacity and PUE assumptions',
      'Water / sewer service commitments',
      'Fiber route and carrier agreements',
      'Detailed construction budget and integrated project schedule',
      'EPC / general contractor agreements, scope documents, change orders',
      'Contractor guarantees and bonds',
      'Purchase orders and delivery schedules for transformers, switchgear, cooling equipment, generators',
      'Commissioning plans, test results, completion certificates, occupancy approvals',
      'Independent engineer / technical consultant reports and appraisals',
    ],
  },
  {
    key: '01.8',
    label: 'Facility Operations & Insurance',
    parent: '01',
    expects: [
      'Facility management and O&M agreements',
      'Staffing, maintenance, emergency response and business continuity plans',
      'Insurance policies, certificates, coverage summaries and lender endorsements',
      'Operating reports and maintenance records',
    ],
  },

  { key: '02', label: 'Capacity Commitment', parent: null, expects: [] },
  {
    key: '02.1',
    label: 'Customer Identity & Credit',
    parent: '02',
    expects: [
      'Customer legal name, ownership information and authorized signatory details',
      'Customer and guarantor financial statements',
      'Credit reports or ratings',
      'Parent guarantees, letters of credit, deposits, prepayment evidence',
      'For resellers / intermediaries — who owes us payment, and whether it depends on end-customer payment',
    ],
  },
  {
    key: '02.2',
    label: 'LOIs & Capacity Reservations',
    parent: '02',
    expects: [
      'Signed LOIs and commercial term sheets',
      'Capacity reservation agreements',
      'Exclusivity provisions and reservation deposit documentation',
      'Milestone schedules, expiration dates and outstanding conditions',
      'Which provisions are binding and which are nonbinding',
    ],
  },
  {
    key: '02.3',
    label: 'Definitive Compute Agreements',
    parent: '02',
    expects: [
      'Executed compute services agreements (CSA) or master services agreements (MSA)',
      'Signed order forms and capacity schedules',
      'Amendments, side letters, exhibits and incorporated terms',
      'Pricing, minimum purchase commitments, contract duration and ramp schedules',
      'Power cost pass-through provisions',
      'Cancellation, termination, renewal and termination-payment provisions',
    ],
  },
  {
    key: '02.4',
    label: 'Technical Delivery & Customer Acceptance',
    parent: '02',
    expects: [
      'Contracted GPU / server specifications, quantities and configurations',
      'Networking, storage, software and security requirements',
      'Delivery milestones and phased deployment schedules',
      'Conditions required before service commencement',
      'Acceptance criteria, test procedures and commissioning results',
      'Customer acceptance certificates and service commencement notices',
    ],
  },
  {
    key: '02.5',
    label: 'Service Performance & Billing',
    parent: '02',
    expects: [
      'Service-level agreements and service-credit schedules',
      'Support, maintenance, availability and performance obligations',
      'Data-processing, cybersecurity and other customer requirements',
      'Billing schedules and payment terms',
      'Invoices, collections, performance reports, service credits and material disputes',
    ],
  },
  {
    key: '02.6',
    label: 'Compute Equipment & Operating Platform',
    parent: '02',
    expects: [
      'Executed GPU / server purchase orders and vendor agreements',
      'Confirmed allocations, deposits and delivery schedules',
      'Equipment financing or lease agreements',
      'Ownership records, asset registers, serial numbers and lien information',
      'Warranties, maintenance / support agreements, replacement and refresh plans',
      'Material software licenses and platform / operator agreements',
    ],
  },
  {
    key: '02.7',
    label: 'Lender Rights & Consents',
    parent: '02',
    expects: [
      'Customer consents to assignment or security interests',
      'Direct agreements providing lender notice, cure or step-in rights',
      'Customer acknowledgments and estoppels',
      'Consents from equipment vendors, platform providers and other critical counterparties',
      'Remaining conditions for those rights to become effective',
    ],
  },
]

/**
 * THE THREE WORKING FOLDERS THE TEMPLATE HAS NO SLOT FOR.
 *
 * ⚠ MEASURED, NOT ASSUMED. The template is a diligence closet and the platform
 * feeds a record three things that are not diligence: mail attachments (the
 * sweep's largest automatic feed), meeting transcripts and recaps, and RFPs and
 * bids — 43 documents, and an inbound solicitation is a live line of business
 * on `/leads`. Forcing any of them into a numbered section would misfile it,
 * and dropping them would lose the platform's own output.
 *
 * Un-numbered, so Drive's name sort puts them AFTER `00`/`01`/`02`: the room
 * reads as the data closet first and the working files below it.
 */
export const WORKING_FOLDERS = ['Correspondence', 'Meetings', 'Proposals & Bids'] as const

/**
 * The two status subfolders, inside every leaf section.
 *
 * Richard's convention, and `Superseded` already works end to end:
 * `isArchiveFolder()` lists `superseded`, so `listFolder` skips the subtree and
 * `reconcileVanished` turns the disappearance into a supersession — dragging a
 * file there retires the document that night, with no platform login needed.
 *
 * `Drafts` is the opposite and needs the care: the file IS imported, and must
 * never be read as the operative document. Richard's instruction — "do not
 * label site control, power, or compute capacity as secured solely because an
 * LOI or preliminary letter exists" — is a retrieval rule, not just a filing
 * one, which is why {@link isDraftPath} exists for the agent tools to call.
 */
export const DRAFTS_FOLDER = 'Drafts'
export const SUPERSEDED_FOLDER = 'Superseded'

/** Which template a record's room is built from. */
export type RoomTemplateKey = 'standard' | 'data_center'

/**
 * ⚠ TYPED `Record<RoomTemplateKey, …>` ON PURPOSE, IN THE MODULE THAT OWNS THE
 * VOCABULARY. §12, 10-29: a hand-written enumeration beside a registry drifts,
 * a ⚠ comment saying so does not stop the next component drifting, and the fix
 * that ends it is the TYPE rather than the derivation — three surfaces had
 * already drifted from a kind registry before that was accepted. Adding a
 * template here makes the build name every switch that has not handled it.
 *
 * `standard` is deliberately NOT a `DataRoomSection[]`: it is the existing flat
 * scheme in `classify.ts` and the 24 records still on it must keep behaving
 * exactly as they do today. Describing it here as `null` says "ask classify.ts",
 * which is true, rather than forking its list into a second copy.
 */
export const ROOM_TEMPLATES: Record<RoomTemplateKey, DataRoomSection[] | null> = {
  standard: null,
  data_center: DATA_CENTER_ROOM,
}

/** The default for a record nobody has made a decision about. */
export const DEFAULT_ROOM_TEMPLATE: RoomTemplateKey = 'standard'

export function isRoomTemplateKey(value: string | null | undefined): value is RoomTemplateKey {
  return value === 'standard' || value === 'data_center'
}

/**
 * A section's folder name in Drive — `01.5 — Utility Power Commitment`.
 *
 * ONE formatter, because Drive and the platform compare these strings to each
 * other: the folders are created from this and `sectionOf` parses
 * `drive_folder_path` back. An em dash with spaces, matching Richard's outline.
 */
export function folderName(section: DataRoomSection): string {
  return `${section.key} — ${section.label}`
}

/**
 * A leaf's folder names below the record folder, OUTERMOST FIRST.
 *
 * ⚠ SEGMENTS, NOT A SLASH-JOINED STRING, AND THAT DISTINCTION WAS A LIVE BUG IN
 * 42 DRIVE ROOMS. Richard's own section 01.6 is named `On-Site /
 * Behind-the-Meter Generation` — it contains a slash — so the joined path
 * `01 — Power & Property/01.6 — On-Site / Behind-the-Meter Generation` split
 * into THREE segments and the builder created `01.6 — On-Site ` holding
 * ` Behind-the-Meter Generation`. Meanwhile `tracker.ts` resolved the same
 * folder through `folderName()` directly and created the correct one, so
 * Steelton ended up with BOTH. Two code paths disagreeing about one folder is
 * the §12 failure in its purest form, and `classify.ts` has carried a warning
 * about precisely this since a folder called `Fort Polk / Johnson - Design
 * Build Matocc` was found on this drive.
 *
 * A path that must be split is a path that can be split wrong. Nothing splits
 * any more: callers walk the array.
 */
export function sectionSegments(
  section: DataRoomSection,
  template = DATA_CENTER_ROOM
): string[] {
  if (!section.parent) return [folderName(section)]
  const parent = template.find((s) => s.key === section.parent)
  return parent ? [folderName(parent), folderName(section)] : [folderName(section)]
}

/**
 * The same thing joined, for DISPLAY and for comparing against a stored
 * `drive_folder_path`.
 *
 * ⚠ LEGITIMATE HERE AND ONLY HERE. `listFolder` builds a file's path by joining
 * folder names with `/`, so this is the exact string the importer stores and
 * `sectionOf` is built to read back — including the slash inside 01.6's own
 * name, which `sectionOf` survives because it matches the `NN.N` PREFIX of a
 * segment rather than counting segments. ⚠ NEVER split the result to create
 * folders; use {@link sectionSegments}.
 */
export function sectionPath(section: DataRoomSection, template = DATA_CENTER_ROOM): string {
  return sectionSegments(section, template).join('/')
}

/** The nineteen leaves plus `00.0`, in order. Parents hold no documents. */
export function leafSections(template = DATA_CENTER_ROOM): DataRoomSection[] {
  return template.filter((s) => s.parent !== null || s.key === UNSORTED_SECTION)
}

/** Lookup by key, for a stored value whose section has to be named. */
export function sectionByKey(
  key: string | null,
  template = DATA_CENTER_ROOM
): DataRoomSection | null {
  if (!key) return null
  return template.find((s) => s.key === key) ?? null
}

/**
 * THE ONE PARSER FROM A STORED `drive_folder_path` TO A SECTION KEY.
 *
 * ⚠ EVERY READER CALLS THIS. §12: a predicate transcribed into its readers has
 * a home per reader and the one that lies to you is found last — a backfill
 * printed `0 to index` immediately before indexing 48. The section is derived
 * rather than stored because `drive_folder_path` is already written on every
 * imported document (`import.ts`) and a second column would be a copy that can
 * disagree with the folder a human can see.
 *
 * ⚠ SPLITTING ON `/` IS SAFE HERE ONLY BECAUSE OF WHAT IS MATCHED. A real Drive
 * folder name can contain a slash — this drive has `Fort Polk / Johnson -
 * Design Build Matocc` — so a path cannot be split to discover its structure in
 * general (`classify.ts`'s FOLDER_PATH_SEP warning). What is matched here is a
 * segment that BEGINS `NN.N`, a shape only our own folders have, so a human
 * folder containing a slash can never be mistaken for a section.
 *
 * ⚠ AND THE KEY MUST BE ONE THE TEMPLATE DECLARES, not merely `NN.N`-shaped.
 * The shape alone matched a folder called `10.5 MW study` — found by the test
 * for this function, not in production, which is the whole argument for writing
 * the hostile cases down. Membership closes the class: a number that happens to
 * look like a section is not one.
 */
export function sectionOf(
  drivePath: string | null | undefined,
  template = DATA_CENTER_ROOM
): string | null {
  if (!drivePath) return null
  for (const segment of drivePath.split('/')) {
    const m = segment.trim().match(/^(\d{2}\.\d)(?:\s|$|—|-)/)
    if (m && template.some((s) => s.key === m[1])) return m[1]
  }
  return null
}

/**
 * Is this document a draft rather than the operative instrument?
 *
 * Read from the path's last segment, so it stays true for a file a human drags
 * into `Drafts` with no platform involvement at all.
 */
export function isDraftPath(drivePath: string | null | undefined): boolean {
  if (!drivePath) return false
  const segments = drivePath.split('/')
  return segments[segments.length - 1]?.trim().toLowerCase() === DRAFTS_FOLDER.toLowerCase()
}

/**
 * EVERY FOLDER A DATA-CENTER ROOM CONTAINS, as SEGMENT LISTS, in creation order.
 *
 * Parents first so no folder is created implicitly, then each leaf, then its two
 * status subfolders, then the working folders.
 *
 * ⚠ RETURNS `string[][]`, NOT `string[]`. See {@link sectionSegments}: the
 * joined form was split by the builder and 01.6's own slash became a folder
 * boundary in 42 rooms. A caller walks the inner array and never splits.
 */
export function roomFolderSegments(template = DATA_CENTER_ROOM): string[][] {
  const out: string[][] = []
  for (const section of template) {
    if (!section.parent && section.key !== UNSORTED_SECTION) {
      out.push([folderName(section)])
    }
  }
  for (const section of leafSections(template)) {
    const segments = sectionSegments(section, template)
    out.push(segments)
    // `00.0 — _Unsorted` holds what nothing could place; a draft or a
    // superseded copy of an unplaced document is not a distinction worth three
    // folders nobody opens.
    if (section.key === UNSORTED_SECTION) continue
    out.push([...segments, DRAFTS_FOLDER], [...segments, SUPERSEDED_FOLDER])
  }
  for (const working of WORKING_FOLDERS) out.push([working])
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLDING THE OLD SCHEME INTO THE NEW ONE
//
// ⚠ DETERMINISTIC ONLY, NO MODEL CALL, AND THAT IS A MEASURED DECISION. There
// are ~600 documents on the records that take this template; `chooseFolder`
// costs one local-model call each at 30–60s, LM Studio serves one request at a
// time, and every other sweep queues behind it — so a model pass here is eight
// to ten hours of contention for a job whose uncertain cases Richard has
// already said to park. Anything no rule places goes to `00.0 — _Unsorted`
// with its reason recorded, which is a count somebody can work through rather
// than a guess nobody can audit.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a folder in the OLD scheme maps, by its whole relative path.
 *
 * Keyed on the whole path and compared case-insensitively after collapsing
 * whitespace, because 16 of the 233 folders on this drive carry a trailing
 * space and several carry a space before the slash
 * (`PQC Giovanni Campus /Utah Land Records `).
 *
 * ⚠ THE VALUES ARE SECTION KEYS OR WORKING-FOLDER NAMES, never labels. A
 * `null` means "leave it where it is" — used for the three working folders,
 * which already have their place in the new room.
 *
 * Measured against the live corpus 2026-10-29: these are the folder paths that
 * actually hold documents, with their counts, so nothing here is speculative.
 */
export const FOLDER_TO_SECTION: Record<string, string | null> = {
  // ── The old standard set and its Diligence lanes ──────────────────────────
  'diligence/environmental': '01.3', // 75
  'diligence/power & utilities': '01.5', // 53
  'diligence/rail & transportation': '01.4', // 109 — the template has no rail
  // slot; site-specific studies is the closest honest home, and Richard's 01.4
  // says "other site-specific studies as applicable" in as many words.
  'diligence/geotech & site reports': '01.4', // 41
  'diligence/permits & entitlements': '01.2', // 25
  'diligence/water & wastewater': '01.4', // 5
  'diligence/fiber & telecom': '01.7', // 4 — fiber route agreements are 01.7
  'land & title': '01.1', // 28
  financials: '00.4', // 20
  'reports & studies': '01.4', // 15
  'drawings & plans': '01.7', // 4
  'insurance & bonding': '01.8', // 2
  '_unsorted': UNSORTED_SECTION, // 57

  // ── The three working folders keep their place ────────────────────────────
  correspondence: null,
  meetings: null,
  'proposals & bids': null,

  // ── Folders the team made by hand (Richard: fold them in) ─────────────────
  'land legal': '01.1',
  'previous land offers': '02.2',
  'pre construction': '01.7',
  mida: '01.2', // Military Installation Development Authority — an entitlement
  'business plan myton 1': '00.4',
  'stockton infographics': '01.7',
  'dueschesne county rail corridor': '01.4', // the drive's own spelling
  'cp3 - site map layout': '01.7',
  'master proposal - land development': 'Proposals & Bids',
  'corporate /nda nc': '00.3',
  'pqc giovanni campus /utah land records /land tenure documents': '01.1',
  'pqc giovanni campus /utah land records /cadastral survey plats & field notes (after 1995)':
    '01.1',
  'pqc giovanni campus /land legal': '01.1',
  'pqc giovanni campus /pre construction': '01.7',
  'pqc giovanni campus /reports & studies': '01.4',
  'pqc giovanni campus /independent re brokers market analysis': '00.4',
  'pqc giovanni campus /_unsorted': UNSORTED_SECTION,

  // ── Found by the first full dry run, by reading the manifest ─────────────
  // Each of these held files that fell through to `_Unsorted` on a path whose
  // meaning is plain. They are leaf SEGMENT names now that the walk tries each
  // segment, so they serve wherever they appear rather than only at one depth.
  deeds: '01.1',
  'settlement agreements': '01.1',
  'parcel numbers': '01.1',
  'k1 form & taxes': '00.4',
}

/**
 * Filename tokens that place a document beyond reasonable doubt.
 *
 * ⚠ KEYED ON THE SECTION, WHICH IS THE WHOLE POINT. `classify.ts`'s rules name
 * their destination by a SUBSTRING OF THE FOLDER LABEL, and under these labels
 * that is unworkable: `title` is inside both `Site Control & Title` and
 * `Entitlements`, `permits` inside both `Zoning & Entitlements` and `Physical
 * Site Studies & Permits`, `insurance` inside `Site Control & Title` (title
 * insurance) and `Facility Operations & Insurance`, `power` inside `Utility
 * Power Commitment` and `On-Site / Behind-the-Meter Generation`. Every such
 * rule would resolve to two candidates, be refused as ambiguous, and fall
 * silently through — which is precisely what happened to every land and title
 * rule for the eighteen days after the Diligence lanes shipped.
 *
 * ⚠ ORDER IS LOAD-BEARING: first match wins, so the specific phrase comes
 * before the general one. `sectionHintCollisions()` asserts no token appears
 * under two sections.
 *
 * ⚠ SHORT TOKENS ARE PADDED. The haystack is the file name wrapped in spaces,
 * so a bare `psa` matches "Gypsa.pdf" and a bare `mou` matches "Amount.pdf".
 * Every token under five characters here needs that check run on it.
 */
export const SECTION_HINTS: Array<{ section: string; tokens: string[] }> = [
  // ── Specific-first, for the phrases two sections both have a claim on ─────
  // A LANDLORD estoppel is site control; a CUSTOMER estoppel is a lender right
  // (02.7). Both are "estoppel", so the longer phrase has to be reachable
  // BEFORE the shorter one, which first-match-wins only gives if it is listed
  // first. The collision test compares exact tokens and so cannot see this
  // kind of overlap — it is ordering, not duplication.
  { section: '01.1', tokens: ['landlord estoppel', 'tenant estoppel'] },

  // ── 02 next: a compute agreement is also a "contract" and a "report" ──────
  {
    section: '02.6',
    tokens: ['gpu', 'h100', 'h200', 'gb200', 'blackwell', 'server purchase', 'asset register'],
  },
  {
    section: '02.3',
    tokens: ['compute services agreement', ' csa ', 'master services agreement', ' msa ', 'order form'],
  },
  { section: '02.5', tokens: ['service level', ' sla ', 'service credit', 'invoice', 'billing schedule'] },
  { section: '02.4', tokens: ['acceptance certificate', 'commissioning result', 'service commencement'] },
  { section: '02.1', tokens: ['credit report', 'guarantor', 'letter of credit', 'financial statement'] },
  { section: '02.7', tokens: ['direct agreement', 'consent to assignment', 'estoppel', 'step-in'] },
  { section: '02.2', tokens: ['letter of intent', ' loi ', 'loi ', 'term sheet', 'capacity reservation', 'exclusivity'] },

  // ── 01.5 before the broader report rules, as in classify.ts ──────────────
  {
    section: '01.5',
    tokens: ['will serve', 'will-serve', 'load study', 'one-line', 'one line diagram', 'single line',
             'interconnection', 'nameplate', 'substation', 'switchyard', 'electric service agreement',
             'system impact', 'facilities study', 'tariff', 'energization'],
  },
  {
    section: '01.6',
    tokens: ['behind the meter', 'behind-the-meter', 'power purchase', ' ppa ', 'tolling',
             'fuel supply', 'turbine', 'genset', 'grid-parallel'],
  },
  {
    section: '01.3',
    tokens: ['phase i ', 'phase 1', 'phase ii', 'phase 2', 'wetland', 'npdes', 'rcra',
             'remediation', 'environmental', 'consent order', 'consent decree', 'no further action'],
  },
  {
    section: '01.2',
    tokens: ['zoning', 'rezone', 'subdivision', 'conditional use', 'special use', 'entitlement',
             'variance', 'development agreement', 'site plan approval'],
  },
  {
    section: '01.4',
    tokens: ['geotech', 'soils report', 'boring log', 'topographic', 'floodplain', 'stormwater',
             'drainage', 'cultural resource', 'noise study', 'permit register', 'grading permit'],
  },
  {
    section: '01.1',
    // ⚠ `assignment`, `ground lease` AND `facility lease` ARE NOT OPTIONAL HERE.
    // §12 records this exact gap in classify.ts: "`lease` and `assignment` were
    // ABSENT, and both are the central document class on a land/power
    // acquisition — Steelton arrives by ASSIGNMENT of an executed PSA". It was
    // missing here too, and the Riverdale dry run proved it by parking
    // `Assignment Agreement .doc` in `_Unsorted` — which is the argument for
    // reading a manifest rather than its summary line.
    //
    // ⚠ `amendment` and a BARE `lease` are deliberately absent and must stay
    // absent. Richard's 01.1 expects "Amendments, extensions, deposit receipts"
    // and his 02.3 expects "Amendments, side letters, exhibits" — the word
    // genuinely does not say which, and a bare `lease` is equally 02.6's
    // "Equipment financing or lease agreements". Those park in `00.0` with a
    // reason, which is the honest answer; guessing would put a compute
    // amendment on the land shelf.
    //
    // ⚠ `landlord estoppel` is here and plain `estoppel` is in 02.7, which is
    // why the specific-first block above exists: 02.7 is evaluated first, so
    // without it every landlord estoppel would file as a lender consent.
    tokens: ['alta', 'parcel schedule', 'legal description', 'easement', 'boundary survey',
             'quitclaim', 'quit claim', 'quick claim', 'warranty deed', 'grant deed', 'deed',
             'deeds', 'title commitment',
             'title report', 'title policy', 'purchase agreement', 'psa ', ' psa', 'ground lease',
             'facility lease', 'lease agreement', 'purchase option', 'option agreement',
             'assignment', 'escrow', 'deposit receipt', 'firpta', 'closing statement',
             'nondisturbance', 'non-disturbance',
             // ⚠ `transaction agreement` and `lease of` come from reading the
             // Steelton room, where the site arrives by transaction agreement
             // and the operative leases are named "Lease of Lot 4a". They are
             // document-TYPE phrases, not counterparty names, which is the
             // test for whether a rule generalises — §12: an exact-name map is
             // a map of one counterparty's habits.
             'transaction agreement', 'lease of'],
  },
  {
    section: '01.7',
    tokens: ['basis of design', 'drawing', 'plan set', 'site plan', 'floor plan', 'elevation',
             'blueprint', '.dwg', 'epc ', 'change order', 'switchgear', 'transformer',
             'fiber', 'carrier letter', 'dark fiber', 'pue', 'cooling', 'construction schedule'],
  },
  {
    section: '01.8',
    tokens: ['certificate of insurance', 'certificate of liability', ' coi ', 'bonding', 'surety',
             'performance bond', 'bond summary', 'wc claims', 'workers comp', 'loss run',
             'operations and maintenance', ' o&m '],
  },

  // ── 00 last: the broadest vocabulary, so a specific rule above wins ──────
  {
    section: '00.3',
    tokens: ['organization chart', 'org chart', 'operating agreement', 'articles of',
             'certificate of good standing', 'good standing', 'cap table', 'formation',
             'mnda', 'nda', 'resolution', 'signature authority',
             // Corporate housekeeping found in the Steelton room: a conversion
             // certificate and an amended-and-restated LLC agreement are the
             // entity record, not the deal.
             'certificate of conversion', 'cert of conversion', 'amended and restated',
             'amended & restated', 'certificate of formation', 'certificate of incorporation'],
  },
  {
    section: '00.4',
    tokens: ['pro forma', 'proforma', 'financial model', 'sources and uses', 'budget',
             'balance sheet', 'income statement', 'cash flow', 'debt service', 'equity commitment',
             'market analysis', 'feasibility', 'appraisal'],
  },
]

/** Lower-cased, whitespace-collapsed, for comparing a FOLDER PATH to a rule. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * A name as its WORDS, with every separator treated alike.
 *
 * ⚠ THIS IS THE FIX FOR THE BUG THAT MATTERED MOST, and only reading a manifest
 * found it. The rules matched substrings of a space-separated name, so every
 * token had to be padded (`' psa '`, `' nda '`) to stop it matching inside a
 * longer word — and real file names separate words with UNDERSCORES:
 * `Steelton_PSA_Buyer_Redline.docx` never matched `psa`, and
 * `Steelton_Purchase_Agreement_Draft_v1.docx` never matched `purchase
 * agreement`. Fifty-nine files in `Contracts & Legal` parked in `_Unsorted`
 * with the two most important documents on the biggest deal among them.
 *
 * Splitting on every non-alphanumeric run and comparing WHOLE WORDS fixes it
 * and retires the padding entirely — which is §12's own remedy: test whole
 * tokens rather than substrings. `Gypsa` is no longer `psa`, `Agenda` is no
 * longer `nda`, and `Coil` is no longer `coi`, for free and by construction
 * rather than by remembering to pad.
 */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/** Does `needle`'s word sequence appear contiguously in `haystack`? */
function containsWords(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

/**
 * ⚠ ASSERT NO TOKEN PLACES A DOCUMENT IN TWO SECTIONS.
 *
 * The mirror of `ambiguousHintRules()` in classify.ts, which exists because a
 * collision there is SILENT: the rule resolves to two candidates, is refused,
 * and the document falls through to whatever comes next with nothing reporting
 * it. Returns the offending tokens so a test can name them.
 */
export function sectionHintCollisions(): Array<{ token: string; sections: string[] }> {
  const where = new Map<string, Set<string>>()
  for (const rule of SECTION_HINTS) {
    for (const token of rule.tokens) {
      const key = words(token).join(' ')
      if (!where.has(key)) where.set(key, new Set())
      where.get(key)!.add(rule.section)
    }
  }
  return [...where.entries()]
    .filter(([, sections]) => sections.size > 1)
    .map(([token, sections]) => ({ token, sections: [...sections].sort() }))
}

/** What the fold decided for one file, and why — the manifest's own columns. */
export interface FoldDecision {
  /** A section key, a working-folder name, or null to leave the file alone. */
  target: string | null
  reason: string
}

/**
 * WHERE ONE FILE GOES WHEN THE OLD ROOM IS FOLDED INTO THE NEW ONE.
 *
 * `sourcePath` is the file's folder path relative to the record's room, exactly
 * as `listFolder` reports it — `''` for a file loose in the room root.
 *
 * Order of evidence, strongest first:
 *   1. ALREADY FILED. The path already names a section, so there is nothing to
 *      do — which is what makes a second run report no work (§12: pair a
 *      fill-not-overwrite pass with a script that calls it twice).
 *   2. THE FOLDER IT IS IN. A whole-path match in {@link FOLDER_TO_SECTION}.
 *      ⚠ A folder a human curated is stronger evidence than a file name and it
 *      classifies a whole subtree at once — measured 2026-10-08, when an
 *      exact-name folder map scored 24% on Steelton and 0–6% on Weirton, whose
 *      folders say the same things in different words. These keys are this
 *      drive's real folder names, so they are a map of THIS drive's habits and
 *      nothing more; a path not in the map falls through to the file name.
 *   3. THE FILE NAME. {@link SECTION_HINTS}, first match wins.
 *   4. `00.0 — _Unsorted`, with the reason recorded.
 */
export function foldDecision(fileName: string, sourcePath: string): FoldDecision {
  if (sectionOf(sourcePath)) {
    return { target: null, reason: 'already in a data-room section' }
  }

  /**
   * ⚠ THE WHOLE PATH, THEN EACH SEGMENT FROM THE DEEPEST UP.
   *
   * Keying only on the whole path missed every nested shelf, and nesting is the
   * normal case on this drive rather than the exception: `West Wendover` holds
   * an inner folder named after itself with the standard scheme inside it, and
   * Helper's documents sit under `PQC Giovanni Campus /Land Legal/Settlement
   * Agreements`. Thirty-nine files fell through to `_Unsorted` on paths whose
   * parent folder had a perfectly good rule.
   *
   * Deepest-first is the right order because a subfolder is more specific than
   * its parent; falling back UP the path is the inheritance a human means when
   * they put `Settlement Agreements` inside `Land Legal`.
   */
  const segments = sourcePath.split('/').map((s) => s.trim()).filter(Boolean)
  const candidates = [normalise(sourcePath), ...segments.map(normalise).reverse()]
  for (const candidate of candidates) {
    if (!(candidate in FOLDER_TO_SECTION)) continue
    const target = FOLDER_TO_SECTION[candidate]
    return target === null
      ? { target: null, reason: `working folder "${candidate}" — stays` }
      : { target, reason: `folder rule "${candidate}"` }
  }

  /**
   * ⚠ THE HINTS RUN OVER THE FOLDER NAME BEFORE THE FILE NAME.
   *
   * A folder a human named is stronger evidence than a file name a counterparty
   * chose — the same reasoning `classifyBySourceFolder` is built on, and it
   * classifies a whole subtree at once. `Stockton LOI` holds eleven files none
   * of which say "LOI" in their own names; the folder says it once, for all of
   * them.
   */
  for (const segment of [...segments].reverse()) {
    const hay = words(segment)
    for (const rule of SECTION_HINTS) {
      const hit = rule.tokens.find((t) => containsWords(hay, words(t)))
      if (hit) return { target: rule.section, reason: `folder name "${segment}" (${hit.trim()})` }
    }
  }

  const hay = words(fileName)
  for (const rule of SECTION_HINTS) {
    const hit = rule.tokens.find((t) => containsWords(hay, words(t)))
    if (hit) return { target: rule.section, reason: `file name "${hit.trim()}"` }
  }

  return {
    target: UNSORTED_SECTION,
    reason: sourcePath ? `no rule for folder "${sourcePath}"` : 'loose in the room root',
  }
}
