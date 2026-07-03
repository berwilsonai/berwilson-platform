-- ============================================================================
-- SIMPLIFICATION PASS 2 (2026-07-03)
-- Drops everything removed from the app in the same-day code cleanup:
--   1. Equity & Valuation module (equity_scenarios, equity_share_links)
--   2. Portfolio site-hierarchy module (brands → corridors → sites →
--      components + funding/stakeholder/rail/revenue-share satellites)
--      and its columns on documents / compliance_items / activity_log / chunks
--   3. Speculative features: background checks (parties columns),
--      vendor scorecards & reviews (federal_scorecards, entity_reviews)
--   4. Dead scraper-era tables: processed_emails, graph_subscriptions,
--      trade_secrets, ts_exposure_items, document_distributions,
--      updates.outlook_web_link
-- All code reading these was deleted first, so this migration can land any
-- time after that deploy. Everything is IF EXISTS — safe to re-run.
-- ============================================================================

-- ─── 1. Equity & Valuation ──────────────────────────────────────────────────

DROP TABLE IF EXISTS equity_share_links CASCADE;
DROP TABLE IF EXISTS equity_scenarios CASCADE;

-- ─── 2. Portfolio hierarchy ─────────────────────────────────────────────────

-- Site-scoped chunks would violate chunks_source_check once site_id is gone;
-- they're portfolio enrichment embeddings nothing can reach anymore.
DELETE FROM chunks WHERE site_id IS NOT NULL;
ALTER TABLE chunks DROP COLUMN IF EXISTS site_id;

-- documents: drop site/component scope and restore the check without them
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_scope_check;
ALTER TABLE documents DROP COLUMN IF EXISTS site_id;
ALTER TABLE documents DROP COLUMN IF EXISTS component_id;
ALTER TABLE documents ADD CONSTRAINT documents_scope_check
  CHECK (
    project_id IS NOT NULL
    OR entity_id IS NOT NULL
    OR is_company
  );

ALTER TABLE compliance_items DROP COLUMN IF EXISTS site_id;
ALTER TABLE compliance_items DROP COLUMN IF EXISTS component_id;
ALTER TABLE activity_log DROP COLUMN IF EXISTS site_id;

-- Children before parents (CASCADE also covers any stragglers)
DROP TABLE IF EXISTS site_dependencies CASCADE;
DROP TABLE IF EXISTS stakeholder_interactions CASCADE;
DROP TABLE IF EXISTS stakeholder_relationships CASCADE;
DROP TABLE IF EXISTS funding_sources CASCADE;
DROP TABLE IF EXISTS sub_engagements CASCADE;
DROP TABLE IF EXISTS revenue_share_agreements CASCADE;
DROP TABLE IF EXISTS rail_branches CASCADE;
DROP TABLE IF EXISTS components CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
DROP TABLE IF EXISTS corridors CASCADE;
DROP TABLE IF EXISTS brands CASCADE;
DROP TABLE IF EXISTS dream_quotes CASCADE;

DROP TYPE IF EXISTS bw_role;
DROP TYPE IF EXISTS site_status;
DROP TYPE IF EXISTS component_type;
DROP TYPE IF EXISTS component_status;
DROP TYPE IF EXISTS engagement_state;
DROP TYPE IF EXISTS funding_category;
DROP TYPE IF EXISTS funding_status;
DROP TYPE IF EXISTS stakeholder_temperature;
DROP TYPE IF EXISTS rail_type;

-- ─── 3. Speculative features ────────────────────────────────────────────────

-- Background checks (never had a real provider)
ALTER TABLE parties DROP COLUMN IF EXISTS background_check_completed;
ALTER TABLE parties DROP COLUMN IF EXISTS background_check_date;
ALTER TABLE parties DROP COLUMN IF EXISTS background_check_reference;
ALTER TABLE parties DROP COLUMN IF EXISTS background_check_provider;
ALTER TABLE parties DROP COLUMN IF EXISTS background_check_notes;

-- Vendor scorecards & reviews
DROP TABLE IF EXISTS federal_scorecards CASCADE;
DROP TABLE IF EXISTS entity_reviews CASCADE;

-- ─── 4. Dead scraper-era leftovers ──────────────────────────────────────────

DROP TABLE IF EXISTS processed_emails CASCADE;
DROP TABLE IF EXISTS graph_subscriptions CASCADE;
DROP TABLE IF EXISTS trade_secrets CASCADE;
DROP TABLE IF EXISTS ts_exposure_items CASCADE;
DROP TABLE IF EXISTS document_distributions CASCADE;
ALTER TABLE updates DROP COLUMN IF EXISTS outlook_web_link;
