-- Steel CRM → align with the founding-phase commission plan.
--
-- The comp plan pays reps differently than the generic "% of each line's
-- margin" the CRM shipped with:
--   Commission = commissionable margin × RATE, where RATE is set by the deal's
--   total square footage (Sales 15/12/10, Marketing 5/4/3 for
--   <20k / 20k-100k / 100k+ SF) and applies to the whole deal.
--   • Sales AND Marketing are two separate commissionable roles on one deal.
--   • Installation (frame assembly) is billed separately and earns NO margin
--     commission — the salesperson gets a flat $250-$500 per install job.
--   • Per-rep volume accelerator: once a rep collects $1M of gross profit in a
--     calendar year, their rate steps up 1 point for the rest of that year.
--
-- This migration only ADDS columns + widens one check constraint — it is
-- non-destructive (safe to land before the code that uses it). The per-line
-- commission_pct / commission_paid columns on steel_deal_services become
-- vestigial (rate is now deal-level); they're left in place, unused.

-- ── steel_deals: marketer, rate overrides, install fee, deal-level payout state ──

alter table steel_deals
  -- Second commissionable role: the marketer earns the marketing rate on the
  -- same deal's commissionable margin. One person can be both salesperson and
  -- marketer (earns both).
  add column if not exists marketer_id uuid references team_members(id) on delete set null,
  -- Rate is normally derived from the SF tier; a non-null override wins (for a
  -- federal addendum, a held founding rate, or a one-off). Stored as a whole
  -- number of points (e.g. 15 = 15%).
  add column if not exists sales_rate_override numeric,
  add column if not exists marketing_rate_override numeric,
  -- Installation / frame-assembly flat fee to the salesperson ($250-$500 per
  -- install job). Separate from margin commission (installation revenue is not
  -- commissioned per the plan).
  add column if not exists install_fee numeric,
  add column if not exists install_fee_paid boolean not null default false,
  add column if not exists install_fee_paid_date date,
  -- Commissions are tracked/paid at the deal level now (one sales amount, one
  -- marketing amount), not per service line.
  add column if not exists sales_commission_paid boolean not null default false,
  add column if not exists sales_commission_paid_date date,
  add column if not exists marketing_commission_paid boolean not null default false,
  add column if not exists marketing_commission_paid_date date,
  -- When the deal's cash was collected (deal reached the Paid stage). Powers
  -- the per-rep, per-calendar-year volume accelerator. Set by the stage control
  -- when a deal moves to Paid.
  add column if not exists collected_date date;

create index if not exists idx_steel_deals_marketer on steel_deals(marketer_id);

comment on column steel_deals.marketer_id is 'Team member credited with the marketing commission on this deal (5/4/3% of commissionable margin by SF tier). May equal salesperson_id.';
comment on column steel_deals.sales_rate_override is 'Optional whole-point override of the SF-tier sales rate (e.g. 15). Null = use the tier rate.';
comment on column steel_deals.marketing_rate_override is 'Optional whole-point override of the SF-tier marketing rate. Null = use the tier rate.';
comment on column steel_deals.install_fee is 'Flat installation/frame-assembly fee to the salesperson ($250-$500 per install job). Not margin-commissioned.';
comment on column steel_deals.collected_date is 'Date the deal''s cash was collected (moved to Paid). Drives the per-rep annual $1M-profit volume accelerator.';

-- ── documents.steel_deal_id: per-deal files (architect plans, engineering quotes) ──
--
-- A deal's files = documents where steel_deal_id = X, stored under
-- steel-deals/<id>/…. ON DELETE CASCADE: a steel-deal attachment is scoped
-- only by steel_deal_id, so SET NULL would leave a scopeless row that violates
-- documents_scope_check (mirrors the meetings pattern). The steel documents API
-- also sweeps the storage objects on delete (a DB cascade can't reach storage).

alter table documents add column if not exists steel_deal_id uuid references steel_deals(id) on delete cascade;
create index if not exists idx_documents_steel_deal on documents(steel_deal_id);

alter table documents drop constraint if exists documents_scope_check;
alter table documents add constraint documents_scope_check check (
  project_id is not null or entity_id is not null or is_company or is_reference or meeting_id is not null or steel_deal_id is not null
);
