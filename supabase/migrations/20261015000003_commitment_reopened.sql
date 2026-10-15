-- A human putting an obligation back is a DECISION, and the aging pass has to
-- respect it the way it already respects a snooze.
--
-- ⚠ FOUND BY VERIFYING THE UNDO, NOT BY READING THE CODE. The aging pass
-- retires an open row whose conversation has been silent 45 days, and
-- `settleCommitment(id,'open')` — the documented undo — clears `settled_at` and
-- `settled_by` and returns the row to `status='open'`. Which means the row is
-- once again an open commitment on a thread that is still silent, so the next
-- morning's pass retires it again. The undo worked exactly once and then the
-- platform overruled it, every day, forever.
--
-- A snooze was already exempt because `snoozed_until` survives the pass. A
-- reopen had nothing that survived, because its whole job was to clear the
-- columns. So it needs a mark of its own.
alter table commitments
  add column if not exists reopened_at timestamptz;

comment on column commitments.reopened_at is
  'When a human last put this back on the live ledger. Permanently exempts the '
  'row from automatic aging — they can still settle, dismiss or quiet it, but '
  'the platform may not close it again on its own.';

create index if not exists idx_commitments_reopened
    on commitments (reopened_at) where reopened_at is not null;
