-- The compliance register — the entity filing calendar, conflict-of-interest
-- disclosures, the related-party transaction register, and policy
-- acknowledgements.
--
-- WHAT WAS MISSING AND WHY EACH ONE MATTERS HERE SPECIFICALLY
--
-- certifications already covers DBE/MBE-class certs with expiry, but at COMPANY
-- level and as a capability statement, not per entity and not as a calendar.
-- compliance_items is project-scoped. So nothing held the obligations that
-- attach to an ENTITY: annual reports, registered agent renewals, foreign
-- qualifications, contractor licences per state, BOI filings.
--
-- Conflicts and related-party transactions are not generic governance hygiene
-- for this company — they are first-order. Ber Wilson does government
-- contracting through a structure of related SPVs, and Dino is an acquired
-- operating company billing Ber Wilson. dino_revenue already tracks that split
-- for commercial reasons; an auditor or a lender asks for the same rows as a
-- RELATED-PARTY DISCLOSURE, which is a different question about the same money
-- and needs the arm's-length basis and the approving resolution beside it.

-- ─── The entity filing calendar ──────────────────────────────────────────────
--
-- NOTE THE SPLIT ON `kind` vs `category`. The coarse category is fixed by law
-- and finance, so it is a CHECK. The specific kind is FREE TEXT, because it
-- grows every time the company registers in a new state or picks up a new
-- licence class — and §12's rule is that a value set which grows with the
-- business must not be a CHECK. Free text plus enumLabel() is the honest middle
-- here: no constraint to forget, no registry table for a label nobody filters on.

create table if not exists entity_obligations (
  id uuid primary key default gen_random_uuid(),

  org_node_id uuid references org_nodes(id) on delete set null,
  org_node_name text,

  category text not null default 'filing'
    check (category in ('filing', 'licence', 'registration', 'tax', 'insurance', 'bond', 'certification', 'other')),
  -- e.g. "Annual report", "Registered agent renewal", "Contractor licence B100",
  -- "Beneficial ownership (BOI)", "Foreign qualification".
  kind text not null,

  jurisdiction text,
  -- Who it is filed with.
  authority text,
  -- Licence / registration / file number.
  identifier text,

  period text not null default 'annual'
    check (period in ('annual', 'biennial', 'quarterly', 'monthly', 'one_time', 'as_needed')),

  last_filed_on date,
  next_due_on date,

  status text not null default 'open'
    check (status in ('open', 'filed', 'lapsed', 'not_applicable', 'waived')),

  owner_team_member_id uuid references team_members(id) on delete set null,
  cost numeric(15,2),
  document_id uuid references documents(id) on delete set null,
  note text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Partial so the calendar read is an index scan, and DESC-free: the question is
-- always "what is due next".
create index if not exists idx_entity_obligations_due
  on entity_obligations (next_due_on) where next_due_on is not null and status <> 'not_applicable';
create index if not exists idx_entity_obligations_node on entity_obligations (org_node_id);

-- ─── Conflict of interest disclosures ────────────────────────────────────────
--
-- ⚠ has_conflicts DEFAULTS FALSE AND IS NOT NULL ON PURPOSE. A "nothing to
-- disclose" return IS the record — it is the thing an auditor asks to see, and
-- a register that only holds disclosed conflicts cannot distinguish "no
-- conflicts" from "never asked". That distinction is the same one §12 makes
-- about fallbacks: a conclusion can only be drawn from a check that ran.

create table if not exists conflict_disclosures (
  id uuid primary key default gen_random_uuid(),

  personnel_id uuid references personnel(id) on delete set null,
  party_id uuid references parties(id) on delete set null,
  person_name text not null,

  kind text not null default 'annual'
    check (kind in ('annual', 'transaction', 'update')),
  -- The disclosure cycle an annual return belongs to — "2026".
  period text,

  disclosed_on date not null,
  has_conflicts boolean not null default false,
  description text,

  -- What the conflict is WITH.
  related_party_id uuid references parties(id) on delete set null,
  related_entity_id uuid references entities(id) on delete set null,
  related_name text,
  -- The entity or deal it touches.
  org_node_id uuid references org_nodes(id) on delete set null,
  project_id uuid references projects(id) on delete set null,

  -- Where it was addressed, and whether they stepped out of the vote. Reads
  -- across to resolutions.recusals from the other side.
  recused boolean not null default false,
  resolution_id uuid references resolutions(id) on delete set null,

  reviewed_by text,
  reviewed_on date,
  document_id uuid references documents(id) on delete set null,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint conflict_disclosures_described check (
    has_conflicts = false or description is not null
  )
);

-- One annual return per person per cycle. Partial, so transaction-specific
-- disclosures are unconstrained — a person may recuse on five deals a year.
create unique index if not exists uq_conflict_annual
  on conflict_disclosures (personnel_id, period) nulls not distinct
  where kind = 'annual';

create index if not exists idx_conflict_disclosed on conflict_disclosures (disclosed_on desc);
create index if not exists idx_conflict_open on conflict_disclosures (disclosed_on desc) where has_conflicts = true;

-- ─── Related-party transactions ──────────────────────────────────────────────

create table if not exists related_party_transactions (
  id uuid primary key default gen_random_uuid(),

  title text not null,

  -- Our side.
  org_node_id uuid references org_nodes(id) on delete set null,
  org_node_name text,

  -- Their side.
  counterparty_name text not null,
  counterparty_party_id uuid references parties(id) on delete set null,
  counterparty_entity_id uuid references entities(id) on delete set null,

  -- WHY it is a related party — free text, because the relationships that
  -- qualify are as varied as the deals ("internal operating company",
  -- "officer-owned vendor", "member's family member").
  relationship text not null,
  nature text,

  project_id uuid references projects(id) on delete set null,

  amount numeric(15,2),
  -- The reporting period the amount belongs to, where it is a running total.
  period text,
  started_on date,
  ended_on date,

  -- HOW the price was set, which is the whole question an auditor is asking.
  arms_length_basis text,

  approved_by text
    check (approved_by in ('board', 'members', 'disinterested_directors', 'officer', 'not_approved', 'pending')),
  resolution_id uuid references resolutions(id) on delete set null,
  -- Where it has been disclosed — an audit, a lender certificate, a bid rep.
  disclosed_in text,

  status text not null default 'active'
    check (status in ('active', 'closed', 'under_review')),

  document_id uuid references documents(id) on delete set null,
  note text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_rpt_status on related_party_transactions (status, started_on desc);
create index if not exists idx_rpt_node on related_party_transactions (org_node_id);
create index if not exists idx_rpt_project on related_party_transactions (project_id) where project_id is not null;

-- ─── Policies and acknowledgements ───────────────────────────────────────────
--
-- VERSION is not optional. An acknowledgement of "the handbook" with no version
-- is worth nothing: the question is always whether this person agreed to the
-- clause that is now in dispute, and that is a version question.

create table if not exists policies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  category text not null default 'other'
    check (category in ('conduct', 'safety', 'hr', 'finance', 'it_security', 'procurement', 'governance', 'quality', 'other')),
  summary text,
  effective_from date,
  retired_on date,
  requires_acknowledgement boolean not null default true,
  acknowledgement_cadence text not null default 'on_change'
    check (acknowledgement_cadence in ('once', 'annual', 'on_change')),
  adopted_by_resolution_id uuid references resolutions(id) on delete set null,
  document_id uuid references documents(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (name, version)
);

create index if not exists idx_policies_live on policies (category, name) where retired_on is null;

create table if not exists policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id) on delete cascade,
  personnel_id uuid references personnel(id) on delete set null,
  team_member_id uuid references team_members(id) on delete set null,
  person_name text not null,
  acknowledged_on date not null,
  method text not null default 'signed'
    check (method in ('platform', 'signed', 'email', 'training', 'other')),
  document_id uuid references documents(id) on delete set null,
  note text,
  created_at timestamptz default now()
);

create unique index if not exists uq_policy_ack
  on policy_acknowledgements (policy_id, personnel_id, acknowledged_on) nulls not distinct;

create index if not exists idx_policy_ack_policy on policy_acknowledgements (policy_id);
create index if not exists idx_policy_ack_personnel on policy_acknowledgements (personnel_id) where personnel_id is not null;

-- ─── Updated-at triggers ─────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'entity_obligations', 'conflict_disclosures', 'related_party_transactions', 'policies'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function update_updated_at()', t);
  end loop;
end $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'entity_obligations', 'conflict_disclosures', 'related_party_transactions',
    'policies', 'policy_acknowledgements'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select using (auth.role() = ''authenticated'')', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (auth.role() = ''authenticated'')', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for update using (auth.role() = ''authenticated'')', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for delete using (auth.role() = ''authenticated'')', t || '_delete', t);
  end loop;
end $$;
