-- Business-card batch intake — photograph a stack of cards, walk away, review
-- the whole stack once.
--
-- A batch stages an email_intake_sessions row exactly as the email, meeting and
-- people runs do: `running` while the cards are read one at a time, `pending`
-- when the stack is ready for review, `confirmed` once the human has saved it.
-- Nothing else about the table changes.
--
-- intake_kind carries a CHECK constraint listing the allowed kinds, so 'cards'
-- has to be added to it or every staged batch dies at INSERT — at runtime,
-- after a clean build and a clean deploy. (§12: adding a discriminator value
-- means checking for a CHECK constraint on it. This is the second time.)

alter table email_intake_sessions
  drop constraint if exists email_intake_sessions_intake_kind_check;

alter table email_intake_sessions
  add constraint email_intake_sessions_intake_kind_check
  check (intake_kind in ('email', 'meeting', 'people', 'cards'));
