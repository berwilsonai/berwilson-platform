-- Remove the task handoff ("waiting on") feature.
--
-- Shipped 2026-07-13 to answer a real problem — Richard was hand-routing work
-- between people who cannot reach the tailnet — and then used exactly zero
-- times: not one row has ever carried a waiting_on_id in the two months since.
-- The problem was real; this was not the answer to it. Google Tasks now puts
-- each person's list on their own phone, which addresses the same need without
-- anyone having to record a handoff in a system they cannot open.
--
-- It also had no Google equivalent, so keeping it would have meant a field that
-- is permanently invisible from the surface the work now lives on.
--
-- Dropping the columns takes the FK to team_members with them, which removes
-- the SECOND foreign key from tasks to that table. Note for anyone adding one
-- back: while two existed, every PostgREST embed of team_members from tasks had
-- to name its constraint (assignee:team_members!tasks_assignee_id_fkey) or fail
-- at runtime with PGRST201. Those hints are now merely redundant, not required —
-- leave them, since a future second FK would need them again.

alter table tasks drop column if exists waiting_on_id;
alter table tasks drop column if exists waiting_on_what;
alter table tasks drop column if exists waiting_on_since;
