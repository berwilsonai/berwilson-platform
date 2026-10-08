-- A meeting title becomes a filing key, learned from a human filing decision.
--
-- WHY. `resolveMeetingTarget` files a Meet transcript only when a segment of the
-- meeting title matches a record name EXACTLY. Measured on the live corpus that
-- bar files 2 of 5 transcripts: "Ber Wilson/Tensor Discuss Uintah Basin" names
-- the Myton Development deal by its GEOGRAPHY, which is how executives title
-- these calls, and no amount of fuzzy matching makes "Uintah Basin" into
-- "Myton Development" safely.
--
-- What does work is the mechanism `record_identifiers` already is: a person
-- filing a thread onto a record is saying "this belongs here", and recording
-- what it was identified BY turns one filing into a rule. A meeting title is the
-- same kind of fact as a parcel number — a label a human chose, stable across
-- the series of calls about one deal, and never inferred by the matcher itself
-- (§12: a matcher must never learn from its own matches).
--
-- `kind` is a CHECK, so a third value is necessarily a migration (§12: adding a
-- discriminator means checking for a CHECK on it — a new value typechecks,
-- deploys, then fails at every INSERT).
--
-- ⚠ `source_thread_id` STAYS NULLABLE AND IS NULL FOR THESE. A meeting title is
-- learned from an intake session, not from a Gmail thread, and the column is an
-- FK to email_threads — so inventing a thread id to fill it would be a lie the
-- FK would reject anyway. The mail router must therefore keep ignoring this
-- kind: see loadIdentifiers(), which now filters to parcel/party explicitly
-- rather than loading every row. A short meeting title contained in an email
-- body would otherwise file that mail by coincidence.

alter table record_identifiers
  drop constraint record_identifiers_kind_check;

alter table record_identifiers
  add constraint record_identifiers_kind_check
  check (kind = any (array['parcel'::text, 'party'::text, 'meeting_title'::text]));
