-- Equity modeling tool tables
-- All prefixed with equity_ to avoid collision with berwilson-platform tables

CREATE TABLE IF NOT EXISTS equity_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Scenario',
  description TEXT DEFAULT '',

  -- Module data as JSONB
  valuation_inputs JSONB DEFAULT '{}',
  cap_table_inputs JSONB DEFAULT '{}',
  nancy_deal_inputs JSONB DEFAULT '{}',
  originator_fee_inputs JSONB DEFAULT '{}',
  exit_scenario_inputs JSONB DEFAULT '{}',

  is_baseline BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Share links with expiring tokens
CREATE TABLE IF NOT EXISTS equity_share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES equity_scenarios(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  modules TEXT[] DEFAULT '{}',
  accessed_count INTEGER DEFAULT 0,
  max_accesses INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION equity_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_scenarios_updated ON equity_scenarios;
CREATE TRIGGER equity_scenarios_updated
  BEFORE UPDATE ON equity_scenarios
  FOR EACH ROW EXECUTE FUNCTION equity_update_timestamp();

-- RLS
ALTER TABLE equity_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE equity_share_links ENABLE ROW LEVEL SECURITY;

-- Both partners can view all scenarios
CREATE POLICY "Users can view all scenarios"
  ON equity_scenarios FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Users can insert/update/delete their own scenarios
CREATE POLICY "Users can insert own scenarios"
  ON equity_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own scenarios"
  ON equity_scenarios FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own scenarios"
  ON equity_scenarios FOR DELETE
  USING (auth.uid() = user_id);

-- Share links
CREATE POLICY "Users can manage own share links"
  ON equity_share_links FOR ALL
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Public access to share links by token (for unauthenticated share views)
CREATE POLICY "Anyone can read valid share links"
  ON equity_share_links FOR SELECT
  USING (TRUE);

-- Indexes
CREATE INDEX idx_equity_scenarios_user ON equity_scenarios(user_id);
CREATE INDEX idx_equity_share_links_token ON equity_share_links(token);
