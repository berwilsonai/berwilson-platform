-- Steel deals: fixed 3 services → custom line items.
--   A deal was composed of exactly three fixed service rows (materials,
--   engineering, assembly), one per category. Deals vary — freight, crane,
--   permits, change orders — so a deal is now a list of custom LINE ITEMS.
--   Each line keeps a category (for clean rollups) plus a free-text
--   description, and a `commissionable` flag (the "eligible margin" toggle:
--   pass-through costs like freight can be excluded from commission).
--
-- steel_deal_services stays the table (rows are now line items, not fixed
-- services). service_type is the line's CATEGORY: materials | engineering |
-- assembly | other. Existing rows migrate as-is (one line per old service).

alter table steel_deal_services
  add column if not exists description text,
  add column if not exists commissionable boolean not null default true;

-- Multiple line items per category are now allowed (a deal can have two
-- "materials" lines, etc.). Drop the one-row-per-category unique constraint.
alter table steel_deal_services
  drop constraint if exists steel_deal_services_deal_id_service_type_key;

comment on column steel_deal_services.description is 'Free-text line label (e.g. "Steel package", "Freight"). Falls back to the category label when blank.';
comment on column steel_deal_services.commissionable is 'Whether this line''s margin is eligible for salesperson commission. Pass-through costs are typically not commissionable.';
