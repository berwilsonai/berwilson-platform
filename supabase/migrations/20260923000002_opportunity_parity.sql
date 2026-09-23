-- Opportunities gain the same child records projects have.
--
-- An acquisition needs players, a diligence checklist, a capital structure,
-- the entities involved and a timeline just as much as a construction project
-- does — arguably more. Until now those five tables were hard-wired to
-- `project_id NOT NULL`, so the only way to record any of it against a deal
-- was to invent a project.
--
-- Shape: ADD a nullable `opportunity_id` beside `project_id` and relax the
-- NOT NULL, exactly as `tasks` did on 2026-06-27 and `documents` did for
-- meetings and steel deals. The alternative — parallel `opportunity_players`,
-- `opportunity_milestones`, … tables — would fork every query, every API
-- route and every component, which is the failure mode this codebase has
-- already paid for twice (the runDocumentAiPass fork, the duplicated
-- formatDate). One table, one reader, a scope column.
--
-- The activity trigger needs no change: it reads project_id through
-- `to_jsonb(new)->>'project_id'`, which is null-safe, and activity_log.project_id
-- is already nullable — an opportunity-scoped row simply logs without a project.

-- ── project_players ──────────────────────────────────────────────────────────
alter table project_players alter column project_id drop not null;
alter table project_players add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_project_players_opportunity on project_players(opportunity_id);
-- The table's own `unique(project_id, party_id, role)` stops guarding the
-- opportunity side the moment project_id is NULL — Postgres treats NULLs as
-- distinct, so the same person could be added to a deal twice in the same role.
create unique index if not exists uniq_project_players_opportunity
  on project_players(opportunity_id, party_id, role) where opportunity_id is not null;
alter table project_players drop constraint if exists project_players_scope_check;
alter table project_players add constraint project_players_scope_check
  check (num_nonnulls(project_id, opportunity_id) = 1);

-- ── milestones ───────────────────────────────────────────────────────────────
-- `stage` groups a milestone under a phase of the record's pipeline. Projects
-- use the 7-value project_stage enum; opportunities use their own 6-stage deal
-- pipeline, which lives in app constants as plain text like every other
-- vocabulary added since (opportunities, steel, leads). Widening the column to
-- text is what lets one table carry both — the existing enum values survive
-- verbatim as strings, so nothing that reads a project milestone changes.
alter table milestones alter column stage type text using stage::text;
alter table milestones alter column project_id drop not null;
alter table milestones add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_milestones_opportunity on milestones(opportunity_id);
alter table milestones drop constraint if exists milestones_scope_check;
alter table milestones add constraint milestones_scope_check
  check (num_nonnulls(project_id, opportunity_id) = 1);

-- ── dd_items ─────────────────────────────────────────────────────────────────
alter table dd_items alter column project_id drop not null;
alter table dd_items add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_dd_items_opportunity on dd_items(opportunity_id);
alter table dd_items drop constraint if exists dd_items_scope_check;
alter table dd_items add constraint dd_items_scope_check
  check (num_nonnulls(project_id, opportunity_id) = 1);

-- ── financing_structures ─────────────────────────────────────────────────────
alter table financing_structures alter column project_id drop not null;
alter table financing_structures add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_financing_opportunity on financing_structures(opportunity_id);
alter table financing_structures drop constraint if exists financing_structures_scope_check;
alter table financing_structures add constraint financing_structures_scope_check
  check (num_nonnulls(project_id, opportunity_id) = 1);

-- ── entity_projects ──────────────────────────────────────────────────────────
alter table entity_projects alter column project_id drop not null;
alter table entity_projects add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_entity_projects_opportunity on entity_projects(opportunity_id);
create unique index if not exists uniq_entity_projects_opportunity
  on entity_projects(opportunity_id, entity_id, relationship) where opportunity_id is not null;
alter table entity_projects drop constraint if exists entity_projects_scope_check;
alter table entity_projects add constraint entity_projects_scope_check
  check (num_nonnulls(project_id, opportunity_id) = 1);

-- ── compliance_items ─────────────────────────────────────────────────────────
-- project_id is already nullable here: a NULL means a company-level obligation
-- rather than a missing scope, so this one is "at most one", not "exactly one".
alter table compliance_items add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_compliance_items_opportunity on compliance_items(opportunity_id);
alter table compliance_items drop constraint if exists compliance_items_scope_check;
alter table compliance_items add constraint compliance_items_scope_check
  check (num_nonnulls(project_id, opportunity_id) <= 1);

-- ── research_artifacts ───────────────────────────────────────────────────────
-- Same reasoning: a NULL project_id is an unscoped research run, not a fault.
alter table research_artifacts add column if not exists opportunity_id uuid
  references opportunities(id) on delete cascade;
create index if not exists idx_research_artifacts_opportunity on research_artifacts(opportunity_id);
alter table research_artifacts drop constraint if exists research_artifacts_scope_check;
alter table research_artifacts add constraint research_artifacts_scope_check
  check (num_nonnulls(project_id, opportunity_id) <= 1);
