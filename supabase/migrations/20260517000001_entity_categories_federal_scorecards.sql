-- =============================================================================
-- Migration: Entity Categories + Federal Scorecards
-- Separates entities into Vendor / Partner / Contractor categories
-- Adds federal scorecard system based on:
--   - USACE Quality Management (ER 1180-1-6 / EP 715-1-7)
--   - DoD 385-1-1 Safety & Occupational Health
-- Projects default to applicable standards on creation
-- =============================================================================

-- 1. Entity category enum
create type entity_category as enum ('vendor', 'partner', 'contractor');

-- 2. Add category column to entities (default 'vendor' for existing records)
alter table entities add column category entity_category not null default 'vendor';

-- 3. Scorecard rating scale: 0-5 (0 = not evaluated, 1 = unsatisfactory, 5 = exceptional)
-- Federal scorecard table — one scorecard per entity per project per standard
create table federal_scorecards (
  id uuid default gen_random_uuid() primary key,
  entity_id uuid references entities(id) on delete cascade not null,
  project_id uuid references projects(id) on delete cascade,
  standard text not null,  -- 'usace_qm' or 'dod_385'

  -- Overall
  overall_rating numeric(3,1) check (overall_rating >= 0 and overall_rating <= 5),
  evaluation_period_start date,
  evaluation_period_end date,
  evaluator_name text,
  evaluator_title text,

  -- USACE Quality Management criteria (ER 1180-1-6)
  -- Each scored 0-5
  qm_qc_plan numeric(3,1) check (qm_qc_plan >= 0 and qm_qc_plan <= 5),
  qm_three_phase_inspection numeric(3,1) check (qm_three_phase_inspection >= 0 and qm_three_phase_inspection <= 5),
  qm_testing_compliance numeric(3,1) check (qm_testing_compliance >= 0 and qm_testing_compliance <= 5),
  qm_deficiency_tracking numeric(3,1) check (qm_deficiency_tracking >= 0 and qm_deficiency_tracking <= 5),
  qm_documentation numeric(3,1) check (qm_documentation >= 0 and qm_documentation <= 5),
  qm_rework_rate numeric(3,1) check (qm_rework_rate >= 0 and qm_rework_rate <= 5),
  qm_material_compliance numeric(3,1) check (qm_material_compliance >= 0 and qm_material_compliance <= 5),
  qm_submittal_timeliness numeric(3,1) check (qm_submittal_timeliness >= 0 and qm_submittal_timeliness <= 5),
  qm_notes text,

  -- DoD 385-1-1 Safety & Health criteria
  -- Each scored 0-5
  sh_accident_prevention_plan numeric(3,1) check (sh_accident_prevention_plan >= 0 and sh_accident_prevention_plan <= 5),
  sh_activity_hazard_analysis numeric(3,1) check (sh_activity_hazard_analysis >= 0 and sh_activity_hazard_analysis <= 5),
  sh_safety_training numeric(3,1) check (sh_safety_training >= 0 and sh_safety_training <= 5),
  sh_ppe_compliance numeric(3,1) check (sh_ppe_compliance >= 0 and sh_ppe_compliance <= 5),
  sh_incident_rate numeric(3,1) check (sh_incident_rate >= 0 and sh_incident_rate <= 5),
  sh_site_inspections numeric(3,1) check (sh_site_inspections >= 0 and sh_site_inspections <= 5),
  sh_osha_compliance numeric(3,1) check (sh_osha_compliance >= 0 and sh_osha_compliance <= 5),
  sh_corrective_actions numeric(3,1) check (sh_corrective_actions >= 0 and sh_corrective_actions <= 5),
  sh_notes text,

  -- Metrics (raw numbers for reference)
  dart_rate numeric(6,2),         -- Days Away, Restricted, or Transferred rate
  trir numeric(6,2),              -- Total Recordable Incident Rate
  emr numeric(4,2),               -- Experience Modification Rate
  rework_pct numeric(5,2),        -- Rework percentage of contract value
  punch_list_items integer,       -- Open punch list items at evaluation
  ncrs_issued integer,            -- Non-conformance reports issued
  ncrs_resolved integer,          -- Non-conformance reports resolved

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(entity_id, project_id, standard)
);

-- 4. Add applicable_standards JSONB to projects
-- Stores which standards apply and their default scorecard criteria
alter table projects add column applicable_standards jsonb default '["usace_qm", "dod_385"]'::jsonb;

-- 5. Indexes
create index idx_federal_scorecards_entity on federal_scorecards(entity_id);
create index idx_federal_scorecards_project on federal_scorecards(project_id);
create index idx_federal_scorecards_standard on federal_scorecards(standard);
create index idx_entities_category on entities(category);

-- 6. RLS
alter table federal_scorecards enable row level security;
create policy "federal_scorecards_select" on federal_scorecards for select using (auth.role() = 'authenticated');
create policy "federal_scorecards_insert" on federal_scorecards for insert with check (auth.role() = 'authenticated');
create policy "federal_scorecards_update" on federal_scorecards for update using (auth.role() = 'authenticated');
create policy "federal_scorecards_delete" on federal_scorecards for delete using (auth.role() = 'authenticated');

-- 7. Triggers
create trigger set_updated_at before update on federal_scorecards for each row execute function update_updated_at();
create trigger log_federal_scorecards after insert or update or delete on federal_scorecards for each row execute function log_activity();
