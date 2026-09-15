-- Per-person activity notifications.
--
-- The platform had no way to tell one teammate what another had just done. A
-- document filed in Drive reached the project silently: the sync posted one
-- update to the project's feed, which nobody reads unless they are already on
-- that project. This is the inbox — one row per recipient per event, dismissed
-- individually, with a link straight to the thing that happened.
--
-- One row PER RECIPIENT rather than one row plus a read-receipt table: the
-- audience is two people today and a handful at most, and per-recipient rows
-- make "my unread count" a single indexed count instead of an anti-join.

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  team_member_id uuid not null references team_members(id) on delete cascade,

  -- What happened. Plain text with app-side constants, following the vocabulary
  -- convention used by opportunities/steel/leads — a check constraint here would
  -- mean a migration every time a new kind of activity is worth announcing.
  kind text not null default 'document_added',

  title text not null,
  body text,

  -- Where clicking it goes inside the platform (a project's Documents tab, the
  -- company knowledge base). Null for an event with no in-app home.
  href text,

  -- The original in Google Drive, when the document came from there. Offered as
  -- a second link, never as the primary one: most of the team reads Drive, but
  -- the platform copy carries the AI summary.
  external_url text,

  -- Who did it, denormalised. The actor is frequently NOT a team_member (a file
  -- modified by info@, or by an outside collaborator on a shared folder), so a
  -- foreign key would force those events to be announced anonymously.
  actor_name text,

  -- Deleting the document makes the notification meaningless — cascade rather
  -- than leave a row whose link 404s.
  document_id uuid references documents(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,

  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

-- The inbox query: one person's undismissed rows, newest first.
create index if not exists idx_notifications_inbox
  on notifications (team_member_id, created_at desc)
  where dismissed_at is null;

alter table notifications enable row level security;

drop policy if exists "Authenticated users can manage notifications" on notifications;
create policy "Authenticated users can manage notifications" on notifications
  for all using (auth.role() = 'authenticated') with check (true);

-- Deliberately NO log_activity() trigger: that function dereferences
-- new.project_id on tables that have one meaning a project record, and an
-- audit-logged notification would double every event in the activity feed.
