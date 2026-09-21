-- Auto-filing documents into the team's own Drive folders.
--
-- The platform published into its own `Ber Intelligence` tree in moose@'s My
-- Drive while the team files its real work in the `Ber Wilson Proper` shared
-- drive. Two document homes, and the team only ever opened one of them. These
-- columns let a document be placed in the team's own project folder, in the
-- right subfolder, and let the platform remember where it put it.

-- Which subfolder a document lives in, relative to its record's Drive folder.
-- Written by BOTH directions: the filer records where it put a file, and the
-- importer finally PERSISTS the subfolder path it has always computed from the
-- Drive listing and then thrown away (it was used for the arrival notice only).
alter table documents             add column if not exists drive_folder_path text;
alter table opportunity_documents add column if not exists drive_folder_path text;

-- Opportunities could not be linked to a source folder at all: the column
-- existed on projects and steel_deals and was simply missing here, so the M&A
-- deals -- exactly where loose documents arrive by email -- could not
-- participate in any of it.
alter table opportunities add column if not exists drive_source_folder_id text;
alter table opportunities add column if not exists drive_source_folder_url text;

-- Parity for opportunity documents so they can take part in change detection
-- and in the publish/import loop guard. `documents` has carried these since the
-- Drive work; opportunity_documents was the narrower mirror and was left behind.
alter table opportunity_documents add column if not exists drive_file_id text;
alter table opportunity_documents add column if not exists drive_modified_at timestamptz;
alter table opportunity_documents add column if not exists embedding_status text default 'pending';
alter table opportunity_documents add column if not exists superseded_at timestamptz;
alter table opportunity_documents add column if not exists superseded_reason text;

-- Mirrors the platform-wide unique index on documents.drive_file_id. Without it
-- a file reachable by two paths in one tree imports twice.
create unique index if not exists idx_opportunity_documents_drive_file
  on opportunity_documents (drive_file_id) where drive_file_id is not null;

-- The filer and the nightly reconcile both ask "what has not been filed yet",
-- which is a scan of a growing table without these.
create index if not exists idx_documents_unfiled
  on documents (project_id) where drive_file_id is null;
create index if not exists idx_opportunity_documents_unfiled
  on opportunity_documents (opportunity_id) where drive_file_id is null;
