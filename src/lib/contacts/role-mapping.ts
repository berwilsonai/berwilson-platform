/**
 * Mapping the free-text player roles already in the database onto the registry.
 *
 * ⚠ MEASURED AGAINST THE REAL CORPUS, NOT CHOSEN (§12). On 2026-10-21
 * `project_players` held 104 rows carrying 79 DISTINCT role strings, almost all
 * of them a sentence about one moment rather than a category. These rules were
 * written by reading all 79 and are ordered MOST SPECIFIC FIRST, because the
 * ordering is the whole design:
 *
 *   "Owner of the 5,000-acre Myton site"  must reach land_owner, not owner
 *   "Seller / Portfolio Owner"            must reach seller,     not owner
 *   "Academic partner / Endorser org"     must reach academic_partner before endorser
 *   "GridEdge Introducer/Liaison"         must reach referral_source before agency_staff
 *   "Participant Royalty Owner"           must reach NOTHING — `^owner$` is anchored
 *
 * AMBIGUITY MEANS NO MATCH (§12). Eleven of the 79 deliberately map to null —
 * "Transaction lead (Zenthium) / data room owner", "Investment Target Company",
 * "Commercial underwriting and risk analysis for development sites",
 * "Coordinating customized letters of support from VIPs". A wrong category is
 * worse than an empty one: the prose stays on `role` either way, and an
 * uncategorised row is visible as uncategorised, where a mis-categorised one
 * answers for the person until somebody notices.
 *
 * `\bfundraiser\b` is anchored for the same reason — it must catch "GridEdge
 * Managing Director/Fundraiser" and NOT "Fundraising, treasury ops, and rail
 * sector strategy", which describes a job nobody can name from the string.
 */

export interface RoleRule {
  pattern: RegExp
  key: string
}

export const ROLE_RULES: RoleRule[] = [
  // Most specific first. A rule may only be moved UP past a rule it cannot
  // collide with; the test asserts the real corpus still maps the same way.
  { pattern: /academic|universit|research institute/i, key: 'academic_partner' },
  { pattern: /\bendorser\b/i, key: 'endorser' },
  { pattern: /ber wilson|internal (reviewer|sender|coordinator|lead)|\binternal\b.*\b(reviewer|sender|ceo|lead)\b/i, key: 'internal' },
  { pattern: /ip holder|patent (inventor|assignee)|licensor/i, key: 'ip_holder' },
  { pattern: /technology provider|fuel cell|battery tech|cooling partner|emp\/rfi|rfi protection/i, key: 'technology_provider' },
  { pattern: /legal counsel|attorney|law firm/i, key: 'legal_counsel' },
  { pattern: /title compan|escrow/i, key: 'title_company' },
  { pattern: /\bbroker\b|real estate firm/i, key: 'broker' },
  { pattern: /land owner|landowner|land option provider|owner of the .*\bsite\b/i, key: 'land_owner' },
  { pattern: /\bseller\b|offering (party|contact)/i, key: 'seller' },
  { pattern: /\bbuyer\b/i, key: 'buyer' },
  { pattern: /\bguarantor\b/i, key: 'guarantor' },
  { pattern: /\badvisor\b|advisory firm/i, key: 'advisor' },
  { pattern: /anchor tenant|offtaker|off-?taker/i, key: 'offtaker' },
  { pattern: /\butility\b/i, key: 'utility' },
  { pattern: /green energy|energy partner|power provider|\bppa\b/i, key: 'power_provider' },
  { pattern: /\bclient\b/i, key: 'client' },
  { pattern: /co-?developer|development partner/i, key: 'co_developer' },
  { pattern: /\bdeveloper\b|project proponent/i, key: 'developer' },
  { pattern: /capital backer|equity investor|\binvestor\b/i, key: 'equity_investor' },
  { pattern: /\bfundraiser\b|placement agent|investment bank|public finance/i, key: 'investment_bank' },
  { pattern: /introducer/i, key: 'referral_source' },
  { pattern: /county official|government official|procurement official|government_agency|\bagency\b|liaison|regulator/i, key: 'agency_staff' },
  { pattern: /prefab steel|steel manufacturer|fabricat/i, key: 'steel_fabricator' },
  { pattern: /teaming partner|\bjv\b|joint venture/i, key: 'jv_partner' },
  { pattern: /architect/i, key: 'architect' },
  { pattern: /structural engineer/i, key: 'structural_engineer' },
  { pattern: /civil engineer/i, key: 'civil_engineer' },
  { pattern: /geotech/i, key: 'geotechnical_engineer' },
  { pattern: /general contractor|\bgc\b/i, key: 'general_contractor' },
  { pattern: /construction manager|\bcm\b/i, key: 'construction_manager' },
  { pattern: /subcontractor/i, key: 'subcontractor' },
  { pattern: /superintendent/i, key: 'superintendent' },
  { pattern: /surveyor/i, key: 'surveyor' },
  { pattern: /contracting officer rep|\bcor\b/i, key: 'contracting_officer_rep' },
  { pattern: /contracting officer|\bco\b(?!m|n|-)/i, key: 'contracting_officer' },
  { pattern: /elected|senator|congress|mayor|commissioner/i, key: 'elected_official' },
  { pattern: /environmental consultant/i, key: 'environmental_consultant' },
  { pattern: /permitting/i, key: 'permitting_consultant' },
  { pattern: /property manager/i, key: 'property_manager' },
  { pattern: /\bdbe\b/i, key: 'dbe_consultant' },
  { pattern: /\blender\b|\bbank\b(?!ing)/i, key: 'lender' },
  // Anchored: only the bare word. "Participant Royalty Owner" and "data room
  // owner" are not the deal's owner, and matching them would be worse than
  // leaving both uncategorised.
  { pattern: /^owner$/i, key: 'owner' },
  { pattern: /^owner'?s rep/i, key: 'owners_rep' },
]

/** The registry key this prose means, or null when nothing is certain enough. */
export function mapRoleText(text: string | null | undefined): string | null {
  if (!text) return null
  const t = text.trim()
  if (!t) return null
  for (const { pattern, key } of ROLE_RULES) {
    if (pattern.test(t)) return key
  }
  return null
}

/**
 * Roles that describe WHAT SOMEBODY IS, and therefore travel off one deal onto
 * the contact; versus roles that describe a POSITION IN ONE TRANSACTION, which
 * do not.
 *
 * §12: filling a blank and overwriting a value are different acts, and which
 * is safe turns on whether the source DESCRIBES the field's subject or only
 * MENTIONS it. A law firm is a law firm on every deal; the seller on Steelton
 * is not "a seller" in general, and writing that onto their contact record
 * would be the directory asserting something nobody said.
 */
export const DEAL_SCOPED_ROLES = new Set([
  'owner',
  'owners_rep',
  'seller',
  'buyer',
  'guarantor',
  'land_owner',
  'offtaker',
  'client',
])

export function travelsToContact(key: string): boolean {
  return !DEAL_SCOPED_ROLES.has(key)
}
