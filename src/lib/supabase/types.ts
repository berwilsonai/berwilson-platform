// Re-exports the generated Database type plus helper aliases.
// Run `npm run gen-types` to regenerate after schema changes.

export type { Database, Json } from '@/types/database'
import type { Database } from '@/types/database'

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

// ---------------------------------------------------------------------------
// Portfolio hierarchy table aliases
// ---------------------------------------------------------------------------

export type Brand = Tables<'brands'>
export type Corridor = Tables<'corridors'>
export type Site = Tables<'sites'>
export type Component = Tables<'components'>
export type RailBranch = Tables<'rail_branches'>
export type RevenueShareAgreement = Tables<'revenue_share_agreements'>
export type SubEngagement = Tables<'sub_engagements'>
export type FundingSource = Tables<'funding_sources'>
export type StakeholderRelationship = Tables<'stakeholder_relationships'>
export type StakeholderInteraction = Tables<'stakeholder_interactions'>
export type TradeSecret = Tables<'trade_secrets'>
export type TsExposureItem = Tables<'ts_exposure_items'>
export type DocumentDistribution = Tables<'document_distributions'>
export type SiteDependency = Tables<'site_dependencies'>

// ---------------------------------------------------------------------------
// Portfolio enum aliases
// ---------------------------------------------------------------------------

export type BwRole = Enums<'bw_role'>
export type SiteStatus = Enums<'site_status'>
export type ComponentType = Enums<'component_type'>
export type ComponentStatus = Enums<'component_status'>
export type EngagementState = Enums<'engagement_state'>
export type FundingCategory = Enums<'funding_category'>
export type FundingStatusEnum = Enums<'funding_status'>
export type StakeholderTemperature = Enums<'stakeholder_temperature'>
export type RailType = Enums<'rail_type'>
