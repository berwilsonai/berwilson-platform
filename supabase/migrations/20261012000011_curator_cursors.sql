-- Where the curator got to on each record.
--
-- WHY A CURSOR AND NOT A TIMESTAMP ON THE RECORD. Two reasons, both learned
-- the hard way elsewhere in this repo. First, `projects` is a table humans
-- edit constantly and `updated_at` is maintained by trigger, so there is no
-- column on it that means "when Pepper last looked" — adding one would be a
-- column the record's own form could clear. Second, the curator runs over two
-- parent tables (projects and opportunities) and will run over more, so the
-- cursor belongs beside the pass rather than inside each record (§4's
-- shared-children convention, same reasoning).
--
-- ⚠ `evidence_through` IS THE POINT, NOT `last_run_at`. A pass that re-reads a
-- record whose correspondence has not moved spends 30-60s of a single-threaded
-- box to conclude nothing — 26 records is twenty minutes of contention for no
-- change. The cursor is the newest evidence timestamp the pass has SEEN, so the
-- next run can skip a record whose newest thread, meeting or document is no
-- newer than that. `last_run_at` is kept only so a human can tell "skipped
-- because nothing changed" from "never ran".
create table if not exists curator_cursors (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,

  -- The newest `updated_at` across the evidence this record was last curated
  -- against. NULL means it has never been curated.
  evidence_through timestamptz,
  last_run_at timestamptz,

  -- What the last run did, so the morning note and the health page can report
  -- without re-deriving it from activity_log.
  last_written integer not null default 0,
  last_proposed integer not null default 0,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (table_name, record_id)
);

alter table curator_cursors enable row level security;
