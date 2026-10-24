-- A CONTACT BECOMES A RECORD YOU CAN LOG AGAINST, AND A NETWORKING CALL GETS A
-- HOME THAT IS NOT A BACKLOG.
--
-- Richard, 2026-10-23: "As we do so much networking it is really important to
-- capture and track our contacts. Make sure that the contact level record has a
-- place to log multiple meeting notes etc... as often times they wont be tied to
-- any particular project or opportunity."
--
-- ⚠ MEASURED FIRST, AND THE NUMBERS ARE WHY THIS IS THREE CHANGES AND NOT ONE.
-- On the live database, 2026-10-23:
--
--   * **135 of 169 attendee slots across the 18 `meetings` rows carry no
--     `party_id`** — 96 distinct names. 11 contacts out of 151 have ever had a
--     meeting logged against them. So the networking capture this platform
--     exists to automate is leaking almost everything it hears.
--   * **`parties` is the only record type with no notes feed.** `task_notes`,
--     `investor_notes`, `lead_notes`, `opportunity_notes`, `steel_deal_notes`,
--     `personnel_notes`, `dino_notes` all exist; a contact has ONE free-text
--     `relationship_notes` blob, which is a standing description of a person and
--     cannot hold a dated sequence of conversations. 98 of 151 contacts have it
--     filled, so it is in use — it is simply the wrong shape for "what we said
--     on the 14th" and then again "what we said on the 22nd".
--   * **A call on no deal has no terminal state.** `meetings.scope` is
--     company | project | opportunity | unfiled, and `unfiled` is what a
--     recording is written as before anything files it. A networking call
--     belongs to no deal *and never will*, so it sits in `unfiled` forever,
--     indistinguishable from a backlog — §12: "'belongs to no record' must be
--     recordable, or every pass refuses it forever."
--
-- ⚠ AND WHAT THE 96 NAMES ACTUALLY ARE IS WHY THE RESOLUTION IS A HUMAN'S.
-- Reading them: `moose@berwilson.com` (×5) and `tuaone@berwilson.com` (×5) —
-- our own two executives, as mailboxes; "Ber Wilson" our own company, five
-- times, in a person-shaped field; "Army Corps of Engineers", "Department of
-- Defense", "Dell", "Bloom Energy" — organizations; and "Eric", "Mike", "Abe",
-- "Brad", "Amy", "Chris" — first names with no surname, which §12 says may
-- never match on their own. Offering "create a contact" for each of 96 would
-- manufacture exactly the rolodex §12 records being cleaned up on 10-21 and
-- 10-22, where `matchParty` reporting a refusal as an absence turned one
-- archived row into two fresh ones in a day. So the names are CLASSIFIED and a
-- person decides; nothing here creates a party.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `party_notes` — the contact's own feed.
--
-- ⚠ SHAPED EXACTLY LIKE `opportunity_notes`, which is itself shaped like
-- `updates`, so the shared renderer reads ONE shape (§12: a shared renderer
-- wired to one surface is worse than no shared renderer). The three jsonb
-- arrays are NOT NULL with an empty-array default — write them with `JsonIn`,
-- never `Json`, because `Json` includes null and a NOT NULL jsonb column does
-- not (§4).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists party_notes (
  id uuid primary key default gen_random_uuid(),

  party_id uuid not null references parties(id) on delete cascade,

  -- What was said, verbatim. The text is the record; everything else is derived.
  body text not null,

  -- The model's read, when one was asked for. NULL means "saved as-is", which is
  -- a first-class choice and not a failure — the same contract `opportunity_notes`
  -- carries, and on a 35B local model the extract pass is 30–60s a human may not
  -- want to wait for.
  summary    text,
  waiting_on jsonb not null default '[]'::jsonb,
  risks      jsonb not null default '[]'::jsonb,
  decisions  jsonb not null default '[]'::jsonb,
  confidence numeric(3,2),

  author text,

  -- ⚠ WHEN THE CONVERSATION HAPPENED, WHICH IS NOT WHEN THE ROW WAS WRITTEN.
  -- A recording swept at 02:00 is a conversation from the afternoon before, and
  -- a note typed up on Monday is about Friday's coffee. Sorting a relationship
  -- history by `created_at` puts a backfilled call from August above this
  -- morning's. Defaults to today so a hand-typed note needs no date.
  note_date date not null default current_date,

  -- ⚠ WHERE IT CAME FROM, AND DELIBERATELY NOT A TAXONOMY OF CONVERSATIONS.
  -- §12: a CHECK is a list baked into the schema and only belongs where the set
  -- does not grow with the business. This set is structural — the doors that can
  -- write here — so it is a CHECK and the union lives in ONE place in TypeScript
  -- (`PartyNoteSource` in src/lib/contacts/notes.ts). "What kind of relationship
  -- moment this was" is prose in the body, where no category can lose it.
  source text not null default 'typed'
    check (source in ('typed', 'meeting', 'email')),

  -- The conversation this note is a record of, when it came from one.
  --
  -- ⚠ `on delete set null`, NOT cascade. The note is the record of what was
  -- said; the `meetings` row is the register entry. Deleting a duplicated
  -- register entry must not erase a contact's history of the conversation.
  meeting_id uuid references meetings(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table party_notes is
  'A contact''s own dated feed — the conversations we have had with a person, including the ones that belong to no project or opportunity. `parties.relationship_notes` stays what it was: a standing description of who somebody is. This is the sequence.';
comment on column party_notes.note_date is
  'When the conversation happened, not when the row was written. A swept recording is yesterday''s call (§12: a projection carries its source''s clock, not its own).';
comment on column party_notes.meeting_id is
  'The `meetings` row this came from, when it came from one. The partial unique index below is the idempotency latch: one note per contact per meeting, however many times a sweep re-reads it.';

-- The one query the contact page makes.
create index if not exists idx_party_notes_party
  on party_notes (party_id, note_date desc, created_at desc);

-- ⚠ THE IDEMPOTENCY LATCH, AND IT IS PARTIAL BECAUSE IT MUST BE.
-- A meeting writes at most one note per attendee however often the sweep runs;
-- a HAND-TYPED note has no meeting_id, and several of those per contact are the
-- whole point. `unique (party_id, meeting_id)` would be satisfied by every NULL
-- pair (§12: a unique over an always-NULL column enforces nothing), and
-- `unique nulls not distinct` would cap a contact at one typed note forever.
-- Hence the predicate — which also means it can never be an `ON CONFLICT`
-- target (§12), so `logMeetingOnContacts` reads before it writes.
create unique index if not exists uq_party_notes_meeting
  on party_notes (party_id, meeting_id)
  where meeting_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `meetings.scope` gains 'contact' — a terminal state for a call on no deal.
--
-- ⚠ NO `party_id` COLUMN, DELIBERATELY. A networking breakfast with three new
-- people has no primary one, and a single pointer would force the writer to
-- invent one. The attendees are already in `attendees`, each with its own
-- `party_id` once resolved, and that array is what `syncAttendeeActivity` and
-- the contact page read. So 'contact' means exactly "a real conversation that
-- belongs to no project or opportunity, and a person said so" — both record
-- pointers stay NULL, same as 'unfiled', and the difference between the two is
-- that a human has decided.
--
-- ⚠ A VALUE OUTSIDE AN ENUM FAILS THE WHOLE QUERY, NOT THE ROW (§12), and that
-- is the live hazard here: `attachMeetingToContact` writing 'contact' against
-- the old CHECK is a 22P02 that discards every other field in the same UPDATE.
-- Both constraints move together, in this one migration.
-- ─────────────────────────────────────────────────────────────────────────────

alter table meetings drop constraint if exists meetings_scope_check;
alter table meetings add constraint meetings_scope_check check (
  scope in ('company', 'project', 'opportunity', 'unfiled', 'contact')
);

alter table meetings drop constraint if exists meetings_scope_target_check;
alter table meetings add constraint meetings_scope_target_check check (
  (scope = 'company'     and project_id is null     and opportunity_id is null) or
  (scope = 'project'     and project_id is not null and opportunity_id is null) or
  (scope = 'opportunity' and opportunity_id is not null and project_id is null) or
  (scope = 'unfiled'     and project_id is null     and opportunity_id is null) or
  (scope = 'contact'     and project_id is null     and opportunity_id is null)
);

comment on column meetings.scope is
  'company | project | opportunity | unfiled | contact. ''unfiled'' is a real call nothing has filed YET and is a backlog item; ''contact'' is a call a human has said belongs to no deal, and is terminal — reconcile-unfiled selects on ''unfiled'' and so never revisits it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. `meeting_attendee_skips` — "this name is not a contact", said once.
--
-- The findings queue lists every attendee name no contact answers to. Without a
-- tombstone, dismissing "Department of Defense" shows it again tomorrow, which
-- is §12's "a gated-out row is HELD, never dismissed" read from the other side:
-- a queue that cannot be emptied is a queue nobody works.
--
-- Keyed on the NAME, not on (name, meeting): deciding that "Ber Wilson" is our
-- own company is a fact about the string, true on every call it appears on.
-- Uniqueness is on the generated key so a conflict is on `name_key` and never on
-- `name` (§4, the `contact_aliases` convention) — and `ON CONFLICT` works here
-- because the index is on a stored generated column rather than an expression.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists meeting_attendee_skips (
  id uuid primary key default gen_random_uuid(),

  -- The name as it was heard, kept for the reader.
  name text not null,
  name_key text generated always as (lower(btrim(name))) stored,

  -- Why it is not a contact. A tight structural set: these are the four answers
  -- the findings queue can give, and each one is a different fact.
  --   organization — a company, agency or firm in a person-shaped field
  --   internal     — one of ours, under a mailbox or a first name
  --   not_a_person — a label the model heard as an attendee ("Ber Wilson Lead")
  --   declined     — a real person we are choosing not to track
  reason text not null
    check (reason in ('organization', 'internal', 'not_a_person', 'declined')),

  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_meeting_attendee_skips_name
  on meeting_attendee_skips (name_key);

comment on table meeting_attendee_skips is
  'Names heard on a recording that are not contacts, with the reason. The tombstone that lets the findings queue reach zero; reversible by deleting the row.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Per-table attributes — triggers, RLS, grants.
--
-- ⚠ STATED, NEVER INHERITED. §12: a table created by a migration applied as
-- anything but `postgres` gets NO API grants and every call answers 42501; and
-- the same blindness covers every other per-table attribute, because a trigger
-- is a hand-written enumeration with no registry behind it.
--
-- `party_notes` is tracked, so a hard delete survives itself in the append-only
-- log (§4 — log_activity writes to_jsonb(old) into metadata). It is NOT added to
-- `_audited_in_full` inside the function: the body is prose, and a column-by-
-- column diff would store both copies on every edit, which is exactly what that
-- gate exists to prevent.
--
-- ⚠ AND MAKING A TABLE TRACKED MEANS AUDITING EVERY WRITE PATH IN THE SAME
-- CHANGE (§12), or the trail reads "system" and answers nothing. Every route
-- added for this table uses actorAdminClient(); the one automatic writer
-- (logMeetingOnContacts) is Pepper's and is meant to read as hers.
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists set_updated_at on party_notes;
create trigger set_updated_at before update on party_notes
  for each row execute function update_updated_at();

drop trigger if exists log_party_notes_activity on party_notes;
create trigger log_party_notes_activity after insert or update or delete on party_notes
  for each row execute function log_activity();

alter table party_notes enable row level security;
alter table meeting_attendee_skips enable row level security;

drop policy if exists party_notes_all on party_notes;
create policy party_notes_all on party_notes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists meeting_attendee_skips_all on meeting_attendee_skips;
create policy meeting_attendee_skips_all on meeting_attendee_skips for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

grant select, insert, update, delete on party_notes to anon, authenticated, service_role;
grant select, insert, update, delete on meeting_attendee_skips to anon, authenticated, service_role;

commit;
