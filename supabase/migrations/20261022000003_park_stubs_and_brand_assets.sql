-- Two placeholder records out of the live pipeline, and four logo files out of
-- the company knowledge base.
--
-- MEASURED 2026-10-22, per-record, across every child table.
--
-- ⚠ `projects.status` HAS NO `archived` MEMBER — it is active | on_hold | won
-- | lost | closed — and §12 is explicit that where a column has no honest
-- value you refuse rather than guess an enum member. So these are parked as
-- `on_hold`, which is what the enum actually offers for "real but dormant",
-- reversible in one click, and already in use on one other project.
--
-- ⚠ AND THE `stage` ON DFCM IS LEFT NULL DELIBERATELY. `project_stage` is
-- pursuit | capture | bid | award | mobilization | execution | closeout, with
-- nothing meaning "parked". Writing `pursuit` would assert the bid is being
-- pursued, which is the one thing five months of silence argues against. The
-- NULL `status` was the real defect — a nullable status hides a row from every
-- reader that filters on it (§12, `.neq()` is NULL and therefore not true) —
-- and that is what this fixes.
--
-- NOT TOUCHED: the `Gold mine` opportunity. Its description looked mangled in
-- psql, which escapes a carriage return for display; measured, all 13 CRs are
-- halves of CRLF pairs and so are the 228 other rows across
-- `updates.raw_content`, `opportunity_notes.body` and two descriptions. That
-- is ordinary web-form line endings and renders correctly. Nothing to fix —
-- the premise was wrong, as it has been every other time (§13).

begin;

-- ── Tonga: a placeholder that never became a deal ────────────────────────────
-- Created 2026-07-12, zero documents, players, milestones, tasks, meetings,
-- threads and updates. Its own description reads "Placeholder record for the
-- upcoming Tonga expansion — rename/fill in details", and it has been counted
-- in every project total for three months.
update projects
   set status = 'on_hold'
 where name = 'Tonga Development Project'
   and status = 'active';

-- ── DFCM Camp Williams: a stub with no status at all ─────────────────────────
-- Created 2026-05-05 with NULL status AND NULL stage and nothing attached but
-- one update, which is how it stayed invisible to the pipeline views for five
-- months without anybody noticing it was there.
update projects
   set status = 'on_hold'
 where name = 'DFCM Camp Williams Bldg. 4140 project'
   and status is null;

-- ── Four brand files filed as company knowledge ──────────────────────────────
-- `bwcsi-badge.svg`, `-badge-mono`, `-badge-reversed` and
-- `-lockup-horizontal` arrived through the nightly Drive knowledge sync as
-- doc_type 'capability'. They are the company's logo in four renderings: no
-- text, no chunks (verified: 0), nothing for Ber AI to answer from, and they
-- sit in the queue of 84 unfiled company documents a human is asked to triage.
--
-- `excluded_at` is the tombstone §4 describes — the ROW stays, the bytes stay,
-- and `restoreExcludedDocument()` is the undo. Also what stops the Drive sync
-- re-importing them tonight, which is the behaviour the column exists for.
update documents
   set excluded_at = now(),
       excluded_reason = 'Brand asset, not knowledge — the company logo in four renderings, no extractable text. Excluded 2026-10-22 during the executive-data cleanup.'
 where is_company = true
   and mime_type = 'image/svg+xml'
   and file_name like 'bwcsi-%'
   and excluded_at is null;

commit;
