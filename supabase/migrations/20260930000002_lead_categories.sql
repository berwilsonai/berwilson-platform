-- Lead categories — the routing registry.
--
-- WHY THIS TABLE EXISTS
--
-- `leads.route` was a CHECK-constrained enum of five values, and it was doing
-- two jobs at once: which side of the business owns a lead, AND which record
-- type it becomes. A third job then arrived -- which PERSON or company the lead
-- is handed to -- and that one grows with the company. Ber Wilson will keep
-- accruing lines of business; flooring, plumbing and HVAC are the first three
-- that are neither a project, a steel deal, nor an acquisition.
--
-- Adding a value to a CHECK-constrained discriminator is a documented trap in
-- this codebase (CLAUDE.md §12): the new value typechecks, deploys, and then
-- fails at every INSERT until someone remembers the constraint. Worse, the
-- triage prompt hardcoded the same five values in prose, so a new lane needed a
-- migration, a constraint swap, a prompt edit and a rebuild -- four places, none
-- of which fails loudly if you miss it.
--
-- So the taxonomy becomes data. One row per destination, carrying everything
-- that varies: what a lead of this kind BECOMES, the sentence the model reads to
-- recognise it, who it is handed to, and where its Drive copy lives. Adding a
-- line of business is an INSERT.
--
-- `leads.route` keeps its name and its data -- 1,437 rows and eight indexes stay
-- exactly as they are. Only the CHECK is replaced, by an FK to this table.

create table if not exists lead_categories (
  id uuid primary key default gen_random_uuid(),

  -- Stable slug. THE KEY IS THE TRADE, THE LABEL NAMES WHO DOES IT: `plumbing`
  -- labelled "Dino Plumbing", not a key of `dino_plumbing`. If Dino ever stops
  -- doing plumbing that is a label and an address, not a re-keying of history.
  -- `on update cascade` on the FK below means a rename still migrates leads.
  key text not null unique,
  label text not null,

  -- What a lead of this category becomes when a human accepts it. Replaces the
  -- switch that used to live in promoteTargetFor().
  --   project / opportunity / steel_deal — creates that record in the platform
  --   handoff  — leaves by email to people with no platform login
  --   manual   — the human decides; offered no one-click destination
  destination text not null default 'handoff'
    check (destination in ('project', 'opportunity', 'steel_deal', 'handoff', 'manual')),

  -- Read to the triage model verbatim as this category's routing rule. This is
  -- the field that makes a new category recognisable without a prompt edit, and
  -- the one worth writing carefully.
  --
  -- Note what is being asked of the model: what the work IS, never where it
  -- should go (§12, 09-29). The model cannot see the database; the mapping from
  -- "this is HVAC service work" to an address is configuration, set once.
  routing_rule text,

  -- One line shown to the reader under the lead's title, saying where this is
  -- headed. Was ROUTE_DESTINATIONS in code.
  destination_note text,

  -- ── Handoff ────────────────────────────────────────────────────────────────
  -- Where a `handoff` lead is emailed. Replaces DINO_LEAD_EMAIL, which has been
  -- unset since 2026-08-26 -- so the forward button has 400'd for its whole
  -- life. An address typed into a screen cannot be missing after a rebuild.
  handoff_email text,

  -- Outside addresses granted reader on this category's Drive folder and sheet.
  -- A flooring subcontractor is not on berwilson.com, so domain sharing reaches
  -- them with nothing.
  share_with text[] not null default '{}',

  -- Drive folder this category's leads are copied into. MUST be created by a
  -- human on the shared drive: `drive.file` can add children to a folder a
  -- person made, but cannot create one in My Drive (§12, 09-16). Same contract
  -- as STEEL_QUOTES_FOLDER_ID.
  drive_folder_id text,

  -- Whether this category gets a read-only Google Sheet of its open leads.
  -- True for the lanes whose audience has no platform login. Construction and
  -- corporate are worked by people with logins, and a sheet for them would be a
  -- second place to look at the same queue.
  publish_sheet boolean not null default false,

  -- Internal owner. A handed-off lead with no owner is the "created, correct,
  -- and in nobody's pipeline" failure (§12, 09-24) one screen later.
  owner_team_member_id uuid references team_members(id) on delete set null,

  -- Suffix for GOOGLE_CHAT_WEBHOOK_URL_<KEY>, so a lane can announce into its
  -- own Chat space without touching the notify layer.
  chat_webhook_key text,

  -- Badge tone NAME, resolved to classes in src/lib/utils/leads.ts. Deliberately
  -- not a class string: Tailwind v4 emits only what it finds in source, so
  -- classes read from the database would never be generated.
  tone text not null default 'slate',

  sort_order integer not null default 100,

  -- Retire a category without invalidating history. The FK below means a
  -- category with leads cannot be deleted at all, so this is how a lane is
  -- closed: existing rows stay readable, nothing new is classified into it, and
  -- the model stops being told it exists.
  active boolean not null default true,

  -- Code depends on this row by key; the UI must not offer to delete or rename
  -- it. Currently only `unknown`, which is the fallback every coercion lands on.
  system boolean not null default false,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_lead_categories_active
  on lead_categories (active, sort_order);

drop trigger if exists set_updated_at on lead_categories;
create trigger set_updated_at before update on lead_categories
  for each row execute function update_updated_at();

alter table lead_categories enable row level security;

drop policy if exists lead_categories_select on lead_categories;
create policy lead_categories_select on lead_categories for select
  using (auth.role() = 'authenticated');

-- ── Seed ─────────────────────────────────────────────────────────────────────
-- The five existing route values first, so every one of the 1,437 existing leads
-- still satisfies the FK added below. Then the three new trades.

insert into lead_categories
  (key, label, destination, tone, sort_order, active, system, publish_sheet,
   destination_note, routing_rule)
values
  ('construction', 'Construction', 'project', 'blue', 10, true, false, false,
   'General construction & infrastructure — becomes a project',
   'General contracting, design-build, EPC, infrastructure, rail, site work, federal and military construction, multifamily and commercial builds. This is the default for a real solicitation that Ber Wilson would build itself. MEP work inside a larger building project belongs here too, not with the standalone service trades.'),

  ('steel', 'Steel', 'steel_deal', 'violet', 20, true, false, true,
   'Prefab steel — quotes in the Steel CRM',
   'Prefab or pre-engineered metal buildings, a structural steel package, steel framing, or a building-kit quote. Anything the steel plant would price.'),

  ('corporate', 'Corporate', 'opportunity', 'amber', 30, true, false, false,
   'Acquisitions, JVs, equity — becomes an opportunity',
   'Someone selling a business, proposing a joint venture, a teaming agreement, an equity investment, or a merger. Not built work.'),

  ('plumbing', 'Dino Plumbing', 'handoff', 'cyan', 40, true, false, true,
   'Plumbing service — handed to Dino Plumbing',
   'Standalone plumbing service, repair, or replacement work: leaks, drains, sewer lines, water heaters, backflow, re-pipes, fixture installation. Standalone means the plumbing IS the job. Plumbing inside a larger building project is construction, not this.'),

  ('hvac', 'Dino HVAC', 'handoff', 'teal', 50, true, false, true,
   'HVAC service — handed to Dino HVAC',
   'Standalone heating, ventilation, air conditioning, or refrigeration service work: furnace and AC repair or replacement, rooftop units, ductwork, mini-splits, boilers, maintenance agreements. Standalone means the mechanical work IS the job, not a trade inside a building project.'),

  ('flooring', 'Flooring', 'handoff', 'rose', 60, true, false, true,
   'Flooring — handed to the flooring team',
   'Standalone flooring work: carpet, tile, LVP, hardwood, epoxy or polished concrete, subfloor prep, and floor covering replacement. Standalone means the flooring IS the job.'),

  -- Superseded by `plumbing` and `hvac`, which go to different people at Dino.
  -- Kept so the existing dino-routed lead stays valid and readable; inactive so
  -- nothing new lands here and the model is never told it exists.
  ('dino', 'Dino (retired)', 'handoff', 'cyan', 900, false, false, false,
   'Superseded by Dino Plumbing and Dino HVAC', null),

  ('unknown', 'Unsorted', 'manual', 'slate', 990, true, true, false,
   'A real lead the AI could not categorize — place it by hand',
   'A real lead whose category genuinely cannot be told from the thread. Use sparingly: it means a human has to read the email you were asked to read.')
on conflict (key) do nothing;

-- ── Swap the CHECK for an FK ─────────────────────────────────────────────────
-- The whole point. A CHECK is a list baked into the schema; an FK points at
-- rows, so a new line of business is an INSERT.
--
-- `on update cascade`: renaming a category's key carries its leads with it.
-- No delete rule, so the default (no action) applies -- a category with leads
-- cannot be deleted, which is what `active = false` is for.

alter table leads drop constraint if exists leads_route_check;
alter table leads drop constraint if exists leads_route_fkey;
alter table leads
  add constraint leads_route_fkey foreign key (route)
  references lead_categories (key) on update cascade;

-- Handing a lead to a trade is a real outcome, not a sub-case of "forwarded to
-- Dino". `forwarded` already covers it; what was missing is which category it
-- went to, and `route` now answers that.
comment on column leads.route is
  'FK to lead_categories.key. Which line of business owns this lead; the category row says what it becomes and who it is handed to.';

-- ── Audit ────────────────────────────────────────────────────────────────────
-- Tracked, unlike the other config tables (team_members is not).
--
-- The reason is what this table decides: where an inbound lead goes, and to
-- whose inbox. Changing `handoff_email` silently redirects a line of business,
-- and "who pointed flooring at that address, and when" is a question with a
-- real answer that nothing else would record. `log_activity` resolves
-- `record_id` and a null `project_id` safely via to_jsonb, and reads the acting
-- user out of the x-actor-id request header on a service-role write — so
-- mutations must go through an actor-carrying client (see leadsDbAs).

drop trigger if exists log_lead_categories_activity on lead_categories;
create trigger log_lead_categories_activity
  after insert or update or delete on lead_categories
  for each row execute function log_activity();
