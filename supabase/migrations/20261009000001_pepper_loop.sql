-- Close the loop Pepper's morning note opens.
--
-- WHY. The note has been sent every weekday since 2026-09-24 and the ledger it
-- reports has only ever grown. Measured 2026-10-09 off the cron's own log, the
-- subject line over eleven consecutive mornings:
--
--   Richard:  19 → 28 → 28 → 42 → 51 → 58 → 59 → 71 → 74 → 76 → 82
--   Eric:     90 → 93 → 95 → 112 → 116 → 123 → 125 → 122 → 124 → 133 → 154
--
-- and in the table itself: 476 open, 35 resolved, and `count(settled_by) = 0`.
-- Not one commitment has ever been marked done or dismissed by a person. The
-- migration that created this table calls the split between `resolved` and the
-- human verdicts "load-bearing"; it has never once borne any load.
--
-- It is not inattention. The ONLY surface that can settle a commitment is the
-- dashboard panel, which reads 24 rows ordered `due_date … nullsFirst: false`.
-- 369 of the 476 open rows carry no date, so they sort below the cap forever:
-- 78% of the ledger is unreachable from the only place that can close it, and
-- Pepper names those rows every morning anyway (`near()` includes the undated
-- ones, correctly — an obligation with no agreed date is not less real).
--
-- So four things here, all in service of the same loop:
--   1. `snoozed_until` — the third verdict the ledger lacked.
--   2. `commitment_action_tokens` — settle from the email, on a phone.
--   3. `pepper_note_items` — what Pepper has already said, so she can escalate.
--   4. `notification_log.dedupe_key` — idempotency for a per-event notification.

-- ---------------------------------------------------------------------------
-- 1. Snooze: "not done, not a bad read, not today"
-- ---------------------------------------------------------------------------
--
-- Without this the reader's only ways to quiet a row are `done` (a lie) and
-- `dismissed` (a different lie — it means extraction misread the mail). A
-- backlog of 369 undated obligations offered neither, which is most of why
-- nothing was ever settled: the honest action did not exist.
--
-- Deliberately NOT a status. Snoozing does not settle anything — the row stays
-- `open`, stays on the ledger, stays in every count — it only stops being
-- shouted about until the date. §12: a computed queue needs a way to record
-- "it is right where it is", or it can never reach zero.
alter table commitments add column if not exists snoozed_until date;

comment on column commitments.snoozed_until is
  'Suppress from the morning note and the default page filter until this date. '
  'The row stays open — this is a quiet, not a settlement.';

-- The note's and the page's hot read: open, not currently snoozed, soonest
-- first. Partial for the same reason the existing one is — settled rows are
-- kept for the audit trail and never scanned.
create index if not exists idx_commitments_open_unsnoozed
  on commitments (side, due_date nulls last, created_at desc)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- 2. Chase drafting state
-- ---------------------------------------------------------------------------
--
-- `chase_text` exists because the draft usually CANNOT be created. Measured:
-- of 231 open commitments owed TO us, 223 sit on threads in moose@/tuaone@,
-- which hold read-only Gmail scope by design (§12, 09-22) — only the 8 on
-- info@ can hold a draft. So the text is composed and stored either way, and
-- the page offers it for copying; where the mailbox can draft, it also drafts.
--
-- `chase_drafted_at` is the latch, one chase per commitment ever: a chase a
-- human deleted is not re-drafted, because deleting it was the decision — the
-- same rule `leads.gmail_draft_id` already follows.
alter table commitments add column if not exists chase_text text;
alter table commitments add column if not exists chase_drafted_at timestamptz;
alter table commitments add column if not exists chase_draft_id text;
alter table commitments add column if not exists chase_mailbox text;

comment on column commitments.chase_text is
  'A ready-to-send follow-up, composed locally. Present even when the thread''s '
  'mailbox cannot hold a draft, which is the usual case.';

-- ---------------------------------------------------------------------------
-- 3. Settle from the email
-- ---------------------------------------------------------------------------
--
-- ⚠ THE TOKEN OPENS A PAGE; IT DOES NOT ACT. A link in an email is fetched by
-- things that are not the reader — Gmail prefetches, and the mail gateways
-- whose link wrappers §12 already records (Proofpoint/ATP/Inky) follow every
-- URL in every message to scan it. A GET that settled a commitment would be
-- settled by a scanner before Richard ever opened the note, and the audit trail
-- would say he did it. So GET /s/<token> renders a confirmation and the verdict
-- is a POST from that page.
--
-- The token is the credential, so the HASH is stored and never the token: the
-- note lives in a mailbox forever, and a readable token column would mean this
-- table is a set of working keys to the ledger.
create table if not exists commitment_action_tokens (
  id uuid primary key default gen_random_uuid(),

  -- sha256 of the token, hex. Never the token itself.
  token_hash text not null unique,

  commitment_id uuid not null references commitments(id) on delete cascade,

  -- Who the note was addressed to. Recorded as the actor when the link is used,
  -- so a settlement from an email is attributable to a person and not to
  -- "system" — the same reason user mutations use actorAdminClient (§12).
  team_member_id uuid references team_members(id) on delete set null,

  -- Dead after this. The note is daily, so a link from a fortnight-old note
  -- settling something today is more likely a mis-tap than an intention.
  expires_at timestamptz not null,

  -- Single use. Set when a verdict is recorded through it.
  used_at timestamptz,
  used_action text check (used_action in ('done', 'dismissed', 'snoozed')),

  created_at timestamptz not null default now()
);

create index if not exists idx_commitment_tokens_commitment
  on commitment_action_tokens (commitment_id);
-- The sweep that clears spent and expired rows.
create index if not exists idx_commitment_tokens_expiry
  on commitment_action_tokens (expires_at)
  where used_at is null;

-- ---------------------------------------------------------------------------
-- 4. What Pepper has already said
-- ---------------------------------------------------------------------------
--
-- `notification_log` stores a COUNT and no body, so Pepper has never had any
-- idea what she said yesterday. Two costs, and the second is the worse one:
--
--   * She cannot say "this is the fourth morning I have put this in front of
--     you", which is the single most assistant-like sentence she could write.
--   * `commitmentWeight()` is pure f(due_date, created_at) — fully
--     deterministic — so barring new rows the SAME twelve items appear in the
--     SAME order every morning, while 357 undated obligations are never named
--     to anyone at all. Every comment in the Pepper modules warns against
--     teaching the reader to filter the note; the ranking guaranteed it.
--
-- One row per person per item, forever, carrying the count. `item_key` is the
-- commitment id for commitments and the task id for tasks, as text, because
-- this table tracks WHAT WAS SAID rather than what exists — a row whose
-- commitment is later deleted still records that Pepper raised it.
create table if not exists pepper_note_items (
  id uuid primary key default gen_random_uuid(),

  team_member_id uuid not null references team_members(id) on delete cascade,

  kind text not null check (kind in ('commitment', 'task', 'crack')),
  item_key text not null,

  first_named_on date not null,
  last_named_on date not null,
  times_named int not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),

  -- The upsert target. A full (not partial) unique constraint, so it can be
  -- named by ON CONFLICT — §12: PostgREST cannot repeat a partial index's
  -- predicate, and no column here is ever null.
  unique (team_member_id, kind, item_key)
);

create index if not exists idx_pepper_note_items_lookup
  on pepper_note_items (team_member_id, kind, last_named_on);

drop trigger if exists set_updated_at on pepper_note_items;
create trigger set_updated_at before update on pepper_note_items
  for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Idempotency for a per-event notification
-- ---------------------------------------------------------------------------
--
-- `notification_log`'s guard is (team_member_id, kind, sent_date), which is
-- exactly right for one message a day and useless for the meeting-prep nudge:
-- a second meeting on the same day would read as already sent. `dedupe_key`
-- carries the event's own identity (the calendar event id) instead.
--
-- A FULL unique constraint, not partial: every existing row and every daily
-- notification leaves this null, and Postgres never treats two nulls as equal,
-- so the constraint simply does not apply to them. That is what makes it an
-- ON CONFLICT target (§12) rather than a predicate PostgREST cannot express.
alter table notification_log add column if not exists dedupe_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notification_log_kind_dedupe_key_key'
  ) then
    alter table notification_log
      add constraint notification_log_kind_dedupe_key_key unique (kind, dedupe_key);
  end if;
end $$;

comment on column notification_log.dedupe_key is
  'Per-event idempotency key for notifications that are not once-a-day '
  '(meeting prep uses the calendar event id). NULL for daily kinds, which are '
  'guarded by (team_member_id, kind, sent_date) instead.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- ⚠ EXPLICIT, NOT INHERITED. A table created by a migration applied as anything
-- but `postgres` receives no API grants at all and every PostgREST call answers
-- 42501 — which is how `notification_log` itself shipped dead for five weeks
-- (§12, 09-24). Stated here so the outcome does not depend on who ran the file.
alter table public.commitment_action_tokens owner to postgres;
alter table public.pepper_note_items owner to postgres;
grant all on table public.commitment_action_tokens to anon, authenticated, service_role;
grant all on table public.pepper_note_items to anon, authenticated, service_role;

alter table commitment_action_tokens enable row level security;
alter table pepper_note_items enable row level security;

-- RLS is defense-in-depth here; app traffic is service-role (§8).
drop policy if exists "commitment_action_tokens_all" on commitment_action_tokens;
create policy "commitment_action_tokens_all" on commitment_action_tokens
  for all using (auth.role() = 'authenticated');
drop policy if exists "pepper_note_items_all" on pepper_note_items;
create policy "pepper_note_items_all" on pepper_note_items
  for all using (auth.role() = 'authenticated');
