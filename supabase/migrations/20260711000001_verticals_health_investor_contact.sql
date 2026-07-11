-- Verticals + objective health + investor contact info (2026-07-11)
--
-- 1. Sectors: Ber Wilson's verticals include technology and health, but the
--    project_sector enum only covered the original five. Without these, a
--    health or technology deal has to masquerade as another sector, which
--    corrupts every sector-filtered surface (dashboard, map, brief, fit).
--    Note: ALTER TYPE ... ADD VALUE auto-commits per statement and the new
--    values are never used later in this file, so plain psql -f is safe.
alter type project_sector add value if not exists 'technology';
alter type project_sector add value if not exists 'health';

-- 2. Objectives get an explicit health signal (on_track / at_risk / stalled)
--    so "is this objective being met" is a stated judgment, not something
--    inferred from task churn. Plain text + app constants, per convention.
alter table objectives
  add column if not exists health text not null default 'on_track'
  constraint objectives_health_check check (health in ('on_track', 'at_risk', 'stalled'));

-- 3. Investors: direct email/phone on the record (denormalized like
--    investors.name — the record stands alone; the linked directory party
--    keeps its own copy).
alter table investors
  add column if not exists email text,
  add column if not exists phone text;
