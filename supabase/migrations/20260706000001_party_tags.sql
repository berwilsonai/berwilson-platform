-- Tags on contacts: free-form labels (Auditor, Plumber, Roofer, …) whose
-- vocabulary is self-maintaining — the tag list is whatever is in use.
-- Mirrors the entities.specialties text[] idiom on the vendors side.

alter table parties add column if not exists tags text[] not null default '{}';

create index if not exists idx_parties_tags on parties using gin (tags);
