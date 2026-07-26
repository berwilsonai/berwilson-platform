-- Prefab Steel CRM — deal pipeline for the steel plant's sales team
--   steel_deals      — one row per deal: quote → engineering → order_placed →
--                      delivered → paid (lost = off-pipeline). Lead source,
--                      salesperson, square feet, price/SF, contract value.
--   steel_deal_notes — the running deal log (mirrors investor_notes; author is
--                      stamped server-side from the signed-in viewer).
-- Stage/lead-source are plain text + app constants (src/lib/utils/steel.ts),
-- no Postgres enums, so the vocab can evolve without a migration.
--
-- Also widens the team_members role check for the new 'steel_sales' role
-- (sales users see only /steel — see src/lib/auth/permissions.ts).

-- ============================================================
-- steel_deals — the deal record
-- ============================================================
create table if not exists steel_deals (
  id uuid default gen_random_uuid() primary key,
  name text not null,                                  -- deal name, e.g. "Riverton warehouse shell"
  customer text,                                       -- who's buying (free text; link to parties later if needed)
  building_type text,                                  -- warehouse, hangar, ag building, retail shell…
  lead_source text not null default 'other',           -- marketing | team_member | architect | engineer | existing_customer | website | trade_show | other
  lead_source_detail text,                             -- the specific person/firm behind the lead
  salesperson_id uuid references team_members(id) on delete set null,

  stage text not null default 'quote',                 -- quote | engineering | order_placed | delivered | paid | lost
  square_feet numeric(12,0),
  price_per_sqft numeric(10,2),
  value numeric(15,2),                                 -- total contract $ (form auto-computes sqft × $/SF, editable)

  expected_delivery_date date,
  next_step text,                                      -- the single next action
  next_step_date date,
  description text,                                    -- scope, specs, history

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_steel_deals_stage on steel_deals(stage);
create index if not exists idx_steel_deals_salesperson on steel_deals(salesperson_id);
create index if not exists idx_steel_deals_updated on steel_deals(updated_at desc);

-- ============================================================
-- steel_deal_notes — deal log
-- ============================================================
create table if not exists steel_deal_notes (
  id uuid default gen_random_uuid() primary key,
  deal_id uuid references steel_deals(id) on delete cascade not null,
  body text not null,
  author text,
  created_at timestamptz default now()
);

create index if not exists idx_steel_deal_notes_deal on steel_deal_notes(deal_id);

-- ============================================================
-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql)
-- NOTE: deliberately NOT attaching log_activity() — same reasoning as
-- investors/opportunities (it dereferences new.project_id unconditionally).
-- ============================================================
create trigger set_updated_at
  before update on steel_deals
  for each row execute function update_updated_at();

-- ============================================================
-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8)
-- ============================================================
alter table steel_deals enable row level security;
create policy "steel_deals_select" on steel_deals for select using (auth.role() = 'authenticated');
create policy "steel_deals_insert" on steel_deals for insert with check (auth.role() = 'authenticated');
create policy "steel_deals_update" on steel_deals for update using (auth.role() = 'authenticated');
create policy "steel_deals_delete" on steel_deals for delete using (auth.role() = 'authenticated');

alter table steel_deal_notes enable row level security;
create policy "steel_deal_notes_select" on steel_deal_notes for select using (auth.role() = 'authenticated');
create policy "steel_deal_notes_insert" on steel_deal_notes for insert with check (auth.role() = 'authenticated');
create policy "steel_deal_notes_update" on steel_deal_notes for update using (auth.role() = 'authenticated');
create policy "steel_deal_notes_delete" on steel_deal_notes for delete using (auth.role() = 'authenticated');

-- ============================================================
-- steel_sales role — widen the team_members role check
-- ============================================================
alter table team_members drop constraint if exists team_members_role_check;
alter table team_members
  add constraint team_members_role_check
  check (role in ('admin', 'executive', 'project_manager', 'member', 'steel_sales'));

comment on column team_members.role is 'Access preset: admin | executive | project_manager | member | steel_sales. See src/lib/auth/permissions.ts.';
