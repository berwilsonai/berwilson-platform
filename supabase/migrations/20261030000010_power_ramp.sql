-- The ramp-up schedule: how much power a deal brings online, and by when.
--
-- Richard, 2026-10-30: *"put a 'ramp up schedule' that is where you allow it to
-- add up to 6 phases of Megawatt power with a date. For example, 100 MW by June
-- 1 2027, 300 MW by August 2029. Total 400 MW. I want that total of MW displayed
-- on every project in a prominent place. It is the key metric."*
--
-- ── WHY A TABLE AND NOT A COLUMN ────────────────────────────────────────────
-- A phase carries facts of its own — a quantity, a date, and later a note about
-- why that date moved — so it is a record, not an attribute (§12: a record that
-- carries facts of its own must not hang off something rebuilt more often than
-- it is; a phase outlives nothing here, the deal outlives it). It is also the
-- shape the audit log can actually answer questions about: "phase 2 slipped from
-- August 2029 to December 2029" is a field diff on a row, and is invisible
-- inside a rewritten jsonb blob.
--
-- ── WHY SIX IS IN THE SCHEMA ────────────────────────────────────────────────
-- `phase_no` is CHECKed 1..6 rather than left to the form. Richard said six, the
-- editor enforces six, and a schema that does not would let an import or an
-- agent write a seventh that no UI can show or remove. The number is small,
-- fixed and stated by the person who owns the process — that is a CHECK, not a
-- registry table (§12: a CHECK is a list baked into the schema; an FK points at
-- rows — if the value set grows with the business it is a table. This one does
-- not grow; it is the width of a form).
--
-- ── SHARED CHILD, BOTH PIPELINES ────────────────────────────────────────────
-- §4's convention: nullable `project_id` + nullable `opportunity_id` with an
-- exactly-one CHECK. The 16 power/data-center records this is for are split
-- across both tables, and a feature that reached only `projects` would be
-- invisible on exactly the deals being worked hardest. ⚠ Never assume
-- `project_id` is set on a row from this table.

create table if not exists power_phases (
  id uuid default gen_random_uuid() primary key,

  -- Exactly one parent (§4 shared children).
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,

  -- 1..6. The ORDER a reader sees, and the identity a re-save conflicts on.
  phase_no smallint not null,

  -- ⚠ THE QUANTITY IS AN INCREMENT, NOT A RUNNING TOTAL, and the two are
  -- indistinguishable once typed. Richard's own example settles it: *"100 MW by
  -- June 1 2027, 300 MW by August 2029. Total 400 MW."* — 100 + 300 = 400, so
  -- each phase states what IT adds and the total is the sum. Had he meant a
  -- cumulative curve the total would have been 300. The column comment and the
  -- editor's own running-total readout both exist to keep the next person from
  -- re-deciding this silently; `power.ts` is the only thing that adds them up.
  --
  -- numeric(10,2): 99,999,999.99 MW of headroom with two decimals, because a
  -- behind-the-meter tranche is genuinely 12.5 MW. > 0 and not >= 0 — a phase
  -- that brings nothing online is not a phase, it is a milestone, and
  -- `milestones` already exists.
  megawatts numeric(10,2) not null,

  -- "by June 1 2027". NULLABLE on purpose: a deal routinely knows its phase 3
  -- capacity long before it knows the date, and a NOT NULL here would make the
  -- honest answer unenterable — which is how a form starts collecting invented
  -- dates (§12: where a NOT NULL column has no honest value, REFUSE and say
  -- why, rather than guess). The total is the sum of the MEGAWATTS and does not
  -- depend on this; a dateless phase still counts, and the UI names the absence
  -- in words rather than rendering a bare em dash at the date's own weight.
  target_date date,

  -- What this tranche IS, when "Phase 2" is not the useful name — "Substation
  -- energization", "Building B". Optional; readers fall back to the number.
  label text,
  note text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint power_phases_scope_check
    check (num_nonnulls(project_id, opportunity_id) = 1),
  constraint power_phases_phase_no_check
    check (phase_no between 1 and 6),
  constraint power_phases_megawatts_check
    check (megawatts > 0),

  -- ⚠ `nulls not distinct` IS LOAD-BEARING, and §12 names this exact trap:
  -- `unique (a, b, c)` where one column is ALWAYS NULL enforces NOTHING,
  -- because under Postgres's default rule two NULLs never equal each other. The
  -- shared-children convention manufactures that shape on every row here — one
  -- parent column is null by construction — so a plain unique key would look
  -- present, never fire ON CONFLICT, and let the editor stack six duplicate
  -- "phase 1" rows on one deal. Same fix `data_room_signoffs` and
  -- `project_parcels` already use.
  unique nulls not distinct (project_id, opportunity_id, phase_no)
);

create index if not exists idx_power_phases_project
  on power_phases(project_id) where project_id is not null;
create index if not exists idx_power_phases_opportunity
  on power_phases(opportunity_id) where opportunity_id is not null;

alter table power_phases enable row level security;

drop policy if exists "power_phases_select" on power_phases;
create policy "power_phases_select" on power_phases
  for select using (auth.role() = 'authenticated');
drop policy if exists "power_phases_insert" on power_phases;
create policy "power_phases_insert" on power_phases
  for insert with check (auth.role() = 'authenticated');
drop policy if exists "power_phases_update" on power_phases;
create policy "power_phases_update" on power_phases
  for update using (auth.role() = 'authenticated');
drop policy if exists "power_phases_delete" on power_phases;
create policy "power_phases_delete" on power_phases
  for delete using (auth.role() = 'authenticated');

drop trigger if exists set_updated_at on power_phases;
create trigger set_updated_at before update on power_phases
  for each row execute function update_updated_at();

-- ⚠ A TABLE BUILT LATER DOES NOT INHERIT THE AUDIT TRIGGER — it is a
-- hand-written enumeration with no registry behind it, and §12 records two
-- tables in two days that silently went without one. `power_phases` holds the
-- platform's stated key metric, so a hard delete that left nothing in the
-- append-only log would lose the only record that the figure ever had another
-- value. The companion migration adds it to `_audited_in_full` so the diff is
-- column-by-column: a date slipping is the change worth reading.
--
-- ⚠ AND MAKING A TABLE TRACKED MEANS AUDITING EVERY WRITE PATH TO IT IN THE
-- SAME CHANGE (§12) — a trail whose every row reads "system" answers nothing.
-- There is exactly one write path, /api/records/power-phases, and it uses
-- actorAdminClient().
drop trigger if exists log_power_phases on power_phases;
create trigger log_power_phases
  after insert or update or delete on power_phases
  for each row execute function log_activity();

comment on table power_phases is
  'The ramp-up schedule: up to 6 tranches of megawatt capacity with the date each comes online. Shared child of projects OR opportunities (exactly one). The deal''s total MW is the SUM of these rows and is read only through powerTotal() in src/lib/records/power.ts.';
comment on column power_phases.megawatts is
  'An INCREMENT, not a running total. Richard''s own example is the definition: 100 MW by Jun 2027 + 300 MW by Aug 2029 = 400 MW total. A cumulative reading would make that total 300.';
comment on column power_phases.target_date is
  'When this tranche comes online. Nullable: capacity is routinely known before the date, and the total does not depend on it.';
