-- Who wrote each field, so an autonomous pass knows what it may change.
--
-- WHY THIS TABLE EXISTS. Richard's direction (2026-10-12) removes the approval
-- gate from CRM updates: Pepper reads the correspondence, the texts and the
-- recorded calls and writes what she learns straight onto the record. The one
-- carve-out he named is "something we did manually that isn't obvious she could
-- update it" — partner split percentages and the like. That carve-out is not
-- expressible without knowing, per FIELD, whether the value standing there was
-- typed by a person or written by her.
--
-- ⚠ THE DEFAULT FOR AN UNKNOWN FIELD IS "HUMAN", NOT "PEPPER". There is no row
-- here for anything written before today, and `activity_log.field_changes` only
-- carries a column-level diff since 2026-09-30 — so most existing values cannot
-- be attributed either way. Reading an absent row as "she wrote it, so she may
-- replace it" would hand her every hand-curated figure on the first run. The
-- read in src/lib/provenance/read.ts therefore treats absence as human, which
-- errs toward asking. §12: forgetting to opt in costs a few results, forgetting
-- to opt out costs the secret.
--
-- WHY NOT DERIVE IT FROM activity_log. The log is append-only and already
-- records actor_type and a diff, which is the right audit trail and the wrong
-- index: answering "who last wrote projects.stage for this row" means scanning
-- every row of a 20-table audit history per field per pass. This is the
-- projection, the log stays the evidence, and the two are written together.
create table if not exists record_field_provenance (
  id uuid primary key default gen_random_uuid(),

  -- The address of one field on one row. Deliberately a text table_name rather
  -- than an enum or an FK: this is written by a generic pass over whatever the
  -- curator is allowed to touch, and the allowed set is a whitelist in code
  -- (src/lib/provenance/fields.ts) which is a security boundary, not a
  -- convenience — the same shape as the governance register whitelist (§4).
  table_name text not null,
  record_id uuid not null,
  field_key text not null,

  -- 'human' means a person typed it into a form. 'pepper' means an automated
  -- pass wrote it. Two members on purpose: the question this table answers is
  -- binary, and a third value ('import', 'unknown') would immediately need a
  -- rule about whether it is overwritable, which is the question itself.
  written_by text not null check (written_by in ('human', 'pepper')),

  -- Where she read it. A new reader is a code change, so a CHECK is right here
  -- (§12: a value set that grows with the BUSINESS is a table; one that grows
  -- with the CODE is a CHECK).
  source_kind text check (source_kind in (
    'email_thread', 'text_session', 'meeting', 'document', 'note', 'form', 'backfill'
  )),
  -- The id of that thread / meeting / document, as text because it crosses tables.
  source_ref text,
  -- ⚠ THE SENTENCE SHE READ IT IN, not a summary of it. The economics
  -- extractor already proved this is the part a human checks first: a figure
  -- with its own quote beside it can be confirmed in a glance, and one without
  -- has to be hunted. Nullable because a backfill has no sentence.
  evidence text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),

  -- When the SOURCE is from, not when the row was written. A closing date read
  -- out of a September email must lose to one read out of an October email even
  -- if the September thread was swept second.
  as_of timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per field. A re-read updates it rather than stacking history —
  -- history is activity_log's job and duplicating it here would make "who owns
  -- this field" a query with an ORDER BY in it.
  unique (table_name, record_id, field_key)
);

create index if not exists record_field_provenance_record_idx
  on record_field_provenance (table_name, record_id);

-- Fields she wants to change but may not: the "just ask me" queue.
--
-- WHY A SEPARATE TABLE AND NOT review_queue. review_queue holds low-confidence
-- AI ITEMS awaiting a verdict on whether they are real. This holds a field she
-- is confident about and is forbidden from writing, which is a different
-- question with a different answer shape: not "is this true" but "your value or
-- mine". Folding them would make one screen ask two questions.
create table if not exists field_update_proposals (
  id uuid primary key default gen_random_uuid(),

  table_name text not null,
  record_id uuid not null,
  field_key text not null,
  -- A readable label for the record, snapshotted. The proposal outlives a
  -- rename and must still say which deal it is about (the same reasoning as
  -- project_spvs.org_node_name, §4).
  record_label text,

  -- Rendered as text whatever the column's type, because this table spans
  -- columns of every type and the screen only ever shows them side by side.
  current_value text,
  proposed_value text,

  source_kind text,
  source_ref text,
  evidence text,
  confidence numeric,

  -- ⚠ 'pending' IS THE UNDECIDED ARM AND 'rejected' MEANS "MY VALUE STANDS".
  -- §12 warns about a status set with no arm for the real-but-not-now state;
  -- here that state is genuinely absent — a field proposal is answered by
  -- choosing one of two values, and there is no third thing to be true later.
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'superseded')),
  decided_at timestamptz,
  decided_by uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- ⚠ NOT A PARTIAL INDEX. One live proposal per field, so a second reading of
  -- the same field UPDATES the open question rather than asking it twice. §12:
  -- ON CONFLICT cannot name a partial unique index, and this is the conflict
  -- target the curator upserts on every run.
  unique (table_name, record_id, field_key)
);

create index if not exists field_update_proposals_pending_idx
  on field_update_proposals (status, created_at desc);

-- What Pepper has sent by text, so the sweep does not read it back as news.
--
-- ⚠ THIS IS THE 2026-10-09 SELF-LOOP, REBORN IN A CHANNEL WITH NO LABELS.
-- 131 of 481 open commitments turned out to be Pepper reading her own morning
-- notes, because the guard was keyed on her DISPLAY NAME and she was renamed.
-- Texting is worse: the Studio sends as Richard's own Apple ID, so her text to
-- Eric lands in the Richard↔Eric conversation that the iMessage sweep ingests
-- and scores — and `is_from_me` cannot discriminate, because Richard's own real
-- texts are also from him and those are exactly what the sweep is for.
--
-- So the guard is the SEND RECORD: every outbound text is hashed here before it
-- leaves, and ingestion drops any message whose (handle, body hash) it finds.
-- That is structural — it does not depend on a name, a prefix, or a sentence
-- anybody might later decide to reword. §12: key the guard on what cannot be
-- renamed, including by us.
create table if not exists pepper_outbound_texts (
  id uuid primary key default gen_random_uuid(),
  -- E.164 where we have it, as dialled otherwise; normalized by the sender.
  handle text not null,
  -- sha256 of the message body, which is what ingestion can match on. The body
  -- itself is kept too: a guard nobody can read is a guard nobody can debug.
  body_sha256 text not null,
  body text not null,
  kind text not null check (kind in ('morning', 'week_ahead', 'nudge', 'reply', 'ad_hoc')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists pepper_outbound_texts_lookup_idx
  on pepper_outbound_texts (handle, body_sha256);

-- Retirement of a staged proposal, as a tombstone rather than a delete.
--
-- 67 of 134 pending email intake sessions are over 30 days old (measured
-- 2026-10-12). §12: THE ROW IS THE TOMBSTONE — a hard delete of a staged
-- session loses the only record that the correspondence was ever triaged, and
-- the sweep would re-stage it. These two columns make a retirement visible,
-- attributable and reversible in one click.
--
-- Deliberately NOT a new `status` value: 'dismissed' already means a human
-- said no, and overloading it would make Pepper's housekeeping indistinguishable
-- from Richard's judgement in every count that has ever been taken.
alter table email_intake_sessions
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text;

create index if not exists email_intake_sessions_live_idx
  on email_intake_sessions (status, intake_kind) where retired_at is null;

-- §4 convention: RLS on every table. App traffic uses the service role and the
-- auth boundary is the middleware (§8), so these carry no policies — enabling
-- it is defence-in-depth against a future move to the RLS-respecting client,
-- and default-deny is the correct posture for all three.
alter table record_field_provenance enable row level security;
alter table field_update_proposals enable row level security;
alter table pepper_outbound_texts enable row level security;
