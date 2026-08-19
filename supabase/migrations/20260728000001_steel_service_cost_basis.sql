-- Steel service cost basis (per square foot).
--   Materials and Frame Assembly costs are driven by a cost basis PER SQUARE
--   FOOT (steel defaults to $20/SF); the stored dollar `cost` is computed as
--   square_feet × cost_per_sqft. Engineering stays a manual dollar cost each
--   time (no per-SF basis), so cost_per_sqft is left null for it.
--
--   `cost` remains the source of truth for all margin/commission math; this
--   column just records the basis that produced it so it survives an edit and
--   recomputes when square footage changes. Confidential like the other cost
--   fields (admin/executive only in the app).

alter table steel_deal_services
  add column if not exists cost_per_sqft numeric(15,4);

comment on column steel_deal_services.cost_per_sqft is
  'Cost basis per square foot (materials/assembly). cost = square_feet × cost_per_sqft. Null for engineering (manual dollar cost).';
