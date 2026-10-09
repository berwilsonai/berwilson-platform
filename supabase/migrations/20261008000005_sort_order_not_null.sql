-- sort_order becomes NOT NULL on the four tables that had drifted.
--
-- ⚠ FOUND BY REPAIRING `npm run gen-types` (2026-10-08). The generated types
-- had been frozen since before the cutover and said `sort_order: number` on
-- org_nodes and org_people; the live columns are nullable. Regenerating turned
-- that into twelve type errors in one comparator — `a.sort_order - b.sort_order`
-- over a NULL is NaN, and `NaN || fallback` is FALSY, so the comparator would
-- have silently fallen back to created_at ordering rather than failing. Nothing
-- would have reported it.
--
-- Eighteen tables carry a sort_order. Thirteen are already NOT NULL with a
-- default; these four have the SAME `default 0` and are merely nullable, which
-- is history rather than a decision. All four hold zero NULL rows (18 / 5 / 24
-- / 12 rows checked), so this constrains what is already true.

alter table investor_requirements alter column sort_order set not null;
alter table milestones            alter column sort_order set not null;
alter table org_nodes             alter column sort_order set not null;
alter table org_people            alter column sort_order set not null;
