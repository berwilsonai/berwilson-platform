-- Two gaps that together meant a title company's documents reached nothing.
--
-- 1. ATTACHMENTS HAD NO CURSOR OF THEIR OWN. `importNewAttachments` sliced the
--    thread at `applied_message_count`, which every filing path except the
--    router's own inferred match seeds at the thread's CURRENT length —
--    deliberately, so filing a conversation does not replay years of mail into a
--    record's feed as new activity. Correct for the feed, wrong for files: the
--    slice was therefore always empty, and a thread's existing attachments could
--    never arrive. Only a message landing AFTER the link was created brought a
--    document in. Measured 2026-09-25: 178 attachments sat on project- and
--    opportunity-linked threads against 30 correspondence documents ever
--    imported.
--
--    The fix is a second cursor. Old mail is not news; a deed, a plat map or a
--    title commitment is a permanent artifact and belongs on the record whenever
--    it arrived. Defaulting to 0 is what backfills the existing links.
alter table thread_links
  add column if not exists attachments_through integer not null default 0;

comment on column thread_links.attachments_through is
  'How many of the thread''s messages have had their attachments considered. Separate from applied_message_count on purpose: the TEXT of old mail is not news, but a document on it is still a document. Advanced per message so an interrupted run resumes.';

-- Links with mail to post are found by comparing counts across tables, which
-- PostgREST cannot express — the scan reads this column, so it is worth an index
-- only for the partial case that matters.
create index if not exists idx_thread_links_attachments_pending
  on thread_links (last_applied_at nulls first)
  where record_kind in ('project', 'opportunity');

-- 2. NOTHING LEARNED FROM A FILING DECISION. Highland Title's mail names a
--    parcel and an owner, never the deal: "62831 | Parcel No 02-0138-0000 /
--    Carbon County | NPS Holdings, LLC" shares no word with "DUBHES Helper /
--    Giovanni Resilience Campus". The router refused, correctly, and would have
--    refused every following email the same way — a title company works across
--    many deals, so the sender is not the answer and never will be.
--
--    What IS durable is the property. A parcel number belongs to a piece of
--    ground permanently, and the owning entity belongs to it for the length of a
--    negotiation. So: when a human files a thread onto a record, keep the hard
--    identifiers that thread carried, and match the next thread on them the same
--    way a solicitation number is already matched — by containment, as a fact
--    rather than a similarity score.
create table if not exists record_identifiers (
  id uuid primary key default gen_random_uuid(),
  record_kind text not null check (record_kind in ('project', 'opportunity', 'steel_deal')),
  record_id uuid not null,
  -- 'parcel' — a tax/APN/serial parcel number. 'party' — an owning or
  -- counterparty legal entity, kept because parcels arrive one at a time and the
  -- owner is what ties an assembly together.
  kind text not null check (kind in ('parcel', 'party')),
  -- As written, for a human reading why something was filed.
  value text not null,
  -- Comparison key: lowercased, punctuation stripped. A parcel is recorded as
  -- "02-0138-0000", "02 0138 0000" and "020138-0000" by three different offices.
  normalized text not null,
  source_thread_id uuid references email_threads(id) on delete set null,
  created_at timestamptz default now()
);

-- One identifier per record. A plain unique constraint rather than an expression
-- index so PostgREST can name it as an ON CONFLICT target (§12).
alter table record_identifiers
  drop constraint if exists record_identifiers_unique;
alter table record_identifiers
  add constraint record_identifiers_unique
  unique (record_kind, record_id, kind, normalized);

-- The router loads every identifier once per pass and matches in memory, so the
-- useful index is the reverse lookup: which records answer to this key.
create index if not exists idx_record_identifiers_normalized
  on record_identifiers (kind, normalized);

alter table record_identifiers enable row level security;

drop policy if exists record_identifiers_select on record_identifiers;
create policy record_identifiers_select on record_identifiers
  for select using (auth.role() = 'authenticated');

-- ⚠ Applied as `postgres` so the default privileges that grant anon /
-- authenticated / service_role actually fire. A table created as
-- supabase_admin receives NO api grants and answers 42501 to every PostgREST
-- call (§12) — stated here because this file is applied by hand.
grant select, insert, update, delete on record_identifiers to service_role;
grant select on record_identifiers to authenticated;
