-- Prefab steel quote generation.
--
-- Quotes were hand-written in Word. On the reference document (Mira Vista) the
-- square footage appears 5 times, the total 4 times, and the installation rate
-- 5 times across two different phrasings. Retyping a rate and missing one of
-- its occurrences is the failure this feature exists to prevent — a quote that
-- contradicts itself is worse than a slow one.
--
-- Generation copies a Google Doc template, replaces {{TOKENS}}, exports a PDF,
-- and stores it as a documents row on the deal. This table is the record of
-- what was generated, so a quote that has been SENT can never silently change.

-- ============================================================
-- steel_deals — the inputs the quote document needs and nothing holds
-- ============================================================

-- The cover's Location row. Nothing on the deal held a site address: `customer`
-- is who is buying, not where the building goes.
alter table steel_deals add column if not exists site_address text;

-- The cover's Building row reads "44,400 square feet • 3 floors".
alter table steel_deals add column if not exists floors integer;

-- The cover's Conversion row. Deliberately NOT a reuse of `description`, which
-- is the internal Scope & Notes field — "customer is desperate, hold the price"
-- is the kind of thing that lives there, and it must never reach a document the
-- customer signs. A separate column is what makes that structural.
alter table steel_deals add column if not exists scope_summary text;

-- The team's own Drive folder for this deal (Prefab Steel Projects / Utah /
-- <Deal>), read FROM. Mirrors projects.drive_source_folder_id and is NOT the
-- same as drive_folder_id, which is where the platform publishes TO. Conflating
-- them would have publishing write into the team's own filing — and it cannot
-- anyway: the platform holds drive.file, which reaches only files it created.
alter table steel_deals add column if not exists drive_source_folder_id text;
alter table steel_deals add column if not exists drive_source_folder_url text;

create index if not exists idx_steel_deals_drive_source
  on steel_deals (drive_source_folder_id)
  where drive_source_folder_id is not null;

comment on column steel_deals.site_address is
  'Where the building goes. Customer-facing: printed on the quote cover.';
comment on column steel_deals.floors is
  'Storey count, printed beside square footage on the quote cover.';
comment on column steel_deals.scope_summary is
  'Customer-facing one-line scope for the quote cover. NOT `description`, which is the internal Scope & Notes field and must never reach a customer document.';
comment on column steel_deals.drive_source_folder_id is
  'The team''s own Drive folder, read FROM. Not drive_folder_id, which is where the platform publishes TO.';

-- ============================================================
-- steel_quotes — one row per generated quote revision
-- ============================================================

-- Quote numbers come from a sequence rather than max()+1 in app code: two reps
-- generating at the same moment must not be handed the same number, and the
-- number has to be readable back over the phone. The pre-existing derived ref
-- (`Q-` + the first 8 characters of the deal id) was a deal identifier wearing
-- a quote's clothes — it could not express a revision at all.
create sequence if not exists steel_quote_seq start 1000;

create table if not exists steel_quotes (
  id uuid default gen_random_uuid() primary key,
  deal_id uuid references steel_deals(id) on delete cascade not null,

  quote_number text not null,                          -- 'Q-2026-1042'
  revision integer not null default 1,

  -- generating -> draft -> issued -> (accepted | declined | superseded).
  -- Plain text with app-side constants, following the vocabulary convention
  -- used by steel stages, opportunities and leads.
  status text not null default 'generating',

  -- Only set when a human explicitly issues it. Generation is cheap and reps
  -- will re-run it while fiddling with numbers; issuing is the commitment.
  issued_at timestamptz,
  valid_until date,

  -- The RESOLVED TOKEN MAP plus the narrowed inputs it was built from. Freezing
  -- the resolved values, not just the inputs, is what stops a later change to
  -- the builder reshaping a quote that has already been sent.
  --
  -- Built from the narrowed QuoteInput type, so it structurally cannot contain
  -- cost, margin or commission — which matters because steel_sales reps can
  -- read this table but are barred from financials.
  inputs jsonb not null default '{}'::jsonb,

  -- The two price-table row labels, editable per quote. KIT_SCOPE in particular
  -- must be editable: a priced `other` line (real freight, permits) folded into
  -- a row labelled "complete prefab panel material package" misdescribes scope.
  kit_scope text,
  install_scope text,

  -- Denormalised for the quote list, so rendering it costs no jsonb digging.
  square_feet numeric(12,0),
  kit_amount numeric(15,2),
  install_amount numeric(15,2),
  total numeric(15,2),

  -- Which template version produced this, so a bad quote traces back to the
  -- wording that made it. The template is hand-editable by design; this is how
  -- an edit that broke something is identified after the fact.
  template_doc_id text,
  template_revision_id text,

  -- The generated Google Doc (the durable artifact — if the PDF export fails
  -- after the copy succeeds, the Doc still exists and can be re-exported).
  drive_file_id text,
  drive_file_url text,

  -- The exported PDF, stored on the deal. ON DELETE SET NULL because the steel
  -- document DELETE route sweeps storage as well as the row; a hand-deleted PDF
  -- must not take the quote record with it.
  document_id uuid references documents(id) on delete set null,

  -- Below the $30/SF floor at generation time. Frozen here rather than read
  -- from the deal at issue time, because the floor question is "was this price
  -- below the floor when it was quoted", not "is it now".
  below_floor boolean not null default false,

  generated_by uuid references team_members(id) on delete set null,

  started_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists idx_steel_quotes_number
  on steel_quotes (quote_number, revision);

create index if not exists idx_steel_quotes_deal
  on steel_quotes (deal_id, created_at desc);

-- The concurrency latch: two simultaneous Generate requests on one deal must
-- not both run. The second fails fast on this index rather than racing to
-- create a second Doc. A row stuck in 'generating' is aged out by the caller.
create unique index if not exists idx_steel_quotes_generating
  on steel_quotes (deal_id)
  where status = 'generating';

-- The number is assigned by the DATABASE, not the app: two reps pressing
-- Generate in the same second must not be handed the same one. A revision
-- supplies its parent's number explicitly and so bypasses this default.
alter table steel_quotes
  alter column quote_number
  set default 'Q-' || to_char(now(), 'YYYY') || '-' || nextval('steel_quote_seq');

comment on column steel_quotes.inputs is
  'Frozen resolved token map + narrowed inputs. Contains no cost/margin/commission by construction.';
comment on column steel_quotes.status is
  'generating | draft | issued | accepted | declined | superseded. See src/lib/utils/steel-quotes.ts.';

-- updated_at only. Deliberately NOT log_activity(), which dereferences
-- new.project_id unconditionally — the same reason steel_deals, investors and
-- opportunities do not carry it.
drop trigger if exists set_updated_at on steel_quotes;
create trigger set_updated_at
  before update on steel_quotes
  for each row execute function update_updated_at();

-- RLS — authenticated users get full access (app traffic uses the service role;
-- RLS is defense-in-depth, per CLAUDE.md §8).
alter table steel_quotes enable row level security;
drop policy if exists "steel_quotes_select" on steel_quotes;
drop policy if exists "steel_quotes_insert" on steel_quotes;
drop policy if exists "steel_quotes_update" on steel_quotes;
drop policy if exists "steel_quotes_delete" on steel_quotes;
create policy "steel_quotes_select" on steel_quotes for select using (auth.role() = 'authenticated');
create policy "steel_quotes_insert" on steel_quotes for insert with check (auth.role() = 'authenticated');
create policy "steel_quotes_update" on steel_quotes for update using (auth.role() = 'authenticated');
create policy "steel_quotes_delete" on steel_quotes for delete using (auth.role() = 'authenticated');

-- documents needs no change: steel_deal_id and the widened documents_scope_check
-- already cover a quote PDF (20260803000001_steel_comp_plan.sql), and doc_type
-- is free text.

-- ============================================================
-- steel_deal_services.price_per_sqft — per-line $/SF pricing
-- ============================================================
--
-- Steel is quoted per square foot, so the natural way to price a line is to
-- type the RATE and let the total follow from the building size. Typing the
-- extended total instead invites arithmetic mistakes and goes stale the moment
-- the square footage is corrected.
--
-- NULL means the line is a lump sum (freight, a permit fee) typed straight
-- into `price`. Not to be confused with `cost_per_sqft`, which is the cost side
-- of the same line.
alter table steel_deal_services add column if not exists price_per_sqft numeric(15,4);

comment on column steel_deal_services.price_per_sqft is
  'Customer RATE when the line is priced per square foot; price is derived as deal.square_feet x this. NULL = lump sum typed into price. Not cost_per_sqft, which is the cost side.';
