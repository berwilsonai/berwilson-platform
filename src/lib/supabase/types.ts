// Re-exports the generated Database type plus helper aliases.
// Run `npm run gen-types` to regenerate after schema changes.

export type { Database, Json } from '@/types/database'
import type { Database, Json } from '@/types/database'

// ---------------------------------------------------------------------------
// Standard Supabase helper generics
// ---------------------------------------------------------------------------

/** The Row shape for a given table — what you get back from SELECT */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

/** The Insert shape for a given table — what you pass to INSERT */
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

/** The Update shape for a given table — what you pass to UPDATE */
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

/**
 * The type a jsonb value must have to be WRITTEN.
 *
 * ⚠ `Json` INCLUDES `null`, AND A NOT NULL jsonb COLUMN DOES NOT. The old
 * hand-maintained types gave every jsonb column plain `Json`, so an
 * `as unknown as Json` cast typechecked against a NOT NULL column — and a
 * null value was then a NOT NULL violation at runtime, a 500 the reader reads
 * as a server fault. The regenerated types (2026-10-08) tell the two apart:
 * a nullable jsonb column stays `Json | null`, a NOT NULL one becomes
 * `NonNullable<Json>`. Twelve write sites were relying on the looser type.
 *
 * Use this for EVERY jsonb insert or update, nullable column or not — it
 * satisfies both, so there is one idiom rather than two to choose between.
 */
export type JsonIn = NonNullable<Json>

/**
 * A generated Row with some of its columns replaced by a narrower type.
 *
 * The modules behind the post-cutover tables refine a few jsonb and array
 * columns into real shapes — `project_parcels.geometry` is a GeoJSON Polygon,
 * `leads.attachments` is a LeadAttachment[]. Those refinements are worth more
 * than `Json`, so they survive; EVERY OTHER COLUMN COMES FROM THE SCHEMA.
 *
 * ⚠ THIS EXISTS BECAUSE HAND-WRITING THE WHOLE ROW DRIFTS. Measured when
 * gen-types was repaired (2026-10-08): across 30 hand-maintained row
 * interfaces, 40 live columns were absent from their type, one field named a
 * column the table does not have, and six columns were typed NOT NULL against
 * a nullable schema. Nothing reported any of it, because the client those
 * interfaces stood in for was untyped by design.
 */
export type Refine<T, R extends Partial<Record<keyof T, unknown>>> = Omit<T, keyof R> & R

/**
 * The column names in a PostgREST select list, as a union.
 *
 * For the reads that project rather than taking `*`: the type is then derived
 * from the same string the query sends, so the two cannot disagree and adding
 * a column to the select list adds it to the type. A name that is not a column
 * becomes a type error at the `Pick`.
 */
export type SelectedCols<S extends string> =
  S extends `${infer H},${infer T}` ? Trim<H> | SelectedCols<T> : Trim<S>
type Trim<S extends string> = S extends ` ${infer R}` ? Trim<R> : S extends `${infer R} ` ? Trim<R> : S

/**
 * Fails to compile unless `T` is `never`, naming the offending member.
 *
 * For the one row interface still written by hand: `LeadRow` is 130 lines of
 * which most is documentation attached to individual fields, and that
 * documentation is worth more than the lines an alias would save. So it stays
 * an interface, and two assertions make it unable to drift — one that every
 * column of the table is a field, one that it invents no field the table has
 * no column for. Either way the error names the column.
 */
export type AssertNever<T extends never> = T

/** A specific enum type by name */
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// ---------------------------------------------------------------------------
// Table row aliases — import these instead of Tables<'projects'> everywhere
// ---------------------------------------------------------------------------

export type Project = Tables<'projects'>
export type Party = Tables<'parties'>
export type Entity = Tables<'entities'>
export type ProjectPlayer = Tables<'project_players'>
export type Milestone = Tables<'milestones'>
export type Document = Tables<'documents'>
export type Update = Tables<'updates'>
export type Chunk = Tables<'chunks'>
export type DdItem = Tables<'dd_items'>
export type FinancingStructure = Tables<'financing_structures'>
export type ComplianceItem = Tables<'compliance_items'>
export type EntityProject = Tables<'entity_projects'>
export type ActivityLog = Tables<'activity_log'>
export type ReviewQueueRow = Tables<'review_queue'>
export type AiQuery = Tables<'ai_queries'>
export type ResearchArtifact = Tables<'research_artifacts'>
export type Media = Tables<'media'>
export type CompanyProfile = Tables<'company_profile'>
export type Certification = Tables<'certifications'>
export type Task = Tables<'tasks'>
export type TaskNote = Tables<'task_notes'>
export type TeamMember = Tables<'team_members'>
export type Objective = Tables<'objectives'>
export type Opportunity = Tables<'opportunities'>
export type OpportunityDocument = Tables<'opportunity_documents'>
export type OpportunityNote = Tables<'opportunity_notes'>
export type Investor = Tables<'investors'>
export type Investment = Tables<'investments'>
export type InvestorNote = Tables<'investor_notes'>
export type InvestorRequirement = Tables<'investor_requirements'>
export type Raise = Tables<'raises'>
export type OrgNode = Tables<'org_nodes'>
export type OrgPerson = Tables<'org_people'>
export type SteelDeal = Tables<'steel_deals'>
export type SteelDealNote = Tables<'steel_deal_notes'>
export type SteelDealService = Tables<'steel_deal_services'>
export type SteelQuote = Tables<'steel_quotes'>
export type SteelMarketingSpend = Tables<'steel_marketing_spend'>
export type Meeting = Tables<'meetings'>
export type DinoRevenue = Tables<'dino_revenue'>
export type DinoPayment = Tables<'dino_payments'>
export type DinoNote = Tables<'dino_notes'>
export type GoogleTaskList = Tables<'google_task_lists'>
export type TaskGoogleLink = Tables<'task_google_links'>
export type DevNote = Tables<'dev_notes'>

// ---------------------------------------------------------------------------
// Enum aliases — import these instead of Enums<'project_sector'> everywhere
// ---------------------------------------------------------------------------

export type ProjectSector = Enums<'project_sector'>
export type ProjectStatus = Enums<'project_status'>
export type ProjectStage = Enums<'project_stage'>
export type UpdateSource = Enums<'update_source'>
export type ReviewState = Enums<'review_state'>
export type DdSeverity = Enums<'dd_severity'>
export type ComplianceStatus = Enums<'compliance_status'>
export type EntityType = Enums<'entity_type'>
