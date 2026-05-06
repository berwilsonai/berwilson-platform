-- Migration: Add vendor profile fields to entities and create entity_reviews table
-- Purpose: Enable rich vendor/partner profiles with scoring, specialties, and AI enrichment

-- =============================================================================
-- 1. Add vendor profile columns to entities table
-- =============================================================================

ALTER TABLE entities ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS specialties text[] DEFAULT '{}';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS quality_score numeric(3,1) CHECK (quality_score IS NULL OR (quality_score >= 1 AND quality_score <= 5));
ALTER TABLE entities ADD COLUMN IF NOT EXISTS confidence_score numeric(3,1) CHECK (confidence_score IS NULL OR (confidence_score >= 1 AND confidence_score <= 5));
ALTER TABLE entities ADD COLUMN IF NOT EXISTS headquarters text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS primary_contact_id uuid REFERENCES parties(id) ON DELETE SET NULL;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS enrichment_data jsonb;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

-- =============================================================================
-- 2. Create entity_reviews table for per-project performance tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS entity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  rating numeric(3,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  on_time boolean,
  on_budget boolean,
  would_rehire boolean,
  notes text,
  reviewed_by text,
  reviewed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_reviews_entity ON entity_reviews(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_reviews_project ON entity_reviews(project_id);

-- =============================================================================
-- 3. RLS policies for entity_reviews
-- =============================================================================

ALTER TABLE entity_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entity_reviews_select" ON entity_reviews FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "entity_reviews_insert" ON entity_reviews FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "entity_reviews_update" ON entity_reviews FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "entity_reviews_delete" ON entity_reviews FOR DELETE USING (auth.role() = 'authenticated');
