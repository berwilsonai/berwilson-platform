-- Contact aliases: map extracted names/nicknames to existing party records.
-- When the AI extracts "Mike" and the user confirms it's "Michael Thompson",
-- that mapping is saved here so future emails automatically resolve it.

create table public.contact_aliases (
  id          uuid primary key default gen_random_uuid(),
  alias       text not null,          -- extracted name, stored lower-case
  party_id    uuid not null references public.parties(id) on delete cascade,
  created_at  timestamptz default now()
);

-- Expression-based unique index so "Mike" and "mike" are treated as the same alias
create unique index uq_contact_alias on public.contact_aliases (lower(alias));

create index idx_contact_aliases_party on public.contact_aliases(party_id);

-- RLS: match parties table policy (authenticated users can read/write)
alter table public.contact_aliases enable row level security;

create policy "Authenticated users manage aliases"
  on public.contact_aliases
  for all
  using (auth.role() = 'authenticated');
