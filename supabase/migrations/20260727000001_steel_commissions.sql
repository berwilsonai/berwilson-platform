-- Steel commissions & margin tracking.
--   A deal is now composed of commissionable SERVICES (steel/materials,
--   engineering, frame assembly), each with a price (charged) and cost (our
--   cost / pass-through payout). Margin = price − cost. The salesperson earns
--   a % of each service's margin; the lead-source referrer earns a flat fee OR
--   a % of the deal's total margin. Every commission is markable paid/unpaid
--   so the dashboard shows owed vs paid.
--
-- Cost / margin / commission are CONFIDENTIAL — surfaced to admin/executive
-- only in the app (steel_sales users enter deals + prices, never see cost or
-- commission). This migration adds no DB-level role gating (app traffic uses
-- the service role; RLS is defense-in-depth per CLAUDE.md §8).

-- ============================================================
-- steel_deal_services — one row per commissionable service on a deal
-- ============================================================
create table if not exists steel_deal_services (
  id uuid default gen_random_uuid() primary key,
  deal_id uuid references steel_deals(id) on delete cascade not null,
  service_type text not null,                          -- materials | engineering | assembly
  price numeric(15,2),                                 -- charged to the customer
  cost numeric(15,2),                                  -- our cost / what we pay out (e.g. the engineer)
  commission_pct numeric(6,3),                         -- salesperson's % of THIS service's margin
  commission_paid boolean not null default false,
  commission_paid_date date,
  sort_order int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (deal_id, service_type)                       -- fixed sections: one row per service type
);

create index if not exists idx_steel_deal_services_deal on steel_deal_services(deal_id);

create trigger set_updated_at
  before update on steel_deal_services
  for each row execute function update_updated_at();

alter table steel_deal_services enable row level security;
create policy "steel_deal_services_select" on steel_deal_services for select using (auth.role() = 'authenticated');
create policy "steel_deal_services_insert" on steel_deal_services for insert with check (auth.role() = 'authenticated');
create policy "steel_deal_services_update" on steel_deal_services for update using (auth.role() = 'authenticated');
create policy "steel_deal_services_delete" on steel_deal_services for delete using (auth.role() = 'authenticated');

-- ============================================================
-- steel_deals — referral fee (paid to the lead-source referrer)
-- ============================================================
alter table steel_deals
  add column if not exists referral_fee_type text not null default 'none',   -- none | flat | percent (of total margin)
  add column if not exists referral_fee_value numeric(15,2),
  add column if not exists referral_fee_paid boolean not null default false,
  add column if not exists referral_fee_paid_date date;

comment on column steel_deals.referral_fee_type is 'none | flat | percent (of total deal margin). Paid to lead_source_id.';
comment on table steel_deal_services is 'Commissionable services on a steel deal (materials/engineering/assembly). price−cost=margin; salesperson earns commission_pct of margin. Cost/margin/commission are admin/executive-only in the app.';
