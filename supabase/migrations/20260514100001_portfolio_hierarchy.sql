-- ============================================================================
-- PORTFOLIO HIERARCHY: Brand → Corridor → Site → Component
-- Adds the Ber Wilson 33-site portfolio data model alongside existing projects.
-- ============================================================================

-- ─── New Enums ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE bw_role AS ENUM (
    'master_developer_gc',
    'developer_only',
    'gc_only',
    'cm_under_sna',
    'program_architect',
    'joint_venture'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE site_status AS ENUM (
    'active',
    'planning',
    'evaluation',
    'lead_site'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE component_type AS ENUM (
    'quantum_data_center',
    'power_nexus',
    'hospital',
    'workforce_housing',
    'light_rail',
    'freight_rail',
    'civic_center',
    'police_station',
    'fire_station',
    'airport',
    'public_safety_complex',
    'urban_forestry',
    'cooling_infrastructure',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE component_status AS ENUM (
    'conceptual',
    'planning',
    'pre_development',
    'design',
    'procurement',
    'construction',
    'commissioning',
    'operating'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE engagement_state AS ENUM (
    'solicited',
    'bidding',
    'awarded',
    'mobilized',
    'active',
    'demobilized',
    'complete'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE funding_category AS ENUM (
    'federal_grant',
    'state_grant',
    'local',
    'private_equity',
    'debt',
    'ppa',
    'tax_credit',
    'revenue_share'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE funding_status AS ENUM (
    'target',
    'outreach',
    'application_submitted',
    'awarded',
    'closed',
    'drawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE stakeholder_temperature AS ENUM (
    'champion',
    'supportive',
    'neutral',
    'concerned',
    'opposed',
    'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE rail_type AS ENUM (
    'passenger',
    'freight',
    'stracnet_freight',
    'passenger_freight'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── New Tables ─────────────────────────────────────────────────────────────

-- 1. Brands (top-level program brands)
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Corridors (geographic groupings under a brand)
CREATE TABLE IF NOT EXISTS corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  region text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Sites (the 33 master-plan sites — PRIMARY portfolio entity)
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_id uuid REFERENCES corridors(id) ON DELETE SET NULL,
  site_number integer UNIQUE,
  name text NOT NULL,
  city text,
  county text,
  state text,
  acreage numeric(10,2),
  military_nexus text,
  military_installations text[] DEFAULT '{}',
  status site_status NOT NULL DEFAULT 'planning',
  bw_role bw_role,
  is_lead_site boolean NOT NULL DEFAULT false,
  anchor_partner text,
  stracnet_status text,
  procore_link text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Components (deliverables within a site)
CREATE TABLE IF NOT EXISTS components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type component_type NOT NULL,
  name text NOT NULL,
  specs jsonb DEFAULT '{}',
  capital_low numeric(15,2),
  capital_mid numeric(15,2),
  capital_high numeric(15,2),
  contingency_pct numeric(5,2) DEFAULT 30.00,
  phase text,
  start_date date,
  end_date date,
  duration_months integer,
  bw_role bw_role,
  prime_contractor text,
  status component_status NOT NULL DEFAULT 'conceptual',
  procore_link text,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Rail Branches (span multiple sites, belong to corridor)
CREATE TABLE IF NOT EXISTS rail_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_id uuid REFERENCES corridors(id) ON DELETE CASCADE,
  designation text,
  brand_name text,
  route_description text,
  rail_type rail_type,
  military_connections text,
  status text DEFAULT 'planning',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Revenue Share Agreements (1:1 with site, typically 60/40)
CREATE TABLE IF NOT EXISTS revenue_share_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  city_pct numeric(5,2),
  bw_pct numeric(5,2),
  revenue_base text,
  cadence text,
  governance_notes text,
  sunset_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Subcontractor Engagements (pre-Procore sub tracking)
CREATE TABLE IF NOT EXISTS sub_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  company text NOT NULL,
  contact_name text,
  contact_email text,
  party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  trade_tags text[] DEFAULT '{}',
  scope_description text,
  value numeric(15,2),
  engagement_state engagement_state NOT NULL DEFAULT 'solicited',
  bonding_limit numeric(15,2),
  insurance_verified boolean DEFAULT false,
  prevailing_wage boolean DEFAULT false,
  cba_local_hire boolean DEFAULT false,
  apprenticeship_pct numeric(5,2),
  mwbe_dbe_status text,
  federal_prequals text[] DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Funding Sources (capital stack — attach to site OR component)
CREATE TABLE IF NOT EXISTS funding_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES sites(id) ON DELETE CASCADE,
  component_id uuid REFERENCES components(id) ON DELETE CASCADE,
  source_name text NOT NULL,
  category funding_category NOT NULL,
  agency text,
  amount numeric(15,2),
  percent_of_stack numeric(5,2),
  status funding_status NOT NULL DEFAULT 'target',
  contact_party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  conditions text,
  drawdown_notes text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funding_sources_parent_check CHECK (site_id IS NOT NULL OR component_id IS NOT NULL)
);

-- 9. Stakeholder Relationships (party ↔ site junction with temperature)
CREATE TABLE IF NOT EXISTS stakeholder_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  role text,
  temperature stakeholder_temperature NOT NULL DEFAULT 'unknown',
  next_scheduled timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(site_id, party_id)
);

-- 10. Stakeholder Interactions (log of engagements)
CREATE TABLE IF NOT EXISTS stakeholder_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES stakeholder_relationships(id) ON DELETE CASCADE,
  interaction_date timestamptz NOT NULL DEFAULT now(),
  medium text,
  summary text NOT NULL,
  follow_up text,
  logged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 11. Trade Secrets reference table (TS-001 through TS-022)
CREATE TABLE IF NOT EXISTS trade_secrets (
  code text PRIMARY KEY,
  title text NOT NULL,
  description text,
  classification text DEFAULT 'confidential'
);

-- 12. TS Exposure Items (which trade secrets a document touches)
CREATE TABLE IF NOT EXISTS ts_exposure_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ts_code text NOT NULL REFERENCES trade_secrets(code) ON DELETE CASCADE,
  exposure_level text DEFAULT 'referenced',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. Document Distributions (who received which document when)
CREATE TABLE IF NOT EXISTS document_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  recipient_party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  distributed_at timestamptz NOT NULL DEFAULT now(),
  version text,
  appendix_f_locked boolean DEFAULT false,
  method text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 14. Site Dependencies (cross-site graph edges)
CREATE TABLE IF NOT EXISTS site_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  target_site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  dependency_type text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_site_id, target_site_id, dependency_type)
);

-- ─── Alter Existing Tables ──────────────────────────────────────────────────

-- Documents: add site_id and component_id, expand scope check
ALTER TABLE documents ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES components(id) ON DELETE CASCADE;
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_scope_check;
ALTER TABLE documents ADD CONSTRAINT documents_scope_check
  CHECK (project_id IS NOT NULL OR entity_id IS NOT NULL OR site_id IS NOT NULL OR component_id IS NOT NULL);

-- Compliance Items: add site_id and component_id
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE CASCADE;
ALTER TABLE compliance_items ADD COLUMN IF NOT EXISTS component_id uuid REFERENCES components(id) ON DELETE CASCADE;

-- Activity Log: add site_id for portfolio activity
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;

-- ─── Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_corridors_brand ON corridors(brand_id);
CREATE INDEX IF NOT EXISTS idx_sites_corridor ON sites(corridor_id);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);
CREATE INDEX IF NOT EXISTS idx_sites_state ON sites(state);
CREATE INDEX IF NOT EXISTS idx_components_site ON components(site_id);
CREATE INDEX IF NOT EXISTS idx_components_type ON components(type);
CREATE INDEX IF NOT EXISTS idx_components_status ON components(status);
CREATE INDEX IF NOT EXISTS idx_components_project ON components(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rail_branches_corridor ON rail_branches(corridor_id);
CREATE INDEX IF NOT EXISTS idx_sub_engagements_component ON sub_engagements(component_id);
CREATE INDEX IF NOT EXISTS idx_sub_engagements_party ON sub_engagements(party_id) WHERE party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funding_sources_site ON funding_sources(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funding_sources_component ON funding_sources(component_id) WHERE component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stakeholder_rels_site ON stakeholder_relationships(site_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_rels_party ON stakeholder_relationships(party_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_interactions_rel ON stakeholder_interactions(relationship_id);
CREATE INDEX IF NOT EXISTS idx_ts_exposure_document ON ts_exposure_items(document_id);
CREATE INDEX IF NOT EXISTS idx_ts_exposure_code ON ts_exposure_items(ts_code);
CREATE INDEX IF NOT EXISTS idx_doc_distributions_document ON document_distributions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_distributions_party ON document_distributions(recipient_party_id);
CREATE INDEX IF NOT EXISTS idx_documents_site ON documents(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_component ON documents(component_id) WHERE component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_items_site ON compliance_items(site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_items_component ON compliance_items(component_id) WHERE component_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_log_site ON activity_log(site_id) WHERE site_id IS NOT NULL;

-- ─── Triggers: updated_at ───────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER set_brands_updated_at
  BEFORE UPDATE ON brands FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_corridors_updated_at
  BEFORE UPDATE ON corridors FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_sites_updated_at
  BEFORE UPDATE ON sites FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_components_updated_at
  BEFORE UPDATE ON components FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_revenue_share_updated_at
  BEFORE UPDATE ON revenue_share_agreements FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_sub_engagements_updated_at
  BEFORE UPDATE ON sub_engagements FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_funding_sources_updated_at
  BEFORE UPDATE ON funding_sources FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER set_stakeholder_rels_updated_at
  BEFORE UPDATE ON stakeholder_relationships FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ─── RLS Policies ───────────────────────────────────────────────────────────

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE components ENABLE ROW LEVEL SECURITY;
ALTER TABLE rail_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_share_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholder_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE stakeholder_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ts_exposure_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_dependencies ENABLE ROW LEVEL SECURITY;

-- Authenticated users get full CRUD on all portfolio tables (matches existing pattern)
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'brands', 'corridors', 'sites', 'components', 'rail_branches',
    'revenue_share_agreements', 'sub_engagements', 'funding_sources',
    'stakeholder_relationships', 'stakeholder_interactions',
    'trade_secrets', 'ts_exposure_items', 'document_distributions',
    'site_dependencies'
  ]) LOOP
    EXECUTE format('CREATE POLICY "auth_select_%s" ON %I FOR SELECT TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY "auth_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY "auth_update_%s" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY "auth_delete_%s" ON %I FOR DELETE TO authenticated USING (true)', tbl, tbl);
  END LOOP;
END $$;
