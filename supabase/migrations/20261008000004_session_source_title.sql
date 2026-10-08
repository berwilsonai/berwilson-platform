-- Keep the title the ORGANIZER typed, not the one the model wrote.
--
-- ⚠ THE BUG THIS FIXES WOULD HAVE SHIPPED GREEN AND NEVER FIRED. Meeting-title
-- learning (20261008000002) exists so the second call in a series files itself.
-- It learns from the title at CONFIRM time — and the only title the session
-- carried by then was `extraction.title`, which is the model's own rewrite:
--
--   invitation:  "Ber Wilson / Zenthium"
--   model:       "Steelton & Riverdale Site Reviews & Power Capacity Analysis"
--   invitation:  "Ber Wilson/Rebecca/Merlin visit"
--   model:       "...Portfolio Review & Steelton Acquisition Discussion"
--
-- Meet stamps the INVITATION title onto the transcript file, so that is the
-- string the next call will arrive under — and it is the one string that stays
-- the same across a series. Learning the model's rewrite would have stored a
-- key no future meeting can ever present. The identifier table would have
-- filled up with plausible rows while the matcher kept missing, which is the
-- worst shape a bug can take: measurable success, zero effect.
--
-- Same lesson as `bestMatch` reading `summary.deal_name` in preference to its
-- own `subject` argument (§12): COMPOSE ONE NAME AND PASS IT TO BOTH. Here they
-- are genuinely two different names for two different jobs — the model's title
-- is what a human should READ, the invitation's is what the matcher FILES on —
-- so both are kept, named apart, and never substituted for each other.
--
-- Nullable with no default: a pasted set of meeting notes has no invitation and
-- no source title, and that absence is the truth about it.

alter table email_intake_sessions
  add column if not exists source_title text;

comment on column email_intake_sessions.source_title is
  'The meeting title as the organizer typed it into the calendar invitation, recovered from the Meet transcript file name. The FILING key — what resolveMeetingTarget matches and what learnMeetingTitles stores. Never the model''s rewritten title, which lives in extraction_result.title and is for a human to read.';
