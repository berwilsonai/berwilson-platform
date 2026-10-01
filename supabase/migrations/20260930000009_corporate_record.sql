-- The corporate record — resolutions and written consents, appointments and
-- signature authority, and ownership of record.
--
-- WHY THIS EXISTS
--
-- /company/board was already a real minute book: meetings carries chair,
-- secretary, attendees, a decisions array and a draft -> approved chain with
-- approved_at / approved_by. What it could not hold is everything a lender, an
-- auditor or an acquirer asks for BY NAME in diligence:
--
--  1. An action taken by UNANIMOUS WRITTEN CONSENT has no meeting, so under the
--     old shape it had nowhere to live at all. meetings.decisions is a jsonb
--     array of strings, which cannot be cited by number, bound to an entity,
--     signed, or superseded.
--  2. "Who held signature authority on 14 March 2024" is asked in litigation
--     and in every lender's diligence pack. org_people carried NO DATES — it
--     is a picture of today, which is exactly what a corporate record is not.
--  3. investors / investments track the RAISE, not the ownership that results.
--     ORG_ENTITY_TYPES already splits Series (internal capital) from Standalone
--     (outside capital), which is precisely the line a cap table has to respect.
--
-- The shape shared by all three tables below is EFFECTIVE DATING: a row opens,
-- a row closes, nothing is overwritten. The current state is a read over rows
-- with no end date. That is the same move as the personnel register and for the
-- same reason — an UPDATE that overwrites who held an office destroys the only
-- evidence that anyone else ever did.
--
-- NOTE THE SNAPSHOT COLUMNS. Every org_node_id here is `on delete set null` or
-- `restrict`, and each carries an `entity_name` beside it. The org chart is a
-- board people drag boxes around on; the corporate record must not lose the
-- name of the entity a resolution bound because someone tidied a division.

-- ─── Resolutions and written consents ────────────────────────────────────────

create table if not exists resolutions (
  id uuid primary key default gen_random_uuid(),

  -- Which entity's board or members acted. NULL = the group / parent company.
  org_node_id uuid references org_nodes(id) on delete set null,
  org_node_name text,

  -- The citable number — "BW-2026-004". This is the whole point of the table:
  -- a decision you can reference from a contract, a certificate or an opinion.
  reference text,

  title text not null,

  kind text not null default 'resolution'
    check (kind in ('resolution', 'written_consent', 'ratification', 'minute_action')),

  adopting_body text not null default 'board'
    check (adopting_body in ('board', 'members', 'managers', 'shareholders', 'officer', 'committee')),

  adopted_on date not null,
  effective_on date,

  -- The meeting it was adopted at. NULL for a written consent BY DEFINITION,
  -- and the check below makes that structural rather than a convention — the
  -- modelling point that made this table necessary in the first place.
  meeting_id uuid references meetings(id) on delete set null,

  votes_for integer,
  votes_against integer,
  votes_abstain integer,
  -- Who stepped out. Reads across to conflict_disclosures.recused.
  recusals text[] not null default '{}',

  -- The resolved clauses, as adopted.
  text_body text,

  signature_status text not null default 'unsigned'
    check (signature_status in ('unsigned', 'circulating', 'signed', 'superseded')),
  signed_on date,

  document_id uuid references documents(id) on delete set null,

  -- A resolution is amended by adopting another one, never by editing it.
  superseded_by_resolution_id uuid references resolutions(id) on delete set null,

  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint resolutions_consent_has_no_meeting check (
    kind <> 'written_consent' or meeting_id is null
  ),
  constraint resolutions_signed_has_date check (
    signature_status <> 'signed' or signed_on is not null
  )
);

-- `unique nulls not distinct` because org_node_id is NULL for every
-- group-level resolution, and a plain unique(a,b) with a NULL column enforces
-- NOTHING — two NULLs are never equal, so the constraint would match no rows
-- at all and every re-entry would stack a duplicate (§12, 09-28).
create unique index if not exists uq_resolutions_reference
  on resolutions (org_node_id, reference) nulls not distinct
  where reference is not null;

create index if not exists idx_resolutions_adopted on resolutions (adopted_on desc);
create index if not exists idx_resolutions_node on resolutions (org_node_id);
create index if not exists idx_resolutions_meeting on resolutions (meeting_id) where meeting_id is not null;

-- ─── Appointments and authority ──────────────────────────────────────────────
--
-- Officers, directors, managers — and the thing that actually bites on a
-- construction job, which is who may SIGN what. A PM signing a change order
-- they were not authorised to sign is a dispute; "we think Eric could sign up
-- to half a million in 2024" is not an answer to it.

create table if not exists org_roles (
  id uuid primary key default gen_random_uuid(),

  personnel_id uuid references personnel(id) on delete set null,
  party_id uuid references parties(id) on delete set null,
  org_person_id uuid references org_people(id) on delete set null,
  -- Again the tombstone: the holder's name on the row, so the record survives
  -- every link above being nulled.
  person_name text not null,

  org_node_id uuid references org_nodes(id) on delete set null,
  org_node_name text,

  title text not null,

  appointed_by text
    check (appointed_by in ('board', 'members', 'managers', 'shareholders', 'officer', 'committee', 'operating_agreement')),
  appointing_resolution_id uuid references resolutions(id) on delete set null,

  is_officer boolean not null default false,
  is_director boolean not null default false,
  is_manager boolean not null default false,

  -- ── Signature and banking authority ───────────────────────────────────────
  can_sign_contracts boolean not null default false,
  -- NULL with can_sign_contracts = true means unlimited, which is a real and
  -- deliberately different state from 0.
  signing_limit numeric(15,2),
  bank_signatory boolean not null default false,
  can_bind_surety boolean not null default false,
  authority_note text,

  effective_from date not null,
  effective_to date,
  end_reason text
    check (end_reason in ('resigned', 'removed', 'term_expired', 'role_changed', 'separation', 'entity_dissolved', 'other')),
  ending_resolution_id uuid references resolutions(id) on delete set null,

  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint org_roles_date_order check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint org_roles_end_reason check (
    effective_to is not null or end_reason is null
  )
);

create index if not exists idx_org_roles_current on org_roles (effective_from desc) where effective_to is null;
create index if not exists idx_org_roles_personnel on org_roles (personnel_id) where personnel_id is not null;
create index if not exists idx_org_roles_node on org_roles (org_node_id);
create index if not exists idx_org_roles_signers on org_roles (org_node_id)
  where effective_to is null and can_sign_contracts = true;

-- ─── Ownership of record ─────────────────────────────────────────────────────
--
-- The cap table, effective-dated. A transfer is a row closing and a row
-- opening, chained by acquired_from_id — so "who owned this SPV when the deal
-- closed" is a query rather than an archaeology exercise.
--
-- ⚠ org_node_id is ON DELETE RESTRICT, alone among the FKs in these three
-- migrations. Ownership of record is exactly the thing that must not quietly
-- vanish because a box was dragged off the chart, and org_nodes.parent_id
-- cascades — so without RESTRICT, deleting a division would silently take its
-- SPVs' cap tables with it.

create table if not exists ownership_interests (
  id uuid primary key default gen_random_uuid(),

  -- The entity OWNED.
  org_node_id uuid not null references org_nodes(id) on delete restrict,
  org_node_name text,

  -- The HOLDER. One of these four, or just the name.
  holder_name text not null,
  holder_party_id uuid references parties(id) on delete set null,
  holder_entity_id uuid references entities(id) on delete set null,
  holder_node_id uuid references org_nodes(id) on delete set null,
  -- Ties ownership of record back to the raise that produced it.
  investor_id uuid references investors(id) on delete set null,

  class text not null default 'membership_units'
    check (class in (
      'membership_units', 'series_interest', 'common', 'preferred',
      'profits_interest', 'option', 'warrant', 'convertible_note', 'other'
    )),

  units numeric(20,4),
  percent numeric(7,4),
  capital_contributed numeric(15,2),

  effective_from date not null,
  effective_to date,

  -- The transfer chain. A sale is this row pointing at the row it came out of.
  acquired_from_id uuid references ownership_interests(id) on delete set null,
  consideration numeric(15,2),
  authorizing_resolution_id uuid references resolutions(id) on delete set null,

  certificate_number text,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint ownership_date_order check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint ownership_percent_range check (
    percent is null or (percent >= 0 and percent <= 100)
  )
);

create index if not exists idx_ownership_node on ownership_interests (org_node_id);
create index if not exists idx_ownership_current on ownership_interests (org_node_id) where effective_to is null;
create index if not exists idx_ownership_holder_party on ownership_interests (holder_party_id) where holder_party_id is not null;

-- ─── Minutes approved at the next meeting ────────────────────────────────────
--
-- meetings already had status / approved_at / approved_by, but approved_by is
-- free text and nothing recorded WHERE the approval happened. For an auditor
-- the point of minute approval is the chain: the minutes of meeting N were
-- approved at meeting N+1. That is this column.

alter table meetings add column if not exists minutes_approved_at_meeting_id
  uuid references meetings(id) on delete set null;

create index if not exists idx_meetings_minutes_approved_at
  on meetings (minutes_approved_at_meeting_id)
  where minutes_approved_at_meeting_id is not null;

-- ─── Updated-at triggers ─────────────────────────────────────────────────────

drop trigger if exists set_updated_at on resolutions;
create trigger set_updated_at before update on resolutions
  for each row execute function update_updated_at();

drop trigger if exists set_updated_at on org_roles;
create trigger set_updated_at before update on org_roles
  for each row execute function update_updated_at();

drop trigger if exists set_updated_at on ownership_interests;
create trigger set_updated_at before update on ownership_interests
  for each row execute function update_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['resolutions', 'org_roles', 'ownership_interests']
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
