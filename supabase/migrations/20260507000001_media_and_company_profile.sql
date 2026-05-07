-- 20260507000001_media_and_company_profile.sql
-- 1. media table — photos for projects, entities, contacts, and company profile
-- 2. company_profile table — singleton row for Ber Wilson identity
-- 3. certifications table — structured cert records linked to company profile
-- 4. media storage bucket (public, images only)

-- ─── 1. Media table ─────────────────────────────────────────────────────────

CREATE TABLE media (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Scope: exactly one of these must be set
  project_id       uuid REFERENCES projects(id) ON DELETE CASCADE,
  entity_id        uuid REFERENCES entities(id) ON DELETE CASCADE,
  party_id         uuid REFERENCES parties(id) ON DELETE CASCADE,
  is_company       boolean NOT NULL DEFAULT false,
  -- File
  storage_path     text NOT NULL,
  file_name        text NOT NULL,
  file_size_bytes  bigint,
  mime_type        text NOT NULL,
  -- Display
  caption          text,
  is_primary       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  -- Audit
  uploaded_by      uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Ensure exactly one scope is set
  CONSTRAINT media_one_scope CHECK (
    (project_id IS NOT NULL)::int +
    (entity_id IS NOT NULL)::int +
    (party_id IS NOT NULL)::int +
    (is_company)::int = 1
  )
);

CREATE INDEX idx_media_project ON media(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_media_entity  ON media(entity_id)  WHERE entity_id IS NOT NULL;
CREATE INDEX idx_media_party   ON media(party_id)   WHERE party_id IS NOT NULL;
CREATE INDEX idx_media_company ON media(is_company) WHERE is_company = true;
-- Only one primary photo per scope
CREATE UNIQUE INDEX idx_media_primary_project ON media(project_id) WHERE is_primary = true AND project_id IS NOT NULL;
CREATE UNIQUE INDEX idx_media_primary_entity  ON media(entity_id)  WHERE is_primary = true AND entity_id IS NOT NULL;
CREATE UNIQUE INDEX idx_media_primary_party   ON media(party_id)   WHERE is_primary = true AND party_id IS NOT NULL;
CREATE UNIQUE INDEX idx_media_primary_company ON media(is_company) WHERE is_primary = true AND is_company = true;

COMMENT ON TABLE media IS 'Photo gallery for projects, entities, contacts, and the Ber Wilson company profile. Max 25 photos per entity enforced at API level.';

-- RLS
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "media_select" ON media FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "media_insert" ON media FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "media_update" ON media FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "media_delete" ON media FOR DELETE USING (auth.role() = 'authenticated');

-- ─── 2. Company profile table (singleton) ───────────────────────────────────

CREATE TABLE company_profile (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity
  legal_name        text NOT NULL DEFAULT 'Ber Wilson Corporation',
  dba_name          text,
  founded_year      integer,
  hq_address        text,
  website           text,
  phone             text,
  email             text,
  -- Narrative (AI uses these for RFP matching and due diligence responses)
  about             text,
  capabilities      text,
  -- Classifications
  naics_codes       text[] NOT NULL DEFAULT '{}',
  sic_codes         text[] NOT NULL DEFAULT '{}',
  -- Diversity / small business status
  dbe_certified     boolean NOT NULL DEFAULT false,
  mbe_certified     boolean NOT NULL DEFAULT false,
  wbe_certified     boolean NOT NULL DEFAULT false,
  sbe_certified     boolean NOT NULL DEFAULT false,
  -- Bonding & insurance
  bonding_capacity  numeric,
  aggregate_bonding numeric,
  bonding_company   text,
  -- Logo (stored in media bucket, is_company = true, is_primary = true)
  logo_url          text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_profile IS 'Singleton row for Ber Wilson company identity, capabilities, and bonding info. Used by AI for RFP qualification checks.';
COMMENT ON COLUMN company_profile.about IS 'Narrative description of Ber Wilson — used as AI context for due diligence and proposal responses.';
COMMENT ON COLUMN company_profile.capabilities IS 'Trade capabilities and service offerings — AI cross-references against RFP requirements.';

-- RLS
ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_profile_select" ON company_profile FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "company_profile_insert" ON company_profile FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "company_profile_update" ON company_profile FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "company_profile_delete" ON company_profile FOR DELETE USING (auth.role() = 'authenticated');

-- Seed the singleton row
INSERT INTO company_profile (legal_name)
VALUES ('Ber Wilson Corporation')
ON CONFLICT DO NOTHING;

-- ─── 3. Certifications table ─────────────────────────────────────────────────

CREATE TABLE certifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  issuing_body     text,
  cert_number      text,
  issued_date      date,
  expiration_date  date,
  is_active        boolean NOT NULL DEFAULT true,
  -- Points to a record in the documents table (cert scan PDF, processed by AI)
  document_id      uuid REFERENCES documents(id) ON DELETE SET NULL,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_certifications_active     ON certifications(is_active);
CREATE INDEX idx_certifications_expiration ON certifications(expiration_date) WHERE expiration_date IS NOT NULL;

COMMENT ON TABLE certifications IS 'Ber Wilson certifications, licenses, and credentials. Scanned documents stored in the documents bucket and linked via document_id for AI extraction.';
COMMENT ON COLUMN certifications.document_id IS 'FK to documents table — the scanned cert PDF. AI can extract and reason over this document.';

-- RLS
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "certifications_select" ON certifications FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "certifications_insert" ON certifications FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "certifications_update" ON certifications FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "certifications_delete" ON certifications FOR DELETE USING (auth.role() = 'authenticated');

-- Auto-update updated_at on certifications
CREATE OR REPLACE FUNCTION update_certifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER certifications_updated_at
  BEFORE UPDATE ON certifications
  FOR EACH ROW EXECUTE FUNCTION update_certifications_updated_at();

-- ─── 4. Media storage bucket ─────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  10485760,  -- 10 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS for media bucket
CREATE POLICY "media_bucket_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

CREATE POLICY "media_bucket_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media' AND auth.role() = 'authenticated');

CREATE POLICY "media_bucket_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated');

CREATE POLICY "media_bucket_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'media' AND auth.role() = 'authenticated');
