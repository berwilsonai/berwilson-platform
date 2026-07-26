-- Lead source can now name a specific PERSON who referred the deal (a payable
-- referrer), not just a free-text channel. `lead_source` stays the category
-- label (Trade Show, Referral, Website…, self-maintaining); the new
-- `lead_source_id` links the referrer to a real team_member so we can later
-- attribute commissions and report "deals referred by X". Nullable — channels
-- like Trade Show have no person to pay.
alter table steel_deals
  add column if not exists lead_source_id uuid references team_members(id) on delete set null;

create index if not exists idx_steel_deals_lead_source_id on steel_deals(lead_source_id);

comment on column steel_deals.lead_source_id is 'Optional referrer (the person who brought the deal) → team_members.id. Null for channel-only sources. Payable alongside salesperson_id when commissions land.';
