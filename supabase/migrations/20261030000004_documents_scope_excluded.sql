-- A TOMBSTONE IS A SCOPE (2026-10-30)
--
-- ⚠ NO UNPARENTED DOCUMENT COULD EVER BE SET ASIDE, and nothing reported it.
--
-- `documents_scope_check` demands every row say what it is OF:
--
--   project_id | entity_id | is_company | is_reference | meeting_id |
--   steel_deal_id | awaiting_filing
--
-- `awaiting_filing` is the newest member (20261025000012) and means "off-deal
-- mail, parent not yet decided" — the one positive discriminator /decide reads.
-- For the 419 rows in that state it is the ONLY satisfied member: project_id,
-- entity_id, meeting_id and steel_deal_id are all NULL and both booleans false.
--
-- `excludeDocument()` sets `excluded_at` AND clears `awaiting_filing`, because
-- a tombstone that still claims to be awaiting a filing decision is a lie. On
-- any other row that is fine — a project document keeps its `project_id`. On an
-- unparented one it removes the row's last scope, so the UPDATE is refused
-- outright with `23514` and the whole exclusion fails.
--
-- Measured before changing anything: 22 rows carry `excluded_at` today and ALL
-- 22 are scoped some other way, which is exactly why this was never hit — the
-- only population that can reach it is the unparented queue, and nobody had
-- ever successfully set one of those aside. The attempt that found it was a
-- backfill retiring 58 junk attachments: all 58 failed, 0 chunks removed, no
-- partial write.
--
-- ⚠ THE FIX IS A NEW MEMBER, NOT A FLAG THAT MERELY SATISFIES THE CHECK. §12:
-- where a CHECK enumerates scopes, a new state needs a new member, and reusing
-- a purpose flag breaks the surface reading it. `is_reference = true` would
-- have passed the constraint and lied to every reader of the reference library;
-- `awaiting_filing = true` would have kept the row in the queue it was being
-- removed from. "This row has been set aside" is a legitimate terminal scope
-- and now says so.
--
-- ⚠ DROP AND RE-ADD UNDER THE SAME NAME — a CHECK has no `create or replace`.

begin;

alter table documents drop constraint if exists documents_scope_check;

alter table documents add constraint documents_scope_check check (
  project_id is not null
  or entity_id is not null
  or is_company
  or is_reference
  or meeting_id is not null
  or steel_deal_id is not null
  or awaiting_filing
  -- The new member. A row with a tombstone has been decided about and is no
  -- longer OF anything; demanding it still name a parent is demanding it stay
  -- in a queue it was taken out of.
  or excluded_at is not null
);

commit;
