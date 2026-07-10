-- Investors & capital raise tracking
-- Two linked concepts (see CLAUDE.md):
--   investors    — the relationship: who they are, how warm, where in the courtship.
--                  Identity can link to `parties` (the directory) but the name is
--                  denormalized so the record stands alone.
--   investments  — a specific commitment: investor × target (the parent company OR
--                  a project/SPV), with per-deal stage, instrument, amounts
--                  (indicated / committed / funded) and equity / profit-share terms.
--   investor_notes — the running contact log (mirrors opportunity_notes).
--
-- SPVs are `entities` rows (they're legal entities) — investments reference one via
-- spv_entity_id once formed; the raise is trackable before any SPV legally exists.
-- Stage/type/interest are plain text + app constants (src/lib/utils/investors.ts),
-- no Postgres enums, so the vocab can evolve without a migration.

-- ============================================================
-- investors — the relationship record
-- ============================================================
create table if not exists investors (
  id uuid default gen_random_uuid() primary key,
  name text not null,                                  -- person or firm; denormalized from parties
  party_id uuid references parties(id) on delete set null,  -- directory link (contact info lives there)
  investor_type text not null default 'individual',   -- individual | family_office | private_equity | venture_capital | institutional | bank_lender | tribal | strategic | other
  stage text not null default 'identified',           -- identified | contacted | in_conversation | materials_sent | diligence | soft_committed | committed | funded | passed | dormant
  interest_level text default 'warm',                 -- hot | warm | cool | cold

  check_size_min numeric(15,2),                       -- typical check range
  check_size_max numeric(15,2),
  preferred_structures text[] default '{}',           -- instrument vocab: common_equity | preferred_equity | convertible_note | debt | mezzanine | profit_share | revenue_share | other
  sector_interests text[] default '{}',               -- reuses project sectors

  source text,                                        -- how they came to us (referral, banker, event, outbound…)
  referred_by text,
  relationship_owner_id uuid references team_members(id) on delete set null,

  next_step text,                                     -- the single next action
  next_step_date date,
  last_contact_date date,
  notes text,                                         -- background / preferences / history

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_investors_stage on investors(stage);
create index if not exists idx_investors_type on investors(investor_type);
create index if not exists idx_investors_party on investors(party_id);
create index if not exists idx_investors_updated on investors(updated_at desc);

-- ============================================================
-- investments — investor × target commitment
-- ============================================================
create table if not exists investments (
  id uuid default gen_random_uuid() primary key,
  investor_id uuid references investors(id) on delete cascade not null,

  target_kind text not null default 'company',        -- company (parent Ber Wilson raise) | project
  project_id uuid references projects(id) on delete cascade,      -- required when target_kind = 'project'
  spv_entity_id uuid references entities(id) on delete set null,  -- the SPV once legally formed

  stage text not null default 'discussing',           -- discussing | soft_circled | term_sheet | committed | docs | funded | passed
  instrument text,                                    -- common_equity | preferred_equity | convertible_note | debt | mezzanine | profit_share | revenue_share | other

  amount_indicated numeric(15,2),                     -- soft-circled / verbal interest
  amount_committed numeric(15,2),                     -- signed commitment
  amount_funded numeric(15,2),                        -- wired
  equity_pct numeric(5,2),                            -- % of the target/SPV
  profit_share_pct numeric(5,2),
  preferred_return_pct numeric(5,2),
  terms_notes text,                                   -- waterfall, side letters, board seats… (the legal docs govern)

  first_discussed_date date,
  committed_date date,
  funded_date date,
  target_close_date date,
  next_step text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint investments_target_check check (
    (target_kind = 'project' and project_id is not null)
    or (target_kind = 'company' and project_id is null)
  )
);

create index if not exists idx_investments_investor on investments(investor_id);
create index if not exists idx_investments_project on investments(project_id);
create index if not exists idx_investments_stage on investments(stage);

-- ============================================================
-- investor_notes — contact log
-- ============================================================
create table if not exists investor_notes (
  id uuid default gen_random_uuid() primary key,
  investor_id uuid references investors(id) on delete cascade not null,
  body text not null,
  author text,
  created_at timestamptz default now()
);

create index if not exists idx_investor_notes_investor on investor_notes(investor_id);

-- ============================================================
-- updated_at triggers (reuses update_updated_at from 00006_triggers.sql)
-- NOTE: deliberately NOT attaching log_activity() — same reasoning as
-- opportunities (it dereferences new.project_id unconditionally).
-- ============================================================
create trigger set_updated_at
  before update on investors
  for each row execute function update_updated_at();

create trigger set_updated_at
  before update on investments
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
-- ============================================================
alter table investors enable row level security;
create policy "investors_select" on investors for select using (auth.role() = 'authenticated');
create policy "investors_insert" on investors for insert with check (auth.role() = 'authenticated');
create policy "investors_update" on investors for update using (auth.role() = 'authenticated');
create policy "investors_delete" on investors for delete using (auth.role() = 'authenticated');

alter table investments enable row level security;
create policy "investments_select" on investments for select using (auth.role() = 'authenticated');
create policy "investments_insert" on investments for insert with check (auth.role() = 'authenticated');
create policy "investments_update" on investments for update using (auth.role() = 'authenticated');
create policy "investments_delete" on investments for delete using (auth.role() = 'authenticated');

alter table investor_notes enable row level security;
create policy "investor_notes_select" on investor_notes for select using (auth.role() = 'authenticated');
create policy "investor_notes_insert" on investor_notes for insert with check (auth.role() = 'authenticated');
create policy "investor_notes_update" on investor_notes for update using (auth.role() = 'authenticated');
create policy "investor_notes_delete" on investor_notes for delete using (auth.role() = 'authenticated');
