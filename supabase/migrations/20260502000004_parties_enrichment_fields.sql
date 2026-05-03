-- Add enrichment tracking fields to parties table
-- These support the "Enrich Profile" feature (Graph API + Gemini/Perplexity pipeline)

ALTER TABLE public.parties
  ADD COLUMN IF NOT EXISTS graph_enriched_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS perplexity_enriched_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS government_contract_history TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_notes         JSONB,
  ADD COLUMN IF NOT EXISTS enrichment_conflicts     JSONB;
