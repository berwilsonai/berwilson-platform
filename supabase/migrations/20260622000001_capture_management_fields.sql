-- Capture / bid-management fields on projects
-- Adds the concepts a competitive pursuit pipeline needs but the schema lacked:
--   * bid_due_date     — the proposal/RFP submission deadline (the date that matters most pre-award)
--   * win_probability  — P-win 0-100, drives weighted (expected) pipeline value
--   * bid_decision     — go/no-go gate: undecided | pursue | no_bid
--   * capture_lead     — who owns this pursuit (free text; two-exec team)
--   * incumbent        — current incumbent on the contract, if any
--   * competitors      — known competitors bidding (jsonb array of names)
--   * win_strategy     — discriminators / capture strategy notes

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS bid_due_date date,
  ADD COLUMN IF NOT EXISTS win_probability integer
    CHECK (win_probability IS NULL OR (win_probability >= 0 AND win_probability <= 100)),
  ADD COLUMN IF NOT EXISTS bid_decision text NOT NULL DEFAULT 'undecided'
    CHECK (bid_decision IN ('undecided', 'pursue', 'no_bid')),
  ADD COLUMN IF NOT EXISTS capture_lead text,
  ADD COLUMN IF NOT EXISTS incumbent text,
  ADD COLUMN IF NOT EXISTS competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS win_strategy text;

-- Pursuits closing soon are queried by deadline across the portfolio
CREATE INDEX IF NOT EXISTS projects_bid_due_date_idx
  ON projects(bid_due_date)
  WHERE bid_due_date IS NOT NULL;
