-- A meeting can exist before anyone has decided which deal it belongs to.
--
-- WHY. Every Meet transcript the platform has ever imported — 5 of them — became
-- a staged intake session and NOTHING ELSE. The only INSERT into `meetings` is
-- the hand-typed form at POST /api/meetings, so the table holds 2 rows from July
-- and August while real calls accumulate elsewhere. That matters because
-- `meetings` is what the agent's `search_meetings` / `get_meeting_content` tools
-- read: ask Ber AI "what did we agree with Tensor" and the meeting tools answer
-- nothing, for a call that happened yesterday.
--
-- The blocker was this table's own shape. `meetings_scope_target_check` allows
-- exactly three arms — company with no record, project with a project, or
-- opportunity with an opportunity — so a call whose title names no record had
-- nowhere legal to sit. The 'company' arm is NOT the answer: /company/board
-- selects `scope = 'company'` as the corporate record, and filing deal calls
-- there would put a brokerage conversation in the governance register.
--
-- So 'unfiled' is a fourth arm meaning "a real meeting, not yet attached to a
-- record". Every record-scoped page filters on project_id/opportunity_id and the
-- board filters on scope='company', so none of them change; the agent reads
-- every scope, so the call becomes answerable the night it happens. Confirming
-- the session in /intake moves the row onto the record it chose.
--
-- ⚠ ADDING A VALUE TO A DISCRIMINATOR MEANS A MIGRATION (§12) — a new value
-- typechecks, deploys, and then fails at every INSERT. Both CHECKs are replaced
-- here because `scope` is named in two of them.

alter table meetings drop constraint meetings_scope_check;
alter table meetings
  add constraint meetings_scope_check
  check (scope = any (array['company'::text, 'project'::text, 'opportunity'::text, 'unfiled'::text]));

alter table meetings drop constraint meetings_scope_target_check;
alter table meetings
  add constraint meetings_scope_target_check
  check (
    (scope = 'company' and project_id is null and opportunity_id is null)
    or (scope = 'project' and project_id is not null and opportunity_id is null)
    or (scope = 'opportunity' and opportunity_id is not null and project_id is null)
    -- An unfiled meeting is on NEITHER, by definition. Stated rather than left
    -- unconstrained so a row carrying a record while still claiming to be
    -- unfiled cannot exist — that row would be invisible to the filing queue
    -- and present on the record at the same time.
    or (scope = 'unfiled' and project_id is null and opportunity_id is null)
  );
