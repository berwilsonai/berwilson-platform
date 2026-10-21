-- Seed the contact-role registry.
--
-- Starts from the 33 values that have sat unused in
-- src/lib/utils/constants.ts (PROJECT_PLAYER_ROLES) since the directory was
-- built, and adds the categories the LIVE CORPUS demanded — measured, not
-- invented. Every addition below is backed by role strings already in
-- project_players on 2026-10-21:
--
--   internal            8 rows ("Ber Wilson CEO, Principal", "Internal reviewer" ×3,
--                       "Internal sender/CEO", "Ber Wilson Operations Lead", …)
--   endorser           21 rows ("Target endorser" ×8, "Endorser organization" ×5,
--                       "Government endorser organization", "Academic partner /
--                       Endorser organization", six "Target endorser / …")
--   advisor             5 rows ("Strategic Financial Advisor", "Technical Advisor",
--                       "Advisor / Government Relations", "Co-recipient / Advisor",
--                       "GridEdge Advisory Firm")
--   seller / land_owner 7 rows ("Seller (parent)", "Seller / Portfolio Owner",
--                       "Land Owner / Seller", "Land option provider for 476-acre
--                       site", "Seller entity — holds record title", …)
--   ip_holder           4 rows ("IP Holder/Licensor", "EMP Shielding Patent
--                       Inventor" ×2, "Original EMP Patent Assignee")
--   technology_provider 5 rows ("Fuel Cell Technology Provider", "Battery
--                       Technology Provider", "Modular power and cooling partner",
--                       "EMP/RFI protection partner", "Green Energy Partner")
--   client              4 rows ("Client / Project owner", "Client Principal",
--                       "Client/Partner City", "Client / Project sponsor …")
--   offtaker            1 row  ("Proposed anchor tenant and scientific partner")
--   utility             1 row  ("Initial contact / Case Utility representative")
--   academic_partner    1 row  ("Academic partner / Endorser organization")
--   investment_bank     D.A. Davidson public finance, in the rolodex since 10-15
--   elected_official    "Target endorser / Wyoming Republican Candidate"
--   agency_staff        "Former DHS Procurement Official", the state-agency tag
--   buyer / guarantor   "Alternative Buyer", "Guarantor (Alternative Deal)"
--
-- ⚠ A SEEDED ROLE NOBODY USES IS CLUTTER IN A PICKER, which is why the /contacts
-- filter derives its chips from the roles actually HELD (§12 — "the ROWS are
-- the registry: derive the filter from the values present, and keep a curated
-- list only for what a human picks from"). The full list is offered only where
-- somebody is choosing.
--
-- sort_order is group-major in tens, so a new role can be slotted between two
-- existing ones without renumbering.

begin;

insert into contact_roles (key, label, role_group, extraction_hint, sort_order, system) values
  -- ─── Ber Wilson ────────────────────────────────────────────────────────────
  ('internal', 'Ber Wilson Team', 'Ber Wilson',
   'Somebody who works for Ber Wilson. Use for our own executives and staff, never for a counterparty.', 10, true),

  -- ─── Ownership & Development ───────────────────────────────────────────────
  ('owner', 'Owner', 'Ownership & Development',
   'The party that owns the asset or project being developed.', 100, false),
  ('owners_rep', 'Owner''s Rep', 'Ownership & Development',
   'Represents the owner''s interests to the delivery team; not the owner themselves.', 110, false),
  ('developer', 'Developer', 'Ownership & Development',
   'Leads the development of the project — entitlement, capital, delivery.', 120, false),
  ('co_developer', 'Co-Developer', 'Ownership & Development',
   'Shares development responsibility with us or another developer.', 130, false),
  ('jv_partner', 'JV Partner', 'Ownership & Development',
   'Party to a joint venture on a specific deal or portfolio.', 140, false),
  ('pe_partner', 'PE Partner', 'Ownership & Development',
   'Private equity sponsor or fund partner.', 150, false),
  ('equity_investor', 'Equity Investor', 'Ownership & Development',
   'Puts equity into the deal or the company. Use Lender instead for debt.', 160, false),
  ('land_owner', 'Land Owner', 'Ownership & Development',
   'Owns the land, whether or not it is under contract. Use Seller once they are transacting.', 170, false),

  -- ─── Construction ──────────────────────────────────────────────────────────
  ('general_contractor', 'General Contractor (GC)', 'Construction',
   'Holds the prime construction contract.', 200, false),
  ('construction_manager', 'Construction Manager (CM)', 'Construction',
   'Manages construction for the owner, typically at risk or as an agent.', 210, false),
  ('subcontractor', 'Subcontractor', 'Construction',
   'Performs a trade scope under a general contractor.', 220, false),
  ('project_manager', 'Project Manager', 'Construction',
   'Runs the project day to day for one of the parties.', 230, false),
  ('superintendent', 'Superintendent', 'Construction',
   'Runs the field work on site.', 240, false),
  ('steel_fabricator', 'Prefab / Steel Fabricator', 'Construction',
   'Fabricates prefabricated or structural steel. Ber Wilson''s own manufacturing line of business.', 250, false),

  -- ─── Design & Engineering ──────────────────────────────────────────────────
  ('architect', 'Architect', 'Design & Engineering',
   'Architect of record or design architect.', 300, false),
  ('structural_engineer', 'Structural Engineer', 'Design & Engineering', null, 310, false),
  ('civil_engineer', 'Civil Engineer', 'Design & Engineering', null, 320, false),
  ('mep_engineer', 'MEP Engineer', 'Design & Engineering',
   'Mechanical, electrical and plumbing engineering.', 330, false),
  ('geotechnical_engineer', 'Geotechnical Engineer', 'Design & Engineering', null, 340, false),
  ('surveyor', 'Surveyor', 'Design & Engineering',
   'Land or boundary surveyor.', 350, false),

  -- ─── Finance & Legal ───────────────────────────────────────────────────────
  ('lender', 'Lender', 'Finance & Legal',
   'Provides debt. Use the senior or mezzanine role where the position is known.', 400, false),
  ('senior_lender', 'Senior Lender', 'Finance & Legal',
   'Holds the senior secured position.', 410, false),
  ('mezzanine_lender', 'Mezzanine Lender', 'Finance & Legal',
   'Holds subordinated or mezzanine debt.', 420, false),
  ('investment_bank', 'Investment Bank / Placement Agent', 'Finance & Legal',
   'Raises or places capital for a fee — public finance, placement, M&A advisory.', 430, false),
  ('legal_counsel', 'Legal Counsel', 'Finance & Legal',
   'Any attorney or law firm, ours or a counterparty''s.', 440, false),
  ('title_company', 'Title Company', 'Finance & Legal',
   'Title insurance and escrow.', 450, false),
  ('accountant', 'Accountant / CPA', 'Finance & Legal', null, 460, false),
  ('insurance_broker', 'Insurance Broker', 'Finance & Legal',
   'Places insurance or surety. Use for bonding agents too.', 470, false),

  -- ─── Government ────────────────────────────────────────────────────────────
  ('contracting_officer', 'Contracting Officer (CO)', 'Government',
   'The federal official with authority to bind the government on a contract.', 500, false),
  ('contracting_officer_rep', 'Contracting Officer Rep (COR)', 'Government', null, 510, false),
  ('government_pm', 'Government PM', 'Government',
   'Agency-side project manager.', 520, false),
  ('elected_official', 'Elected Official', 'Government',
   'A mayor, legislator, commissioner or candidate.', 530, false),
  ('agency_staff', 'Agency / Regulator Staff', 'Government',
   'Civil servant or regulator who is not a contracting officer — permitting, workforce, economic development.', 540, false),

  -- ─── Energy & Technology ───────────────────────────────────────────────────
  ('utility', 'Utility', 'Energy & Technology',
   'The regulated utility serving the site.', 600, false),
  ('power_provider', 'Power / Energy Provider', 'Energy & Technology',
   'Supplies generation, behind-the-meter power or an energy structure.', 610, false),
  ('technology_provider', 'Technology Provider', 'Energy & Technology',
   'Supplies a technology into the project — fuel cells, batteries, cooling, shielding.', 620, false),
  ('offtaker', 'Offtaker / Anchor Tenant', 'Energy & Technology',
   'Takes the capacity or leases the facility once built.', 630, false),
  ('academic_partner', 'Academic / Research Partner', 'Energy & Technology',
   'A university, national lab or research institute.', 640, false),

  -- ─── Transaction & Commercial ──────────────────────────────────────────────
  ('client', 'Client', 'Transaction & Commercial',
   'Pays us for work — the customer on a construction, steel or services engagement.', 700, false),
  ('broker', 'Broker', 'Transaction & Commercial',
   'Brings or intermediates a deal for a fee. Covers real estate and finders.', 710, false),
  ('seller', 'Seller', 'Transaction & Commercial',
   'Selling an asset, a site or a company into a transaction we are party to.', 720, false),
  ('buyer', 'Buyer', 'Transaction & Commercial',
   'Buying an asset or company from us or alongside us.', 730, false),
  ('guarantor', 'Guarantor', 'Transaction & Commercial',
   'Guarantees an obligation under the deal.', 740, false),
  ('ip_holder', 'IP Holder / Licensor', 'Transaction & Commercial',
   'Owns or licenses patents or technology into the deal.', 750, false),

  -- ─── Advisory & Relationship ───────────────────────────────────────────────
  -- The half that had no home. These describe what somebody is TO US rather
  -- than to a deal, which is why they belong on the contact and not only on a
  -- project; they are offered in both places all the same.
  ('advisor', 'Advisor', 'Advisory & Relationship',
   'Counsels the executive team. Not engaged on one deal — somebody whose judgement we seek across the business.', 800, false),
  ('endorser', 'Endorser', 'Advisory & Relationship',
   'Has given, or is being asked for, a letter of support or public endorsement.', 810, false),
  ('referral_source', 'Referral Source', 'Advisory & Relationship',
   'Sends us business or makes introductions, without a fee arrangement.', 820, false),

  -- ─── Consultants & Other ───────────────────────────────────────────────────
  ('environmental_consultant', 'Environmental Consultant', 'Consultants & Other', null, 900, false),
  ('permitting_consultant', 'Permitting Consultant', 'Consultants & Other', null, 910, false),
  ('property_manager', 'Property Manager', 'Consultants & Other', null, 920, false),
  ('dbe_consultant', 'DBE Consultant', 'Consultants & Other',
   'Disadvantaged business enterprise compliance and certification.', 930, false),
  ('vendor', 'Vendor / Supplier', 'Consultants & Other',
   'Supplies goods or services to the business rather than to one project.', 940, false)
on conflict (key) do nothing;

commit;
