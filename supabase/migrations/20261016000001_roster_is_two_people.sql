-- The company is Eric and Richard.
--
-- Richard, 2026-10-16: "We don't have a COO. Get rid of traces of Tarek or
-- Nancy or anyone else. The company is just Eric and Richard right now."
--
-- The 2026-07-18 org seed (20260718000001_org_structure.sql) wrote a leadership
-- roster that has not been true for some time: Nancy Thunell as Chairwoman /
-- interim CFO, Tarek "Rick" Nosseir as COO, Dennis Allen as a director. Nancy's
-- and Dennis's rows were cleared by hand at some point; Tarek's survived, and
-- the seed still fires on any database rebuilt from migrations, so every one of
-- them would come back. This runs AFTER that seed and is therefore the durable
-- answer in both directions.
--
-- ⚠ WHAT THIS DELIBERATELY DOES NOT TOUCH. These people really did correspond,
-- and the correspondence is a true record: 82 email_threads, 16 commitments,
-- 2 meetings and 245 indexed passages name them and all of it stays. What goes
-- is only the claim that they work here.
--
-- ⚠ NEITHER parties NOR project_players CARRIES THE AUDIT TRIGGER (org_people
-- does), so activity_log cannot recover these rows. The snapshots below are the
-- undo — restore from them, not from the log.

-- ── org_people: every NAMED person other than the two executives ────────────
-- Matched by name rather than by id, so this also catches the seeded copies on
-- a rebuilt database, where the ids are freshly generated.
--
-- Removed here (id | tier | name | role | node):
--   6d24de09… | leadership | Tarek "Rick" Nosseir | Director              | —
--   0a9c6d0d… | director   | Amy Clark            | Director, Real Estate | —
--   20a5df67… | director   | Brooke Stonebraker   | Director of Underwriting | —
--   8b864c44… | —          | Rocky                | President    | H2O Cardio SPV
--   450263c4… | —          | Doc Elements         | Head of R&D  | Nano Water
--   dbce83f3… | —          | Colton               | Sales and Marketing | Pre Fab Steel
--   92cfd2ec… | —          | Dr Gary Samuelson    | Head of R&D  | Golden Rock Holdings
-- Plus, on a rebuilt database: Nancy Thunell (Chairwoman / interim CFO),
-- Dennis Allen (Director, Biz Dev / Capital Raising), Brooke (Underwriting).
--
-- The three VACANT seats (name is null — Legal & Compliance, Controller /
-- Accounting, People Operations) are roles, not people, and stay.
delete from org_people
 where name is not null
   and name !~* '(Ericson|Eric)\s+Tua|Richard\s+White';

-- Nancy survived inside Tarek's detail text as well as in her own row; scrub any
-- residue from the detail of whoever is left.
update org_people
   set detail = nullif(btrim(regexp_replace(detail, '\s*·?\s*joint CFO oversight with Nancy', '', 'gi')), '')
 where detail ~* 'Nancy|Tarek';

-- ── project_players: the three roles presenting them as ours ────────────────
-- Snapshot (id | project | party | role):
--   f0c28455-3baa-4c78-be9c-3e3cde64dbec | a5148ca8-259a-4a69-b71d-5aed8d25b764 (Myton Rail)
--       | aca47766-b405-4292-9477-6bc5f852399f (Tarek)
--       | 'New COO overseeing operations, strategy, and international expansion'
--   f0376236-2380-4625-8408-fb12da801fab | a5148ca8-259a-4a69-b71d-5aed8d25b764 (Myton Rail)
--       | d7bc3ce2-6070-4844-91ae-b51b1c8e34f8 (Nancy Thunnel)
--       | 'Strategic partner / family office principal reviewing capital and equity structuring'
--   3ca4b237-111a-49e4-b913-d8ee8d333024 | af323c84-b51e-44c7-a8ad-eb109477e095 (Stockton Power Nexus)
--       | d7bc3ce2-6070-4844-91ae-b51b1c8e34f8 (Nancy Thunnel)
--       | 'Ber Wilson Evaluator'
delete from project_players
 where party_id in (
   select id from parties where full_name in ('Tarek', 'Nancy Thunnel')
 );

-- ── parties: archive, do not delete ─────────────────────────────────────────
-- 'archived' is the app's own soft delete (see api/parties/[id] and
-- bulk-delete), so this is exactly the Archive button and is reversible by
-- flipping status back to 'active'. Their correspondence stays attached.
update parties
   set status = 'archived'
 where full_name in ('Tarek', 'Nancy Thunnel')
   and status <> 'archived';

-- ── parties.company: four contacts claiming to work here ────────────────────
-- Mislabelled by extraction, not a roster anyone typed. The CONTACT stays and
-- nothing else on the row is touched — only the employer claim is cleared.
-- Snapshot: Jerrod Ewell, Jerry Chizmadia (HVAC Expert), Jonathan Sipe and
-- Taylor Scalley each carried company = 'Ber Wilson'.
update parties
   set company = null
 where company ~* '^\s*ber ?wilson'
   and full_name not in ('Ericson Tua''one', 'Richard White');
