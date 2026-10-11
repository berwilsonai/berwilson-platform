-- MCP server: scoped, audited, read-only access for an external assistant.
--
-- WHY VIEWS AND NOT JUST APPLICATION CODE. The platform's containment is applied
-- per-call-site by convention — `hiddenProjectIds(null)`, `dropHidden`,
-- `readOpenCommitments` — and three separate call sites had already been found
-- missing it. That is survivable for internal surfaces. It is not survivable for
-- a surface reachable by something outside the box, and it is not defensible to
-- an auditor who asks "what stops a protected project leaving?" and the answer
-- is "we remembered to filter in seven places".
--
-- So the exclusion lives in SQL. The MCP layer selects ONLY from these views and
-- never from a base table. A forgotten filter in new code cannot widen them,
-- because the predicate is not in the code.
--
-- ⚠ THIS IS NOT A CUI CONTROL. A view is a confidentiality measure for
-- commercial work. CUI requires that the data not be reachable by an external
-- service at all — see §8's GovCloud trigger. Do not read these views as making
-- government work safe to expose.

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

create table if not exists mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  -- The token itself is NEVER stored. sha256 hex of the presented secret, the
  -- same discipline as commitment_action_tokens.
  token_sha256 text not null unique,
  label text not null,
  -- Which tools this credential may call. An empty array means none: a token
  -- with no scope is useless rather than unlimited.
  scopes text[] not null default '{}',
  -- Short-lived on purpose. A long-lived bearer token held in a cloud
  -- assistant's config is the weakest credential in this system.
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid
);

comment on table mcp_tokens is
  'Bearer credentials for the MCP server. Hash only, scoped, expiring, revocable.';

create index if not exists idx_mcp_tokens_live
  on mcp_tokens (token_sha256) where revoked_at is null;

-- One-row global kill switch. A config flag would need a restart to take
-- effect; this takes effect on the next request, which is what "instantly
-- disable" has to mean.
create table if not exists mcp_runtime (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  disabled_reason text,
  updated_at timestamptz not null default now()
);

-- Default OFF. The server exists but answers nothing until somebody turns it
-- on deliberately.
insert into mcp_runtime (id, enabled, disabled_reason)
values (true, false, 'Not yet enabled.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Audit. Append-only, like activity_log: no update or delete policy, ever.
-- ---------------------------------------------------------------------------

create table if not exists mcp_audit (
  id uuid primary key default gen_random_uuid(),
  token_id uuid references mcp_tokens(id) on delete set null,
  token_label text,
  tool text not null,
  arguments jsonb not null default '{}'::jsonb,
  -- The COUNT and the IDS of what went out, so "what has this credential seen?"
  -- is answerable without storing the content itself.
  records_returned integer not null default 0,
  record_ids uuid[] not null default '{}',
  -- How many rows the containment filter held back on this call. §12:
  -- withholding means handing over the count.
  records_withheld integer not null default 0,
  outcome text not null check (outcome in ('ok', 'refused', 'error')),
  detail text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

comment on table mcp_audit is
  'Every MCP tool call. Append-only — this is the record of what left the box.';

create index if not exists idx_mcp_audit_time on mcp_audit (created_at desc);
create index if not exists idx_mcp_audit_token on mcp_audit (token_id, created_at desc);

alter table mcp_tokens enable row level security;
alter table mcp_runtime enable row level security;
alter table mcp_audit enable row level security;

-- ---------------------------------------------------------------------------
-- The exposed surface. Two tiers only: in these views, or invisible.
--
-- There is deliberately no `summary_only` tier. A middle tier that hands model
-- prose to an external assistant is not a privacy tier — a denylist over
-- free-form text cannot catch "the counterparty wants to close on the first of
-- November", which names no project and discloses a negotiating position.
-- ---------------------------------------------------------------------------

create or replace view mcp_projects as
select
  p.id,
  p.name,
  p.stage::text   as stage,
  p.status::text  as status,
  p.sector::text  as sector,
  p.location,
  p.bid_due_date,
  p.win_probability,
  (
    select min(m.target_date)
    from milestones m
    where m.project_id = p.id
      and m.completed_at is null
      and m.target_date >= current_date
  ) as next_milestone_date,
  (
    select count(*)
    from tasks t
    where t.project_id = p.id and t.status <> 'done'
  ) as open_task_count
from projects p
where p.confidential is not true;

comment on view mcp_projects is
  'Projects an external assistant may see. Protected projects are excluded in SQL.';

-- Tasks.
--
-- ⚠ THE PARENT RULE IS MEASURED, AND THE FIRST VERSION OF IT WAS WRONG. Live
-- counts on 2026-10-11: 46 tasks — 5 on a project, 3 on an opportunity, 27 on a
-- LEAD, and 11 with no parent at all. The first rule withheld every non-project
-- parent as "unverifiable" and exposed 16 of 46, which is a tool not worth
-- having. The mistake was treating absence of a flag as a withheld answer:
-- `confidential` exists ONLY on projects, so for a lead or an opportunity there
-- is no protection status to fail to determine. Withholding them protected
-- nothing and cost 65% of the table.
--
-- So there is one rule, applied by what is actually knowable:
--   * task on a project → exposed iff that project is not protected. The flag
--                         is authoritative and nothing else is consulted.
--   * everything else   → exposed unless the task's OWN TEXT names a protected
--                         project. That text check is the only check available
--                         for a row with no project, and it is also the only
--                         thing that catches a task written about a protected
--                         deal with no link to it — which a pure FK filter
--                         cannot see at all.
create or replace view mcp_tasks as
select
  t.id,
  t.title,
  t.what,
  t.why,
  t.status,
  t.due_date,
  t.project_id,
  p.name as project_name,
  tm.name as assignee_name
from tasks t
left join projects p on p.id = t.project_id
left join team_members tm on tm.id = t.assignee_id
where
  case
    when t.project_id is not null then p.confidential is not true
    else not exists (
      select 1
      from projects c
      where c.confidential
        and (
          t.title ilike '%' || c.name || '%'
          or coalesce(t.what, '') ilike '%' || c.name || '%'
          or coalesce(t.why, '') ilike '%' || c.name || '%'
        )
    )
  end;

comment on view mcp_tasks is
  'Tasks an external assistant may see. A task on a protected project is excluded by the flag; any task without a project is excluded if its own text names a protected project.';

-- §12: a table or view created by anything but `postgres` receives NO api
-- grants and every PostgREST call answers 42501. Granted explicitly so that is
-- never the mystery.
grant select on mcp_projects to anon, authenticated, service_role;
grant select on mcp_tasks to anon, authenticated, service_role;
