-- Meetings can stage candidate deals as LEADS.
--
-- A call with a site-selection broker names a dozen properties at once. None of
-- them is a pursuit yet, and promoting them to projects is what put $50B of
-- notional pipeline on the dashboard (see src/lib/leads/promote.ts). They belong
-- in the lead queue, where the existing score phase fit-assesses each one and a
-- human promotes the few worth capture effort.
--
-- `leads.source` carried a CHECK allowing only 'email' and 'web_form', so an
-- insert from the meeting confirm step would typecheck, deploy, and then fail at
-- runtime (§12 — a new discriminator value means checking for a CHECK on it).
--
-- Nothing else needs to move: `thread_id` is already nullable and every
-- Gmail-facing consumer filters on `.not('thread_id','is',null)`, which is how
-- web-form leads have worked since 09-05.
alter table leads drop constraint if exists leads_source_check;
alter table leads add constraint leads_source_check
  check (source in ('email', 'web_form', 'meeting'));
