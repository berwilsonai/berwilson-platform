-- Notification log: idempotency + audit for outbound member notifications.
-- Written by the /api/cron/task-digest cron (launchd, weekday mornings) — one
-- row per member per day it is sent a task digest. The cron checks
-- (team_member_id, kind, sent_date) before sending so a second run the same day
-- never double-sends. Also feeds a freshness card on /settings/health.
--
-- Background table: only the app/cron writes it. No updated_at / log_activity()
-- triggers (log_activity dereferences new.project_id, which this lacks).

create table if not exists notification_log (
  id uuid default gen_random_uuid() primary key,
  team_member_id uuid references team_members(id) on delete cascade,
  channel text not null,                              -- 'email' (telegram later)
  kind text not null default 'task_digest',           -- notification type
  task_count int,                                     -- how many tasks the digest carried
  sent_date date not null default (now() at time zone 'utc')::date,
  status text not null default 'sent',                -- 'sent' | 'failed'
  error text,                                         -- populated when status = 'failed'
  created_at timestamptz default now()
);

create index if not exists idx_notification_log_member_kind_date
  on notification_log(team_member_id, kind, sent_date);
create index if not exists idx_notification_log_kind_date
  on notification_log(kind, sent_date desc);

-- RLS — authenticated full access (app traffic uses the service role; RLS is
-- defense-in-depth per CLAUDE.md §8).
alter table notification_log enable row level security;
create policy "notification_log_select" on notification_log for select using (auth.role() = 'authenticated');
create policy "notification_log_insert" on notification_log for insert with check (auth.role() = 'authenticated');
create policy "notification_log_update" on notification_log for update using (auth.role() = 'authenticated');
create policy "notification_log_delete" on notification_log for delete using (auth.role() = 'authenticated');
