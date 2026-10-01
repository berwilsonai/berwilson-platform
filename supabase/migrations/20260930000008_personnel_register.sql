-- The personnel register — an employment record that survives the person
-- leaving, and the audit trail that proves when their access went away.
--
-- WHY THIS EXISTS
--
-- Asked to "track when we delete personnel", the platform turned out to take
-- the word literally in two places:
--
--   api/org/people/[id] DELETE   — hard delete on org_people. The status set
--     was only active|open, so there was no way to say "departed": a person
--     left and the row vanished out of the chart with nothing behind it.
--   api/admin/users/[id] DELETE  — hard delete on team_members, which also
--     deletes their auth login AND cascades access_grants. The record of what
--     a departed employee could see died with them, which for a federal
--     contractor is the one question you most need to be able to answer.
--
-- Neither table was audited either: log_activity() triggers existed on eleven
-- tables and on none of team_members, org_people, meetings, access_grants,
-- company_profile or certifications. The corporate record and the personnel
-- record were the two least-audited tables in the app.
--
-- This is CLAUDE.md §12's own rule — THE ROW IS THE TOMBSTONE — applied to
-- people instead of Drive documents. Keep the row, flag it, and let the queue
-- of "who works here" be a read over rows with no separation date.
--
-- WHY A FIFTH PEOPLE TABLE, GIVEN §9 WARNS ABOUT EXACTLY THAT
--
-- Because the three that exist answer different questions and none of them
-- answers this one:
--
--   parties       — a contact. Global, shared, and deliberately not private.
--   org_people    — a BOX ON THE CHART. Carries vacant seats (name null,
--                   status 'open'), which is the proof it is not a person.
--   team_members  — a LOGIN and a task assignee.
--
-- An employment relationship is none of those: a person can be employed with
-- no login and no box, and the same human can hold two engagements years
-- apart. Putting the employment file in one table also keeps the
-- employment-law-sensitive narrative in exactly ONE place rather than smeared
-- across three — which matters because §8 is explicit that RLS is not the
-- active boundary here and admin-only is the whole protection.
--
-- NOTE THE DIVISION OF LABOUR, deliberately not duplicated:
--   team_members.deactivated_at  = when platform ACCESS ended (a system fact)
--   personnel.separated_on       = when EMPLOYMENT ended (an HR fact)
--   personnel_notes              = WHY (the narrative, admin-only, held)
-- Two sources for one figure get two columns, never a winner (§12) — but
-- these are two different figures, and the gap between them is itself the
-- interesting number on an offboarding review.

-- ─── The employment record ───────────────────────────────────────────────────

create table if not exists personnel (
  id uuid primary key default gen_random_uuid(),

  -- The record's own copy of the name. Every link below is `on delete set
  -- null`, so without this the file would be anonymous the moment someone
  -- tidied the org chart. The tombstone has to say whose it is.
  full_name text not null,

  -- Links out, all optional and all nullable-on-delete.
  party_id uuid references parties(id) on delete set null,
  org_person_id uuid references org_people(id) on delete set null,
  team_member_id uuid references team_members(id) on delete set null,

  -- Which legal entity employs them. Matters here: the group runs arms,
  -- divisions and SPVs, and "who was the employer of record" is a question
  -- both a workers-comp audit and a lender's diligence will ask.
  employing_entity_id uuid references org_nodes(id) on delete set null,
  employing_entity_name text,

  title text,

  -- Set by tax and employment law, not by the business, so a CHECK is right
  -- here where lead_categories needed a table (§12). Worker classification in
  -- construction is an audit magnet; `seconded` is the Dino case.
  classification text not null default 'employee'
    check (classification in (
      'employee', 'contractor_1099', 'seconded', 'temp', 'intern',
      'officer_only', 'board_only'
    )),

  engaged_on date,

  -- ── Separation ─────────────────────────────────────────────────────────────
  separated_on date,
  separation_notice_on date,
  -- Also a legal category set rather than a growing business one.
  separation_type text
    check (separation_type in (
      'resigned', 'terminated_cause', 'terminated_without_cause', 'layoff',
      'contract_end', 'retired', 'mutual', 'deceased', 'other'
    )),
  -- NULL means nobody has decided, which is different from "no".
  rehire_eligible boolean,

  -- ONE QUANTITY, ONE DEFINITION (§12). Derived, not stored twice — a row
  -- cannot be 'active' with a separation date on it.
  status text generated always as (
    case when separated_on is null then 'active' else 'departed' end
  ) stored,

  -- ── Retention and legal hold ───────────────────────────────────────────────
  -- The inverse of the delete problem. An HR record has a statutory retention
  -- period (longer for a federal contractor), and before this there was a
  -- delete button and nothing else. The BEFORE DELETE trigger below is what
  -- makes these two columns a control rather than a comment.
  retention_until date,
  legal_hold boolean not null default false,
  legal_hold_reason text,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  constraint personnel_separation_order check (
    separated_on is null or engaged_on is null or separated_on >= engaged_on
  ),
  -- A separation type with no date, or a date with no type, is half a record.
  constraint personnel_separation_complete check (
    (separated_on is null and separation_type is null)
    or (separated_on is not null and separation_type is not null)
  ),
  constraint personnel_hold_reason check (
    legal_hold = false or legal_hold_reason is not null
  )
);

create index if not exists idx_personnel_status on personnel (status);
create index if not exists idx_personnel_separated on personnel (separated_on desc) where separated_on is not null;
create index if not exists idx_personnel_team_member on personnel (team_member_id) where team_member_id is not null;
create index if not exists idx_personnel_org_person on personnel (org_person_id) where org_person_id is not null;
-- One OPEN engagement per contact. Partial, so a rehire years later is fine —
-- and never a conflict target, which a partial index cannot be (§12).
create unique index if not exists uq_personnel_open_party
  on personnel (party_id) where separated_on is null and party_id is not null;

-- ─── Note kinds: a registry, not a CHECK ─────────────────────────────────────
--
-- Straight from the lead_categories lesson (§12, 09-30): a value set that
-- grows with the business is a table. Note kinds will grow — the day a safety
-- incident or an immigration re-verification needs filing, that must be an
-- INSERT on a screen, not a migration plus a constraint swap plus five label
-- maps. `on update cascade` so renaming a key carries its notes; NO delete
-- rule, so a kind with notes cannot be deleted at all — which is what
-- `active` is for.

create table if not exists personnel_note_kinds (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  -- A tone NAME against a palette declared literally in source. NEVER a
  -- Tailwind class string in a column: v4 emits only what it finds by
  -- scanning source, so stored classes render unstyled with no error
  -- anywhere (§12).
  tone text not null default 'slate',
  -- Whether this kind carries employment-law-sensitive narrative. Drives the
  -- default on personnel_notes.confidential and, later, who may read it.
  sensitive boolean not null default true,
  -- Whether the note is incomplete without a signed document behind it.
  requires_document boolean not null default false,
  sort_order integer not null default 100,
  active boolean not null default true,
  -- A kind the platform's own passes write. Protected from deletion in the UI.
  system boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

insert into personnel_note_kinds (key, label, description, tone, sensitive, requires_document, sort_order, system) values
  ('separation',     'Separation',          'Why we parted ways. The narrative behind separated_on — the record a tribunal, an unemployment claim or a reference request is answered from.', 'rose',   true,  false, 10,  true),
  ('performance',    'Performance',         'A review, a rating, a documented conversation about performance.',                      'amber',  true,  false, 20,  false),
  ('disciplinary',   'Disciplinary',        'A warning or corrective action, verbal or written.',                                    'rose',   true,  false, 30,  false),
  ('commendation',   'Commendation',        'Recognition worth having on file — the counterweight to the two above.',               'emerald', false, false, 40,  false),
  ('incident',       'Incident',            'A safety, site or conduct incident involving this person.',                            'rose',   true,  false, 50,  false),
  ('compensation',   'Compensation change', 'A pay, bonus or benefit change and the authority for it.',                             'violet', true,  false, 60,  false),
  ('classification', 'Classification',      'A change of employment classification (employee / 1099 / seconded) and its basis.',    'blue',   true,  true,  70,  false),
  ('onboarding',     'Onboarding',          'Hire paperwork, I-9 / E-Verify, orientation, equipment issue.',                         'blue',   true,  false, 80,  false),
  ('licence',        'Licence or cert',     'A licence, certification or training record carried by this person.',                  'teal',   false, true,  90,  false),
  ('grievance',      'Grievance',           'A complaint raised by or about this person, and how it was handled.',                   'rose',   true,  false, 100, false),
  ('leave',          'Leave',               'Leave of absence, FMLA, military leave, extended absence.',                            'slate',  true,  false, 110, false),
  ('general',        'General note',        'Anything else that belongs in the file.',                                              'slate',  false, false, 200, true)
on conflict (key) do nothing;

-- ─── The notes themselves ────────────────────────────────────────────────────

create table if not exists personnel_notes (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references personnel(id) on delete cascade,

  -- FK to the registry, not a CHECK (§12).
  kind text not null references personnel_note_kinds(key) on update cascade,

  body text not null,

  -- Stamped server-side from the viewer, never taken from the client — the
  -- same arrangement as investor_notes / lead_notes. An HR note whose author
  -- the reader can set is not evidence of anything.
  author text,

  -- WHEN IT HAPPENED, as distinct from created_at = when it was written down.
  -- Both matter to an auditor, and a note recorded three weeks late is a
  -- different fact from one recorded the same day.
  effective_on date,

  document_id uuid references documents(id) on delete set null,

  -- HR notes default closed.
  confidential boolean not null default true,

  created_at timestamptz default now()
);

create index if not exists idx_personnel_notes_personnel on personnel_notes (personnel_id, created_at desc);
create index if not exists idx_personnel_notes_kind on personnel_notes (kind);

-- ─── Agreements on file ──────────────────────────────────────────────────────
--
-- On a departure the live question is what the person is still bound by, and
-- it is unanswerable from a pile of PDFs. VERSION is the load-bearing column:
-- an acknowledgement of "the handbook" with no version is worth nothing.

create table if not exists personnel_agreements (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references personnel(id) on delete cascade,
  kind text not null
    check (kind in (
      'offer_letter', 'employment_agreement', 'contractor_agreement',
      'nda', 'non_solicit', 'non_compete', 'ip_assignment', 'arbitration',
      'handbook_ack', 'separation_agreement', 'release', 'other'
    )),
  version text,
  signed_on date,
  effective_from date,
  -- What the covenant runs until. The figure you need the day they resign.
  expires_on date,
  -- Consideration paid — a separation agreement with no consideration on file
  -- is a release a lawyer will question.
  consideration numeric(15,2),
  document_id uuid references documents(id) on delete set null,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint personnel_agreements_dates check (
    expires_on is null or effective_from is null or expires_on >= effective_from
  )
);

create index if not exists idx_personnel_agreements_personnel on personnel_agreements (personnel_id);
create index if not exists idx_personnel_agreements_expiry on personnel_agreements (expires_on) where expires_on is not null;

-- ─── Offboarding: a control, not a note ──────────────────────────────────────
--
-- "When was their platform and email access revoked" has to be a date, not a
-- recollection. Each step is a row carrying its OWN label as text rather than
-- an FK to a template: when the checklist changes next year, history must keep
-- saying what was actually done, not what the current template says.

create table if not exists personnel_offboarding (
  id uuid primary key default gen_random_uuid(),
  personnel_id uuid not null references personnel(id) on delete cascade,
  label text not null,
  category text not null default 'other'
    check (category in ('access', 'property', 'payroll', 'authority', 'external', 'other')),
  required boolean not null default true,
  sort_order integer not null default 100,
  completed_at timestamptz,
  completed_by text,
  -- Why a required step was skipped, or what was found when it was done.
  note text,
  created_at timestamptz default now(),
  unique (personnel_id, label)
);

create index if not exists idx_personnel_offboarding_personnel
  on personnel_offboarding (personnel_id, sort_order);
create index if not exists idx_personnel_offboarding_open
  on personnel_offboarding (personnel_id) where completed_at is null;

-- ─── The delete guard ────────────────────────────────────────────────────────
--
-- What makes retention_until and legal_hold a control rather than decoration.
-- A genuine mis-entry can still be removed; a held record cannot, and the
-- error says which column stopped it.

create or replace function personnel_delete_guard() returns trigger as $fn$
begin
  if old.legal_hold then
    raise exception
      'Personnel record % is under legal hold (%) and cannot be deleted. Clear the hold first.',
      old.full_name, coalesce(old.legal_hold_reason, 'no reason recorded')
      using errcode = 'restrict_violation';
  end if;
  if old.retention_until is not null and old.retention_until > current_date then
    raise exception
      'Personnel record % must be retained until % and cannot be deleted.',
      old.full_name, old.retention_until
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$fn$ language plpgsql;

drop trigger if exists personnel_guard_delete on personnel;
create trigger personnel_guard_delete before delete on personnel
  for each row execute function personnel_delete_guard();

-- ─── Columns on the tables that were hard-deleting ───────────────────────────

-- org_people: the chart learns the word "departed". No CHECK on status today,
-- so this is additive; src/lib/utils/org.ts carries the allowed set.
alter table org_people add column if not exists departed_on date;
alter table org_people add column if not exists personnel_id uuid references personnel(id) on delete set null;

-- team_members: when platform ACCESS ended. Deactivating IS revoking access,
-- so this column is the offboarding evidence date — and deliberately carries
-- no reason, because the reason is an HR fact and lives in one place.
alter table team_members add column if not exists deactivated_at timestamptz;
alter table team_members add column if not exists deactivated_by text;
alter table team_members add column if not exists personnel_id uuid references personnel(id) on delete set null;

-- A snapshot of what a member could see, taken before the access_grants
-- cascade eats it on a permanent delete. Without this the evidence that they
-- ever had access to anything is destroyed by the delete it should survive.
alter table team_members add column if not exists revoked_grants jsonb;

create index if not exists idx_team_members_deactivated
  on team_members (deactivated_at desc) where deactivated_at is not null;

-- ─── Updated-at triggers ─────────────────────────────────────────────────────

drop trigger if exists set_updated_at on personnel;
create trigger set_updated_at before update on personnel
  for each row execute function update_updated_at();

drop trigger if exists set_updated_at on personnel_note_kinds;
create trigger set_updated_at before update on personnel_note_kinds
  for each row execute function update_updated_at();

drop trigger if exists set_updated_at on personnel_agreements;
create trigger set_updated_at before update on personnel_agreements
  for each row execute function update_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Defense in depth per §8: the active boundary is middleware (/company/* is
-- admin-only by prefix default-deny) and app traffic uses the service role.
-- These policies are what the boundary becomes if pages ever move to the
-- RLS-respecting server client — which §8 names this data as a trigger for.

alter table personnel enable row level security;
alter table personnel_note_kinds enable row level security;
alter table personnel_notes enable row level security;
alter table personnel_agreements enable row level security;
alter table personnel_offboarding enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'personnel', 'personnel_note_kinds', 'personnel_notes',
    'personnel_agreements', 'personnel_offboarding'
  ]
  loop
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
