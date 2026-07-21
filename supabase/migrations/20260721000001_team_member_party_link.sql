-- Unify people: link task owners (team_members) to the contacts directory
-- (parties), so a person is ONE record whether they attend meetings or own tasks.
-- team_members stays the assignee FK for tasks; party_id ties it to a contact.

alter table team_members
  add column if not exists party_id uuid references parties(id) on delete set null;

create index if not exists team_members_party_id_idx on team_members(party_id);

-- Best-effort backfill existing owners to an existing contact.
-- 1) by email (exact, case-insensitive).
update team_members tm
set party_id = p.id
from parties p
where tm.party_id is null
  and tm.email is not null
  and p.email is not null
  and lower(p.email) = lower(tm.email);

-- 2) by exact full name — only when the match is unambiguous (one contact).
update team_members tm
set party_id = p.id
from parties p
where tm.party_id is null
  and lower(p.full_name) = lower(tm.name)
  and not exists (
    select 1 from parties p2
    where lower(p2.full_name) = lower(tm.name) and p2.id <> p.id
  );
