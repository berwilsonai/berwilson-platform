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

/** A leaf's path below the record folder — `01 — …/01.5 — …`, or just `00.0 — …`. */
export function sectionPath(section: DataRoomSection, template = DATA_CENTER_ROOM): string {
  if (!section.parent) return folderName(section)
  const parent = template.find((s) => s.key === section.parent)
  return parent ? `${folderName(parent)}/${folderName(section)}` : folderName(section)
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
 * EVERY FOLDER PATH A DATA-CENTER ROOM CONTAINS, in creation order.
 *
 * Parents first so `ensureFolder` never has to create one implicitly, then each
 * leaf, then its two status subfolders, then the working folders. 19 leaves × 3
 * = 57 plus 3 parents plus `00.0` and its two, plus 3 working folders.
 */
export function roomFolderPaths(template = DATA_CENTER_ROOM): string[] {
  const out: string[] = []
  for (const section of template) {
    if (!section.parent && section.key !== UNSORTED_SECTION) {
      out.push(folderName(section))
    }
  }
  for (const section of leafSections(template)) {
    const path = sectionPath(section, template)
    out.push(path)
    // `00.0 — _Unsorted` holds what nothing could place; a draft or a
    // superseded copy of an unplaced document is not a distinction worth three
    // folders nobody opens.
    if (section.key === UNSORTED_SECTION) continue
    out.push(`${path}/${DRAFTS_FOLDER}`, `${path}/${SUPERSEDED_FOLDER}`)
  }
  out.push(...WORKING_FOLDERS)
  return out
}
