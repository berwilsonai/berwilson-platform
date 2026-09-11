-- Google Tasks sync — one task list per team member, two-way.
--
-- Why: Ber Intelligence is tailnet-only and most of the team cannot reach it.
-- A task assigned here is, for anyone without a login, invisible. Google Tasks
-- renders in the Gmail sidebar, the Calendar sidebar and a phone app — places
-- the team already is — so this pushes each person's slice of the board into
-- their own Google account and reads their completions back.
--
-- The combined view stays here. Google Tasks lists are private per account:
-- there is no shared list, no assignee field, no delegation. /tasks remains the
-- only place the whole board can exist.
--
-- WHY A SIDE TABLE AND NOT COLUMNS ON `tasks`
--
-- `tasks` carries both set_updated_at and log_tasks -> log_activity(). Every
-- piece of sync bookkeeping ("pushed it, here is the remote id, here is the new
-- agreed base") would bump updated_at and insert an activity_log row — and
-- activity_log is append-only by design, with no delete policy, ever. At a
-- 15-minute cadence that is thousands of unremovable junk audit rows a week on
-- top of a corrupted updated_at. Two further reasons: reassignment has to hold
-- the OLD list's task id and the NEW one at the same moment, and the detach
-- latch is per (task, member) — neither is expressible in one set of columns.

-- ── 1. google_task_lists — one row per connected member ─────────────────────
-- A member appears here only once they have consented and a list exists in
-- their account. No row is the normal state for most of the team, and the
-- health probe counts exactly that (activeMembers - rows).
create table if not exists google_task_lists (
  team_member_id uuid primary key references team_members(id) on delete cascade,

  -- The account actually consented, which need not equal team_members.email —
  -- that column is the CRM's idea of a person's address and has been wrong
  -- before. This is the one the credential is filed under.
  mailbox text not null,

  -- The member's DEFAULT list ("My Tasks"), resolved from Google's @default
  -- alias on first sight and then addressed by its real id forever. We never
  -- create a list: syncing the default one is what makes capture work, since
  -- the Gmail sidebar, the phone app and Assistant all write there. Storing the
  -- resolved id rather than the alias means a rename does not read as a
  -- different list, and matching by TITLE is never safe here — unlike contact
  -- groups, task list names are not unique within an account.
  google_list_id text not null,
  title text not null,

  last_synced_at timestamptz,

  -- Reserved. `updatedMin` is a fetch optimisation, not a decision rule, and at
  -- this scale (a handful of members, low hundreds of tasks) listing everything
  -- every run is ~20 calls and self-healing. A cursor silently skips whatever
  -- landed in the window of an interrupted run. Populate only if volume ever
  -- justifies it, and only after a fully complete pass.
  updated_min timestamptz,

  -- The stored list 404'd. Sync is PAUSED for this member and no replacement is
  -- created: someone who deletes the whole list is saying stop, and recreating
  -- it and re-pushing everything is the maximal version of the resurrection
  -- this design forbids. Cleared by a human.
  missing_at timestamptz,
  last_error text,

  created_at timestamptz default now()
);

-- One list is owned by at most one member. Catches a mailbox pointed at a list
-- another row already claims, which would make two members fight over it.
create unique index if not exists uq_google_task_lists_remote
  on google_task_lists (google_list_id);

-- ── 2. task_google_links — one row per (task, member) attempt ───────────────
create table if not exists task_google_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,

  google_list_id text not null,
  google_task_id text not null,

  -- 'active'   — synced.
  -- 'detached' — the member deleted it in their own Google Tasks. A LATCH:
  --              never resurrected, never re-pushed to this member. Deleting it
  --              WAS the decision. Cleared only by an explicit human action
  --              (POST /api/tasks/[id]/resync-google).
  -- 'orphaned' — the platform moved the task away (reassigned, unassigned or
  --              deleted) and the remote copy must go. A STATE rather than an
  --              immediate delete so that a delete which fails on a momentarily
  --              broken token is retried instead of leaking a task into
  --              somebody's list forever.
  state text not null default 'active'
    check (state in ('active', 'detached', 'orphaned')),

  -- THE SHADOW: the last values both sides agreed on. This is the whole answer
  -- to ping-pong. Stored as values, not a hash, because a hash can tell you
  -- that something changed but not WHICH side changed it — and a three-way
  -- merge needs exactly that. Timestamps were rejected for a harder reason:
  -- our own writeback bumps tasks.updated_at, and comparing a microsecond
  -- timestamptz against Google's second-granularity `updated` loses any edit
  -- landing inside the boundary, silently and permanently. A stale shadow
  -- costs one redundant idempotent write; a stale cursor costs a lost edit.
  base_status text,
  base_due date,

  -- 'platform' — we created it. 'google' — the member wrote it in the list on
  -- their phone and we imported it.
  origin text not null default 'platform'
    check (origin in ('platform', 'google')),

  detached_at timestamptz,
  detach_reason text,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz default now()
);

-- A remote task belongs to exactly one link, ever. The anti-duplicate backstop
-- for inbound create: a second import of the same Google task fails loudly here
-- rather than quietly producing a second copy on the board.
create unique index if not exists uq_task_google_links_remote
  on task_google_links (google_list_id, google_task_id);

-- A task lives in AT MOST ONE list at a time. This is what makes reassignment
-- safe: the old link must be orphaned before the new one can be created, so the
-- ordering is enforced by the database rather than by the order of statements.
create unique index if not exists uq_task_google_links_active
  on task_google_links (task_id)
  where state = 'active';

create index if not exists idx_task_google_links_member
  on task_google_links (team_member_id, state);

-- The board marker reads this and nothing else.
create index if not exists idx_task_google_links_detached
  on task_google_links (task_id)
  where state = 'detached';

-- Neither table gets log_activity(): that trigger dereferences new.project_id,
-- which neither has. Same reason opportunities, investors, dino and the sweep
-- tables leave it off.
alter table google_task_lists enable row level security;
drop policy if exists "google_task_lists_select" on google_task_lists;
create policy "google_task_lists_select" on google_task_lists
  for select using (auth.role() = 'authenticated');

alter table task_google_links enable row level security;
drop policy if exists "task_google_links_select" on task_google_links;
create policy "task_google_links_select" on task_google_links
  for select using (auth.role() = 'authenticated');

comment on table google_task_lists is
  'One Google Tasks list per connected team member. No row = that member has not consented; that is the normal state for most of the team.';
comment on column google_task_lists.missing_at is
  'The list was deleted in Google. Sync is paused for this member and the list is NEVER auto-recreated — deleting it was the decision.';
comment on table task_google_links is
  'Links one platform task to one member''s Google task. Carries the shadow (base_status/base_due) the three-way merge resolves against.';
comment on column task_google_links.state is
  'active = synced; detached = member deleted it in Google (a latch, never resurrected); orphaned = platform moved it away, remote copy still to be deleted.';
comment on column task_google_links.base_status is
  'Last status both sides agreed on. Set after every successful push or pull — failing to do so is the only way to reintroduce a sync loop.';
