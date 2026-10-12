-- A task may be the thing a commitment became.
--
-- WHY A POINTER AND NOT A FLAG. Two things need it. First the latch: the
-- internal-thread pass runs on every sweep and must never create a second task
-- for an obligation it already promoted, including after the task is completed
-- or deleted — so the link has to survive both. Second the ranking: a task's
-- tier is read partly from how live the CONVERSATION behind it is, and the only
-- route from a task to that conversation is commitment → thread.
--
-- UNIQUE, because one commitment is one task. §12 warns that a unique index on
-- a foreign key means at most one child and that silently keeping the first is
-- worse than keeping none — true where a set is being stored (three follow-ups
-- from one lead), and the right constraint here, where the task IS the
-- obligation rather than one of several responses to it.
--
-- ON DELETE SET NULL, not cascade: deleting a commitment row is an admin act
-- on the ledger, and it must not silently remove work from somebody's board.
alter table tasks
  add column if not exists commitment_id uuid
    references commitments(id) on delete set null;

create unique index if not exists tasks_commitment_id_key
  on tasks (commitment_id)
  where commitment_id is not null;

comment on column tasks.commitment_id is
  'The commitment this task was promoted from, if any. Set by the internal-thread auto-task pass (src/lib/commitments/internal-tasks.ts). Unique: one commitment becomes at most one task, and the link outlives both completing and deleting the task so the pass cannot recreate it.';
