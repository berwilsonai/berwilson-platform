-- Add background check tracking fields to parties table
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS background_check_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS background_check_date date,
  ADD COLUMN IF NOT EXISTS background_check_reference text,
  ADD COLUMN IF NOT EXISTS background_check_provider text,
  ADD COLUMN IF NOT EXISTS background_check_notes text;
