-- notification_log shipped 2026-08-18 with NO grants for the API roles, so every
-- PostgREST call against it failed with 42501 from the day it shipped.
--
-- Root cause: the table is owned by `supabase_admin` while every other public
-- table is owned by `postgres`. The default privileges that automatically grant
-- anon/authenticated/service_role are attached to `postgres`, so a table created
-- under a different owner silently receives none — and `postgres` then cannot
-- grant on it either ("no privileges were granted"). Applying a migration as
-- anything other than `postgres` reintroduces this.
--
-- Two silent consequences, both fixed here:
--   1. The task digest's once-per-day idempotency insert always failed. Its
--      error is discarded by the caller, so the run still reported `sent` while
--      the guarantee never held — a second cron fire in a day re-sends it.
--   2. /settings/health reads this table for its Task Digest card, so that card
--      could never report a successful send.
alter table public.notification_log owner to postgres;
grant all on table public.notification_log to anon, authenticated, service_role;
