-- Steel deals: flag deals priced below the $30/SF steel floor as needing
-- management approval. Persisted so executives can spot below-floor pricing on
-- the deal list/detail without opening the form. Set at save time from the
-- effective steel price per SF (materials price ÷ square feet, or the entered
-- Price/SF). See src/lib/utils/steel.ts (STEEL_PRICE_FLOOR_PER_SQFT).
alter table public.steel_deals
  add column if not exists pricing_below_floor boolean not null default false;
