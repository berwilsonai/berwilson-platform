-- Steel CRM → marketing intelligence layer (GTM brief: ICP, spend/ROI, analytics).
--
--   • ICP fields on the deal — the buyer segment and buying trigger the GTM brief
--     asks reps to define, so the pipeline data can validate/kill the ICP.
--   • steel_marketing_spend — a lightweight spend ledger (channel × month), the
--     basis for CAC / ROAS against the $3k/month media budget. Channel aligns
--     with the deal lead_source vocabulary so spend joins to deals-by-source.
--
-- Non-destructive: ADD columns + one new table.

alter table steel_deals
  add column if not exists icp_segment text,
  add column if not exists buying_trigger text;

comment on column steel_deals.icp_segment is 'ICP buyer segment (e.g. Developer, General Contractor, Owner-Builder, Ag/Farm, Municipal). Free text; drives marketing analytics.';
comment on column steel_deals.buying_trigger is 'What triggered the purchase (e.g. New construction, Expansion, Replacement, Bid requirement). Free text.';

create index if not exists idx_steel_deals_icp_segment on steel_deals(icp_segment);

-- ── Marketing spend ledger ──
create table if not exists steel_marketing_spend (
  id uuid default gen_random_uuid() primary key,
  channel text not null,             -- aligns with steel_deals.lead_source vocabulary
  amount numeric not null default 0,
  spend_month date not null,         -- first-of-month convention
  description text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_steel_marketing_spend_month on steel_marketing_spend(spend_month desc);
create index if not exists idx_steel_marketing_spend_channel on steel_marketing_spend(channel);

comment on table steel_marketing_spend is 'Steel marketing spend ledger (channel × month). Basis for CAC/ROAS vs the media budget.';

-- updated_at trigger (reuses update_updated_at from 00006_triggers.sql)
drop trigger if exists set_updated_at on steel_marketing_spend;
create trigger set_updated_at
  before update on steel_marketing_spend
  for each row execute function update_updated_at();

-- RLS — authenticated full access (app traffic uses the service role; the real
-- boundary is the middleware + in-route steel guards). Mirrors steel_deals.
alter table steel_marketing_spend enable row level security;
create policy "steel_marketing_spend_select" on steel_marketing_spend for select using (auth.role() = 'authenticated');
create policy "steel_marketing_spend_insert" on steel_marketing_spend for insert with check (auth.role() = 'authenticated');
create policy "steel_marketing_spend_update" on steel_marketing_spend for update using (auth.role() = 'authenticated');
create policy "steel_marketing_spend_delete" on steel_marketing_spend for delete using (auth.role() = 'authenticated');
