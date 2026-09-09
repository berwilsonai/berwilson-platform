-- Drive source folders + document supersession.
--
-- Two gaps this closes.
--
-- 1. The team files documents in their own Drive folders (a shared drive
--    organised by business line), and the platform read none of it. The only
--    inbound path was `projects.deal_folder_id`, set solely by the website deal
--    form, and no project had one. `drive_source_folder_id` is the folder a
--    human explicitly links a project to, and is deliberately SEPARATE from
--    `drive_folder_id` (where the platform publishes TO): the two point at
--    different places and conflating them would make publishing overwrite the
--    team's own filing.
--
--    Linked by hand rather than matched by name because the real folder names
--    are provably ambiguous — "Myton - Utah" has two candidate projects, so does
--    "Stockton, Utah", and West Wendover appears in two separate trees.
--
-- 2. A document can now be RETIRED without being deleted. Superseding drops its
--    chunks so Ber AI stops citing it, while the file stays on the record and in
--    storage. That is what makes the Drive-side "drag it into Archive" gesture
--    work for people who have no platform login.

alter table projects add column if not exists drive_source_folder_id text;
alter table projects add column if not exists drive_source_folder_url text;

create index if not exists idx_projects_drive_source
  on projects (drive_source_folder_id)
  where drive_source_folder_id is not null;

alter table documents add column if not exists superseded_at timestamptz;
alter table documents add column if not exists superseded_reason text;

-- Partial: the overwhelming majority of documents are current, and every read
-- that cares filters for the exception.
create index if not exists idx_documents_superseded
  on documents (superseded_at)
  where superseded_at is not null;

comment on column projects.drive_source_folder_id is
  'The team''s own Drive folder, imported FROM nightly. Not the same as drive_folder_id, which is where the platform publishes TO.';
comment on column documents.superseded_at is
  'Retired but not deleted: chunks removed so it is no longer retrieved, file kept on the record.';
