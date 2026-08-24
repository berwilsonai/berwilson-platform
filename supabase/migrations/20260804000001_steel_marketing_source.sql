-- Steel CRM — restrict salespeople to flagged reps, and make the marketing /
-- referral source any contact (party) rather than a team member.
--
-- Sales reps are a small fixed set (Colton, Richard, Eric, Jason). Marketing
-- sources are typically Ber Wilson employees but can be anyone in the contacts
-- directory, and earn a referral fee (a flat amount or a % of the deal margin).
-- The old team-member-only "Marketer" (5/4/3% tier rate) and "Referred By"
-- fields are retired; their columns (marketer_id, lead_source_id,
-- marketing_* ) are left in place, unused, so this migration is non-destructive.

-- 1. Designate steel sales reps on team_members.
alter table team_members
  add column if not exists is_steel_rep boolean not null default false;

-- Flag the existing reps.
update team_members set is_steel_rep = true where name in ('Richard', 'Eric');

-- Add the two new reps (no login yet — an admin grants access under Users when
-- they're ready). Guarded so re-running never duplicates them.
insert into team_members (name, role, active, is_steel_rep)
select v.name, 'steel_sales', true, true
from (values ('Colton'), ('Jason')) as v(name)
where not exists (select 1 from team_members t where lower(t.name) = lower(v.name));

-- 2. Marketing / referral source = any contact (party).
alter table steel_deals
  add column if not exists referral_party_id uuid references parties(id) on delete set null;

create index if not exists idx_steel_deals_referral_party_id on steel_deals(referral_party_id);
