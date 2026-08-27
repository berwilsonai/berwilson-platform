-- Google Workspace integrations: Gmail label/draft sync, Drive record folders,
-- Meet transcript import, and directory → Workspace contact sync.
--
-- All additive. Every column here records what the platform has ALREADY done to
-- something outside itself — a label applied, a folder created, a contact
-- written — which is what makes each of those writes idempotent across runs.
-- Without them a daily cron re-labels, re-folders and re-creates forever.

-- ---------------------------------------------------------------------------
-- Leads → Gmail
-- ---------------------------------------------------------------------------

-- The verdict label last written to the thread. Compared against the desired
-- label each run, so an unchanged lead costs nothing and a lead whose verdict
-- moved gets relabelled exactly once.
alter table leads add column if not exists gmail_label text;
alter table leads add column if not exists gmail_labeled_at timestamptz;

-- The draft reply left in the mailbox for a human to send. Presence of an id is
-- what stops a second draft being created for the same lead; it is never sent
-- by the platform.
alter table leads add column if not exists gmail_draft_id text;
alter table leads add column if not exists draft_created_at timestamptz;

-- ---------------------------------------------------------------------------
-- Records → Drive
-- ---------------------------------------------------------------------------

-- A Drive folder holding the record's documents, reachable by people who cannot
-- reach the tailnet. The URL is stored alongside the id so the UI can link
-- without a round trip to Google.
alter table projects add column if not exists drive_folder_id text;
alter table projects add column if not exists drive_folder_url text;

alter table opportunities add column if not exists drive_folder_id text;
alter table opportunities add column if not exists drive_folder_url text;

alter table steel_deals add column if not exists drive_folder_id text;
alter table steel_deals add column if not exists drive_folder_url text;

-- Which documents have already been published to that folder, so re-publishing
-- uploads only what is new rather than duplicating the whole set.
alter table documents add column if not exists drive_published_id text;
alter table opportunity_documents add column if not exists drive_published_id text;

-- ---------------------------------------------------------------------------
-- Meet transcripts → meetings
-- ---------------------------------------------------------------------------

-- The Drive file a meeting record was imported from. Unique, so the importer is
-- idempotent no matter how often it runs or how it is interrupted.
alter table meetings add column if not exists drive_file_id text;

create unique index if not exists meetings_drive_file_id_key
  on meetings (drive_file_id)
  where drive_file_id is not null;

-- ---------------------------------------------------------------------------
-- Directory → Workspace contacts
-- ---------------------------------------------------------------------------

-- Map of mailbox → People API resourceName for this party. A party can exist in
-- several mailboxes' contacts at once and each has its own id, so this is an
-- object rather than a single column.
alter table parties add column if not exists google_contacts jsonb not null default '{}'::jsonb;

-- A fingerprint of the fields last pushed. Contacts change rarely, and a nightly
-- sync that PATCHes every party every night would burn quota and rewrite history
-- in everyone's contacts for nothing.
alter table parties add column if not exists google_contacts_hash text;
