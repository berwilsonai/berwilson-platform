-- Collapse the duplicate rolodex rows, and give `parties` the tombstone
-- `entities` has had since 2026-10-21.
--
-- MEASURED FIRST (§12 — the bloat has never once been where the rule assumed).
-- On 2026-10-22, 186 parties held 15 rows that are really 6 people plus one
-- role mailbox: `Trent Staggs` x4, `Dino Plumbing HVAC & Electrical` x3,
-- `John Peden` x2, and four near-duplicate pairs a trigram sweep found
-- (Gilles x3, Manto, Mumm, Sipe). Two of the four Staggs rows each carried a
-- `project_players` row on a DIFFERENT project, so his profile showed half his
-- history whichever row you opened.
--
-- ⚠ THE DUPLICATE STATE WAS SELF-AMPLIFYING, AND THAT IS FIXED IN CODE, NOT
-- HERE. `matchParty` in `src/lib/curator/fold.ts` returned "no match" for
-- three different outcomes — nothing found, two rows sharing an address, and
-- an organization row — and the caller creates a contact whenever it gets no
-- match. So every refusal added the row that guaranteed the next refusal.
-- `dinoservicepros@gmail.com` was archived by hand on 10-21 under the
-- `auto-contact` undo and TWO fresh rows appeared on 10-22. Merging without
-- that fix would have been undone within a day.
--
-- NOTHING IS DELETED. Every loser keeps its row, gains `merged_into_party_id`
-- and goes `archived`: clear the pointer and restore the status and the row is
-- back. That also makes the merge durable, because the archived row is exactly
-- the mark the repaired matcher now refuses to create around.
--
-- NOT MERGED, DELIBERATELY:
--   * `Cleveland-Cliffs` and `Cleveland-Cliffs Steelton LLC` — Richard's call
--     2026-10-22: different legal entities. The LLC is the named seller on the
--     signed Steelton PSA (§13); the parent is the corporate group.
--   * `Danyelle` and `Danyelle Hinton` — `Danyelle` is on `team_members`, so
--     she is one of ours, not a counterparty. A merge here would have folded a
--     team member into an external consultant's record.

begin;

-- ── The tombstone, mirroring `entities` ──────────────────────────────────────
alter table parties
  add column if not exists merged_into_party_id uuid references parties(id) on delete set null,
  add column if not exists merged_at timestamptz;

comment on column parties.merged_into_party_id is
  'Set when this row was merged into another contact. The row IS the tombstone (§12): it keeps the merge reversible, and because the loser stays `archived` the curator''s matcher refuses to create around it rather than re-fragmenting the contact.';

create index if not exists idx_parties_merged_into
  on parties (merged_into_party_id) where merged_into_party_id is not null;

-- ── The merge ────────────────────────────────────────────────────────────────
--
-- Winners were chosen by which row carries the HISTORY, not by which looks
-- tidiest: Manto's and Mumm's older rows hold six `project_players` rows
-- between them while the newer rows hold only an address, so the address moves
-- onto the older row rather than the history moving onto the newer one.
--
-- Verified before writing: no (project_id, party_id, role) collision exists on
-- any repoint — Staggs' two player rows are on different projects.
create temporary table merge_map (loser uuid primary key, winner uuid not null) on commit drop;

insert into merge_map (loser, winner) values
  -- Trent Staggs x4 → the row holding the Myton Rail player link
  ('d7bbac65-b7d0-4c71-8334-c5dfee269995', '6678de46-4d80-4844-aabc-313b4730e547'),
  ('5a5c3898-58e2-471a-bb41-2c463d322705', '6678de46-4d80-4844-aabc-313b4730e547'),
  ('2f40335f-4821-4698-af58-35b17d1b3272', '6678de46-4d80-4844-aabc-313b4730e547'),
  -- John Peden x2 → the row that records he is a GC
  ('c5fe875d-32fd-4b14-a925-341376c05763', '5f9b7d4e-1d08-488b-a58a-f0af401aa020'),
  -- Gilles x3 → Richard's call 2026-10-22: one person across three ventures.
  -- The winner's own player role reads "GridEdge Managing Director/Fundraiser",
  -- which is what ties the barnraisersgroup address to the gridedgedc one.
  ('ff475b67-a659-48d7-a3c9-1a888d54849d', '2c9a1c90-dd73-46f9-ab02-ae95130ee8e4'),
  ('90c711b9-d310-4861-b6f8-0133a3e59dba', '2c9a1c90-dd73-46f9-ab02-ae95130ee8e4'),
  -- Charles L. Manto (4 players, 3 roles) keeps the history; the newer row's address moves to it
  ('10f05e47-77b9-49a3-8d91-09a4563bee1f', '41aeaf42-cb66-45e2-bfcb-72caceeb3d99'),
  -- Dr Hans Mumm (2 players, 2 roles) likewise
  ('89961b61-24af-40e8-aa56-9ab13f21886a', 'cbc6b2d7-b84d-4e59-819e-d2f554eed177'),
  -- Sipe: his own address spells it "Jonathon", so that row wins
  ('02095e1b-abbf-4803-834d-c159a71e3876', '38624f9b-c567-4899-979c-56109d524214'),
  -- Dino Plumbing: the role mailbox of our own operating company (§4 — NOT a
  -- vendor). The 10-16 row is already archived and already flagged as an
  -- organization, so it wins and the two rows the loop created today retire.
  ('d1f55472-7ad3-4558-9a2a-ee8729f1de58', '2fb9ec87-eab0-482a-b586-8d0c2d141f3b'),
  ('68817aac-2e5d-4513-89a0-38b575800c67', '2fb9ec87-eab0-482a-b586-8d0c2d141f3b');

-- Children. Every FK that points at `parties` was enumerated from
-- pg_constraint before this was written (20 columns over 19 tables); only
-- these three hold any row for a loser, and the census is reproduced in
-- docs/BUILD-LOG.md so the next merge does not have to re-derive it.
--
-- ⚠ The CASCADE columns are why this cannot be a delete: `chunks`,
-- `contact_aliases`, `media`, `party_entities`, `party_roles` and
-- `project_players` all cascade from `parties`, so dropping a duplicate row
-- would take its deal links and its roles with it.
update project_players pp set party_id = m.winner
  from merge_map m where pp.party_id = m.loser;

update party_roles pr set party_id = m.winner
  from merge_map m
 where pr.party_id = m.loser
   and not exists (
     select 1 from party_roles keep
      where keep.party_id = m.winner and keep.role_key = pr.role_key
   );
delete from party_roles pr using merge_map m where pr.party_id = m.loser;

-- ── Fill the winner's blanks from the loser, never overwrite ─────────────────
-- §12: filling a blank and overwriting a value are different acts and only one
-- is safe to automate. The address is the whole reason the newer rows exist.
update parties w set
  email   = coalesce(w.email, l.email),
  phone   = coalesce(w.phone, l.phone),
  title   = coalesce(w.title, l.title),
  company = coalesce(w.company, l.company),
  linkedin_url = coalesce(w.linkedin_url, l.linkedin_url)
  from merge_map m join parties l on l.id = m.loser
 where w.id = m.winner;

-- The addresses a merge cannot keep, written where a human will read them:
-- `parties.email` is one column and `contact_aliases` is empty and unread by
-- any matcher, so inventing a second mechanism here would be a producer with
-- no consumer (§12).
update parties w set
  relationship_notes = concat_ws(
    E'\n',
    nullif(w.relationship_notes, ''),
    'Merged 2026-10-22 from ' || dup.names || '. Other addresses on file: ' || dup.emails || '.'
  )
  from (
    select m.winner, string_agg(distinct l.full_name, ', ') names,
           string_agg(distinct l.email, ', ') emails
      from merge_map m join parties l on l.id = m.loser
     where l.email is not null
     group by m.winner
  ) dup
 where w.id = dup.winner
   and dup.emails is not null
   and dup.emails <> coalesce(w.email, '');

-- ── Retire the losers ────────────────────────────────────────────────────────
update parties l set
  merged_into_party_id = m.winner,
  merged_at = now(),
  status = 'archived'
  from merge_map m where l.id = m.loser;

commit;
