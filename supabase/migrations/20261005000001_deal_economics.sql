-- Deal economics: how big is this, and how much of it is ours?
--
-- WHY THIS IS NOT `financing_structures`.
-- That table is SOURCES of funds — senior debt, mezz, equity, LTV, draws. This
-- is USES and RETURNS: what the megawatts earn, who earns it, and what reaches
-- Ber Wilson. They sit side by side and neither replaces the other. (As of this
-- migration `financing_structures` holds 0 rows across 14 projects.)
--
-- WHY IT REPLACES `projects.estimated_value`.
-- One unlabelled numeric column held $57.5B across 8 projects, mixing a plain
-- total project value with a fee-scale job: Myton Rail at $48,000,000,000 beside
-- the Alaska JV at $1,500,000, and Stockton Power Nexus BLANK although the
-- platform holds an 88,498-character proposal stating its $152.5M. There is no
-- defensible way to sum that column. Richard's instruction was to clear it and
-- recompute, which happens in scripts/clear-estimated-value.mts after a backup.
--
-- THE SHAPE OF THE ANSWER, AND WHY THERE ARE THREE OF THEM.
-- Partners consume much of the gross on these deals. A $3.5B data center
-- internals package built by Elite Solutions / Avant is revenue generated at
-- the project and none of it is ours; our share is a 1.5%-a-year commission
-- split with them. So every figure exists three times — revenue generated,
-- Ber Wilson gross, and Ber Wilson net of SPV ownership — and the pipeline
-- rolls up the third. A $500M project where we earn a $20M fee is a $20M deal.
--
-- WHY `line_type` IS A CHECK AND `lead_categories` WAS NOT.
-- CLAUDE.md §12 says a value set that grows with the business is a TABLE, not a
-- CHECK, and lead routing proved it. A revenue line type is the opposite case:
-- each one is a FORMULA in src/lib/economics/lines.ts, so adding one is
-- necessarily a code change and a CHECK that fails loudly on an unknown value
-- is the correct guard. Benchmarks and templates, which DO grow with the
-- business, are registries below.

-- ───────────────────────────────────────────────────── the model, one per deal

create table if not exists deal_economics (
  id uuid primary key default gen_random_uuid(),

  -- Shared-children convention (CLAUDE.md §4). A deal is modelled long before
  -- it is a project: the whole point is to answer "should we pursue this".
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  constraint deal_economics_parent_check check (num_nonnulls(project_id, opportunity_id) = 1),

  -- No defaults, anywhere in this feature. A hidden discount rate is a hidden
  -- opinion, and a cap rate nobody chose would capitalize an asset value out of
  -- thin air. NULL means nobody has said, and the UI shows it as missing.
  discount_rate_pct numeric(6,3),
  cap_rate_pct numeric(6,3),
  base_year integer,

  -- What a document or a conversation says the deal is worth, WITH ITS SHAPE.
  -- Stockton's $152.5M is an ANNUAL figure; compared against a contract value
  -- over a term the whole of it reads as unattributed and the reconciliation is
  -- useless. The shape is what makes the comparison mean anything.
  stated_total_amount numeric(18,2),
  stated_total_shape text
    check (stated_total_shape in ('recurring', 'contract', 'one_time', 'asset', 'capture')),
  constraint deal_economics_stated_total_check check (
    (stated_total_amount is null and stated_total_shape is null) or
    (stated_total_amount is not null and stated_total_shape is not null)
  ),

  -- Computed by src/lib/economics on save, never by hand. Each one names which
  -- definition of deal size it is: CLAUDE.md §12, one quantity one definition.
  computed_firm_mw numeric(12,3),
  computed_utilization_pct numeric(7,3),
  computed_gross_annual_recurring numeric(18,2),
  computed_gross_contract_value numeric(18,2),
  computed_gross_one_time numeric(18,2),
  computed_gross_project_value numeric(18,2),
  computed_bw_gross_annual_recurring numeric(18,2),
  computed_bw_gross_contract_value numeric(18,2),
  computed_bw_gross_one_time numeric(18,2),
  computed_bw_net_annual_recurring numeric(18,2),
  computed_bw_net_contract_value numeric(18,2),
  computed_bw_net_one_time numeric(18,2),
  computed_bw_net_tax_credits numeric(18,2),
  computed_asset_value numeric(18,2),
  -- Ours, but in a vehicle whose ownership split is not set yet. Held OUT of
  -- the net figures above rather than folded in: an unknown share must never
  -- read as 100%, which would be the most expensive wrong number on the screen.
  computed_undetermined_annual_recurring numeric(18,2),
  computed_undetermined_one_time numeric(18,2),
  computed_capture_pct_of_gross numeric(7,3),

  -- The weakest provenance anywhere in the model. Every headline inherits it.
  computed_status text,
  computed_valid boolean,
  computed_at timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),

  -- One model per record. `nulls not distinct` is load-bearing: exactly one
  -- parent column is NULL on every row, and under the DEFAULT rule two NULLs
  -- never compare equal, so a plain unique key would enforce nothing while
  -- looking present and every save would stack another model beside the first.
  unique nulls not distinct (project_id, opportunity_id)
);

-- ──────────────────────────────────────────────────── where megawatts come from

create table if not exists economics_capacity_sources (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,

  label text not null,
  kind text not null default 'grid_interconnect'
    check (kind in ('grid_interconnect', 'onsite_generation', 'storage')),

  nameplate_mw numeric(12,3),
  -- NULL means no derate is claimed. It does NOT mean zero availability.
  availability_pct numeric(6,3),

  -- The N+X case. 24 blocks of 50 MW with 4 held redundant is 1,000 MW firm,
  -- not 1,200, and a block design wins over a nameplate figure because it is
  -- the statement of how the plant is actually built.
  block_count integer,
  redundant_blocks integer,
  block_mw numeric(12,3),

  -- What a counterparty or a document asserts the net figure is, kept BESIDE
  -- the derived one and never applied over it. Same doctrine as
  -- project_parcels.acres vs assessor_acres: collapsing a disagreement into one
  -- number loses the fact that anyone disagreed, which is the fact worth
  -- keeping. A mismatch raises a warning and changes no arithmetic.
  stated_net_mw numeric(12,3),

  status text not null default 'planning_assumption',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ───────────────────────────────────────────────────────── the allocation ledger

create table if not exists economics_buckets (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,

  label text not null,
  -- The brief's priority order is seeded from DEFAULT_BUCKETS in
  -- src/lib/economics/types.ts. A user may add their own, so this is data and
  -- never an enum.
  priority integer not null default 100,
  -- Allocations add AVERAGE loads; a plant has to serve the coincident peak.
  -- Sizing to average while ignoring peak is a known failure in the models this
  -- replaces, so peak is recorded where anyone knows it and compared out loud.
  peak_mw numeric(12,3),

  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (economics_id, label)
);

-- ───────────────────────────────────────────── the vehicles that earn the money

create table if not exists economics_spvs (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,

  label text not null,
  purpose text not null default 'other'
    check (purpose in ('land', 'energy', 'data_center', 'housing', 'other')),
  -- The legal entity in the directory, once one exists. The economics model can
  -- run before anything is formed, which is the common case on a pursuit.
  entity_id uuid references entities(id) on delete set null,

  -- ⚠ NULLABLE ON PURPOSE, AND NULL IS NOT 100%. Financing partners will take
  -- ownership inside these SPVs and the splits are not decided. An unset split
  -- must leave the model VALID; what it must not do is let an unknown share
  -- read as all of it. Lines in a vehicle with no split are reported as
  -- undetermined.
  bw_ownership_pct numeric(6,3),

  status text not null default 'planning_assumption',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique (economics_id, label)
);

-- ───────────────────────────────────────────────────────────── the revenue lines

create table if not exists economics_lines (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,

  -- Each type is a formula in src/lib/economics/lines.ts. See the header on why
  -- this is a CHECK and a line of business is not.
  line_type text not null check (line_type in (
    'energy_sale', 'capacity_charge', 'dc_lease', 'subscription', 'om_service',
    'energy_attribute', 'recurring_fee_on_line',
    'one_time_per_mw', 'one_time_per_unit', 'one_time_lump', 'tax_credit', 'land',
    'fee_margin'
  )),
  label text not null,

  spv_id uuid references economics_spvs(id) on delete set null,
  bucket_id uuid references economics_buckets(id) on delete set null,

  -- Whether this line's money is Ber Wilson's AT ALL. False is the common case
  -- on a large deal and is the difference between a $150M deal and an $18M one.
  is_ber_wilson_revenue boolean not null default true,
  -- Whether a fee is a SLICE of the line it references or money paid ON TOP of
  -- it. EPC margin is a carve-out, so gross stays $150M and never becomes
  -- $168M. A commission the owner pays is incremental and belongs in the gross.
  is_carve_out boolean not null default false,
  counts_toward_project_value boolean not null default true,

  -- Self-references. ON DELETE SET NULL rather than cascade: deleting the line
  -- a fee is charged against should surface as an error the reader can see and
  -- fix, not silently delete their fee.
  referenced_line_id uuid references economics_lines(id) on delete set null,
  rides_on_line_id uuid references economics_lines(id) on delete set null,

  -- recurring shape
  start_year integer,
  term_years integer,
  escalator_pct numeric(6,3),
  -- Per-year multipliers, year 1 first. Shorter than the term carries the LAST
  -- value forward: a lease-up of {0.3,0.7,1} over 15 years is stabilized from
  -- year 3, not dark from year 4.
  ramp numeric(6,4)[],

  -- quantities
  mw numeric(12,3),
  it_mw numeric(12,3),
  acres numeric(12,2),
  quantity numeric(18,3),
  units numeric(18,3),

  -- prices, each with its unit where a unit is possible
  price numeric(18,6),
  price_unit text,
  price_per_mw numeric(18,2),
  price_per_unit numeric(18,4),
  price_per_unit_month numeric(18,4),
  price_per_mwh numeric(18,4),
  rate_per_kw_month numeric(18,4),
  annual_rent numeric(18,2),
  amount numeric(18,2),
  capital_base numeric(18,2),

  -- costs, so a line can report a margin and not only revenue
  cost numeric(18,2),
  cost_per_mw numeric(18,2),
  cost_per_unit numeric(18,4),
  opex_annual numeric(18,2),
  fixed_om_per_kw_year numeric(18,4),
  variable_om_per_mwh numeric(18,4),
  heat_rate numeric(12,2),
  gas_price_per_mmbtu numeric(12,4),

  -- factors and rates, all fractions or percents as their names say
  load_factor numeric(6,4),
  occupancy numeric(6,4),
  pue numeric(6,3),
  minimum_take_pct numeric(6,3),
  annual_rate_pct numeric(8,4),
  our_share_pct numeric(6,3),
  pct_of_line numeric(8,4),

  -- discriminators and labels
  mode text check (mode in ('forward', 'reverse')),
  fee_base text
    check (fee_base in ('referenced_line_value', 'referenced_line_annual_revenue', 'capital_base')),
  disposition text check (disposition in ('sale', 'lease')),
  credit_kind text check (credit_kind in ('48E', '45X', '45Q', 'other')),
  attribute_kind text,
  unit_label text,
  counterparty text,
  partner_label text,

  transferable boolean not null default false,
  -- When power is passed through to the tenant it is not revenue to the lessor.
  -- Both flags exist so a model that DOES keep it says so deliberately, and so
  -- the double count can be warned about.
  power_passed_through boolean not null default false,
  power_revenue_retained boolean not null default false,

  status text not null default 'planning_assumption',
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create table if not exists economics_line_schedule (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references economics_lines(id) on delete cascade,

  -- Milestones only. A lease-up ramp is `economics_lines.ramp`, a plain array
  -- of per-year multipliers.
  --
  -- ⚠ `kind` ONCE ALLOWED 'ramp' TOO AND THAT WAS DRIFT, NOT FLEXIBILITY. Two
  -- places to store one idea means one of them is wrong and nothing reports
  -- which. The column stays because a milestone schedule may later need a
  -- second flavour, but an unused option is a second schema waiting to
  -- disagree with the first.
  kind text not null default 'milestone' check (kind in ('milestone')),
  label text not null default '',
  pct numeric(8,4),
  due_date date,
  months_from_ntp integer,

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ───────────────────────────────────────────── where each number came from

create table if not exists economics_provenance (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,
  -- NULL for a deal-level input such as the discount rate.
  line_id uuid references economics_lines(id) on delete cascade,
  -- The field as the UI labels it, so the reader recognises what is sourced.
  field_key text not null,

  status text not null default 'planning_assumption' check (status in (
    'planning_assumption', 'benchmark', 'vendor_quoted',
    'loi_term_sheet', 'contracted', 'validated'
  )),
  -- Document, vendor, benchmark name or person, shown verbatim.
  source text,
  -- A document id, a benchmark key, a message id: whatever can be chased.
  source_ref text,
  as_of date,
  -- What is missing to advance this one step, in the author's own words:
  -- "load study not done", "rate not adopted".
  note text,

  -- An output inherits the WEAKEST status among its inputs, so one planning
  -- assumption beside three contracted figures makes the output a planning
  -- number. That is what keeps a planning figure from being read as a
  -- commitment, and it is the whole reason this table is per FIELD.
  created_at timestamptz not null default now(),
  updated_at timestamptz default now(),
  unique nulls not distinct (economics_id, line_id, field_key)
);

-- ─────────────────────────────────────────── how the numbers changed, and why

create table if not exists economics_versions (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,

  version integer not null,
  label text,
  -- Why this version exists. The reason is the point: a diff shows what moved,
  -- a note says what happened.
  note text,

  -- The whole model and its computed result, frozen. Wide jsonb on purpose, and
  -- therefore deliberately NOT in `_audited_in_full`: a generic column diff over
  -- this would write both copies into activity_log on every touch, which is
  -- exactly why that list is gated.
  input_snapshot jsonb not null,
  result_snapshot jsonb not null,

  created_by text,
  created_at timestamptz not null default now(),
  unique (economics_id, version)
);

-- ───────────────────────────────────────────────── registries: rows, not code

create table if not exists economics_benchmarks (
  id uuid primary key default gen_random_uuid(),
  -- Stable handle a line's provenance points at, so a renamed benchmark keeps
  -- its link to every input it priced.
  key text not null unique,
  label text not null,

  -- A range is the honest form for most market data. `value_low` alone is a
  -- point estimate; both set is a band.
  value_low numeric(18,6),
  value_high numeric(18,6),
  -- Free text because benchmarks span $/kW-month, $/MW, $/kWh, cap rate points
  -- and Btu/kWh, and the set grows with the market, not with the code.
  unit text not null,
  geography text,

  -- ⚠ A BENCHMARK WITHOUT A SOURCE AND A DATE IS A RUMOUR. Picking one sets an
  -- input's status to 'benchmark' with this source, and anything over twelve
  -- months old warns before it prices a deal.
  source text,
  as_of date,
  notes text,

  -- Badge tone NAME, resolved against a palette declared literally in source.
  -- ⚠ NEVER A TAILWIND CLASS STRING: v4 emits only what it finds by scanning
  -- source, so classes read from the database produce an unstyled element with
  -- no error anywhere (CLAUDE.md §12).
  tone text not null default 'slate',
  -- Seeded entries start here. Richard maintains the library.
  needs_review boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create table if not exists economics_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,

  -- Structure only: which buckets, which line types, which SPVs. jsonb because
  -- a template is read whole and never edited row by row.
  --
  -- ⚠ A TEMPLATE NEVER CARRIES A PRICE. It sets up the shape so nobody starts
  -- from blank; filling a price is the human's act, and a price arriving from a
  -- template would be an unsourced planning assumption wearing a structure's
  -- authority.
  structure jsonb not null default '{}'::jsonb,

  active boolean not null default true,
  -- Code depends on this row by key; the UI must not offer to delete or rename.
  system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ───────────────────────────────── what the AI proposes, for a human to accept

create table if not exists economics_input_proposals (
  id uuid primary key default gen_random_uuid(),
  economics_id uuid not null references deal_economics(id) on delete cascade,
  line_id uuid references economics_lines(id) on delete cascade,

  -- Which input this is a proposal FOR. NULL line_id plus a deal-level key is a
  -- proposal for the discount rate, the cap rate or a stated total.
  field_key text not null,
  proposed_value numeric(18,6),
  proposed_unit text,
  -- A proposal may also suggest a whole line that does not exist yet.
  proposed_line_type text,
  proposed_label text,

  -- ⚠ NOTHING WRITES A NUMBER INTO A CALCULATION WITHOUT A SOURCE. The quote is
  -- not decoration: it is how a reader decides in two seconds whether the model
  -- read the document correctly, and it is what the accepted input's provenance
  -- inherits.
  source_document_id uuid,
  source_quote text,
  confidence numeric(3,2),
  reasoning text,

  -- `pending` is the only state a machine may write. A human moves it to
  -- accepted or rejected, and re-extraction must never overwrite either —
  -- the same contract `commitments` holds between its machine and human states.
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected')),
  decided_by text,
  decided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────── the pipeline's own three columns

-- Denormalized onto the record so the kanban, the dashboard and the map can
-- sort and sum without a join. Everything else lives on deal_economics.
--
-- ⚠ THE NAME IS THE DEFINITION. CLAUDE.md §12: one quantity, one definition, or
-- the reader trusts none of them. This column is Ber Wilson's NET capture and
-- nothing else, which is why `estimated_value` is being cleared rather than
-- reused: that column meant five different things across eight projects.
alter table projects add column if not exists economics_capture_value numeric(18,2);
alter table projects add column if not exists economics_status text;
alter table projects add column if not exists economics_computed_at timestamptz;

alter table opportunities add column if not exists economics_capture_value numeric(18,2);
alter table opportunities add column if not exists economics_status text;
alter table opportunities add column if not exists economics_computed_at timestamptz;

-- ────────────────────────────────────────────────────── indexes, RLS and grants

create index if not exists idx_deal_economics_project
  on deal_economics (project_id) where project_id is not null;
create index if not exists idx_deal_economics_opportunity
  on deal_economics (opportunity_id) where opportunity_id is not null;
create index if not exists idx_economics_sources on economics_capacity_sources (economics_id, sort_order);
create index if not exists idx_economics_buckets on economics_buckets (economics_id, priority);
create index if not exists idx_economics_spvs on economics_spvs (economics_id, sort_order);
create index if not exists idx_economics_lines on economics_lines (economics_id, sort_order);
create index if not exists idx_economics_lines_ref on economics_lines (referenced_line_id)
  where referenced_line_id is not null;
create index if not exists idx_economics_lines_rides on economics_lines (rides_on_line_id)
  where rides_on_line_id is not null;
create index if not exists idx_economics_schedule on economics_line_schedule (line_id, kind, sort_order);
create index if not exists idx_economics_provenance on economics_provenance (economics_id, line_id);
create index if not exists idx_economics_versions on economics_versions (economics_id, version desc);
create index if not exists idx_economics_benchmarks_active
  on economics_benchmarks (sort_order) where active;
create index if not exists idx_economics_templates_active
  on economics_templates (sort_order) where active;
-- The only query the review queue runs.
create index if not exists idx_economics_proposals_pending
  on economics_input_proposals (economics_id) where status = 'pending';

do $$
declare
  t text;
begin
  foreach t in array array[
    'deal_economics', 'economics_capacity_sources', 'economics_buckets',
    'economics_spvs', 'economics_lines', 'economics_line_schedule',
    'economics_provenance', 'economics_versions', 'economics_benchmarks',
    'economics_templates', 'economics_input_proposals'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format(
      'create trigger set_updated_at before update on %I for each row execute function update_updated_at()',
      t
    );
    execute format('alter table %I enable row level security', t);

    execute format('drop policy if exists "Authenticated users can read %s" on %I', t, t);
    execute format(
      'create policy "Authenticated users can read %s" on %I for select to authenticated using (true)',
      t, t
    );
    execute format('drop policy if exists "Authenticated users can write %s" on %I', t, t);
    execute format(
      'create policy "Authenticated users can write %s" on %I for all to authenticated using (true) with check (true)',
      t, t
    );

    -- Explicit, not inherited. A table created by anything but `postgres`
    -- receives NO api grants and answers 42501 to every PostgREST call while
    -- looking perfectly healthy in psql (CLAUDE.md §12, 09-24).
    execute format('grant select on %I to anon', t);
    execute format('grant all on %I to authenticated, service_role', t);
  end loop;
end $$;
