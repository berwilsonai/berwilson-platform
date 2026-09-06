-- Deal intake from the website (2026-09-05)
--
-- The berwilson.com lead form captures a due-diligence checklist and creates one
-- Google Drive folder per deal, which then fills with documents over the
-- diligence period. This migration is what lets that folder become a lead, and
-- later a project, without losing the checklist's structure.
--
-- Transport is a JSON file in the folder rather than an HTTP POST because the
-- platform is tailnet-only: middleware allows nine cron paths and login, and
-- every inbound integration works by pulling. A public form cannot reach it, and
-- re-exposing the Studio was deliberately undone in July.
--
-- A submitted deal is NOT a project. It lands in `leads` — the tier that already
-- exists for "it arrived, nobody owns it" — and a human presses Promote. This
-- adds a second SOURCE to that module, not a second module.

-- ── 1. Leads can come from somewhere other than a mailbox ───────────────────

-- A web-form lead has no email thread. Every consumer was already written
-- defensively for this (gmail-sync and draft-reply filter on
-- `.not('thread_id','is',null)`, score-phase branches on a null thread), so
-- dropping the constraint is the whole change.
--
-- idx_leads_thread stays exactly as it is: Postgres treats NULLs as distinct in
-- a unique index, so any number of web leads coexist while one-lead-per-thread
-- still holds for mail.
alter table leads alter column thread_id drop not null;

alter table leads
  add column if not exists source text not null default 'email';
alter table leads drop constraint if exists leads_source_check;
alter table leads
  add constraint leads_source_check check (source in ('email', 'web_form'));

-- The deal folder this lead was read from, and a link straight to it.
alter table leads add column if not exists drive_folder_id text;
alter table leads add column if not exists drive_folder_url text;

-- The idempotency latch. The scan runs every 15 minutes over the same parent
-- folder; without this a transient failure between reading and inserting would
-- produce a second lead for the same deal on the next pass.
create unique index if not exists idx_leads_drive_folder
  on leads(drive_folder_id)
  where drive_folder_id is not null;

-- The manifest, verbatim. Kept whole rather than only as mapped dd_items so a
-- checklist question that was mis-mapped can be re-read instead of re-collected.
alter table leads
  add column if not exists intake_answers jsonb not null default '{}'::jsonb;

-- ── 2. Projects remember which folder they came from ────────────────────────

-- Distinct from drive_folder_id (which publishRecordToDrive owns): this records
-- that the folder was created by the website, not by the platform. Both point at
-- the SAME folder — the form creates it under the platform's own OAuth client as
-- moose@, which makes it app-created and therefore writable under the existing
-- drive.file scope. One folder, readable and writable from both ends.
alter table projects add column if not exists deal_folder_id text;

create index if not exists idx_projects_deal_folder
  on projects(deal_folder_id)
  where deal_folder_id is not null;

-- No log_activity() trigger here: the same reason as opportunities and the sweep
-- tables — it dereferences new.project_id, which these columns do not carry.
