-- Developer Notes — in-app bug reports and feature requests.
--
-- The gap this closes: the people who USE this platform (Eric, and the
-- teammates joining as the company scales) have no way to tell the person who
-- BUILDS it that something is broken. Feedback travelled by text message or
-- not at all, which means it arrived without the one thing a bug report needs
-- most — where the reporter was standing when it happened.
--
-- So the report is raised from inside the app and captures `page_path` and
-- `user_agent` automatically. Those two columns are the whole reason this is a
-- button in the shell rather than an email address.
--
-- ⚠ DELIBERATELY NOT A ROW IN `tasks`. A dev note behaves like a task — it is
-- owned, worked, and checked off — but `tasks` is the company's WORK board
-- (assigned to team members, tagged to projects/opportunities/objectives, rolled
-- into the weekly report and the daily brief). Platform feedback filed there
-- would show up as portfolio work in every one of those surfaces and quietly
-- distort them. Same behaviour, separate ledger.
--
-- Status / kind / priority are plain text + app constants
-- (src/lib/utils/dev-notes.ts), following every vocabulary added since
-- opportunities — so the set can evolve without a migration.

create table if not exists dev_notes (
  id uuid default gen_random_uuid() primary key,
  kind text not null default 'bug',                 -- bug | feature | improvement | question
  title text not null,
  body text,

  -- Captured automatically at report time. A bug report that does not say
  -- which screen it happened on costs a round trip to find out, and the
  -- reporter is usually the one person who cannot answer it precisely.
  page_path text,
  user_agent text,

  -- Reporter is stamped SERVER-SIDE from the session, never from the request
  -- body — the same rule the other notes tables settled on after two of them
  -- shipped a "your name" box that let a note be posted under anyone's name.
  -- The name is denormalized beside the FK so a report survives its reporter
  -- leaving the team with the audit trail intact.
  reporter_id uuid references team_members(id) on delete set null,
  reporter_name text,

  status text not null default 'open',              -- open | in_progress | done | wont_do
  priority text not null default 'normal',          -- low | normal | high

  -- Closing the loop. Without this the reporter learns only that their note
  -- vanished from the open list, which reads as "ignored" rather than "fixed".
  resolution text,
  resolved_at timestamptz,
  resolved_by text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- The list is "open work, newest first" plus a per-person view.
create index if not exists idx_dev_notes_status on dev_notes(status, created_at desc);
create index if not exists idx_dev_notes_reporter on dev_notes(reporter_id);

create trigger set_updated_at
  before update on dev_notes
  for each row execute function update_updated_at();

-- ⚠ log_activity() IS attached here, unlike objectives / investors / dino,
-- whose migrations say it "dereferences new.project_id, which this table
-- doesn't have". That was true of the ORIGINAL trigger; the current version
-- (20260704000006) reads the column through `to_jsonb(new)->>'project_id'`,
-- which yields NULL for a table that has no such column. Verified against this
-- database in a rolled-back transaction before attaching: INSERT / UPDATE /
-- DELETE on a project-less table all log cleanly with a null project_id.
create trigger log_dev_notes
  after insert or update or delete on dev_notes
  for each row execute function log_activity();

-- RLS — authenticated users get full access (app traffic uses the service
-- role; RLS is defense-in-depth, per CLAUDE.md §8). Who may change WHAT is
-- enforced in the API routes, which is where the reporter-vs-admin rule lives.
alter table dev_notes enable row level security;
create policy "dev_notes_select" on dev_notes for select using (auth.role() = 'authenticated');
create policy "dev_notes_insert" on dev_notes for insert with check (auth.role() = 'authenticated');
create policy "dev_notes_update" on dev_notes for update using (auth.role() = 'authenticated');
create policy "dev_notes_delete" on dev_notes for delete using (auth.role() = 'authenticated');
