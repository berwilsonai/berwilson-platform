-- "Make me a document": the agent's answer stops being prose in a dock.
--
-- Measured 2026-10-22 over all 78 questions ever asked of Ber AI: 20 of them ask
-- for a DELIVERABLE, not an answer. The GridEdge offer was asked six times, the
-- same "review the documents and tell me everything I need to know" four times,
-- and two turns say so outright — "you aren't finishing the task". The model can
-- write the offer; nothing filed it, so every one of those ended in a copy-paste
-- out of a chat dock, which is the data entry this platform exists to remove.
--
-- The whole Drive/Docs layer it needs already exists and had exactly ONE
-- consumer (steel quotes): copyFile, createDocFromBytes, replaceTokensInDoc,
-- exportDocAsPdf, uploadToFolder. §12 — a shared renderer wired to one surface
-- is worse than no shared renderer. This adds the second consumer, generically.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The job row.
--
-- Composing takes minutes (median Ber AI answer 73s, p90 455s), so the request
-- is recorded BEFORE the work starts: §12 — work fired off after a route handler
-- returns dies with the next kickstart, and a deploy IS a kickstart. This row is
-- what a later page load reads to find out the document is ready, and what says
-- why when it is not.
--
-- ⚠ NO 'composing' LATCH, DELIBERATELY. The steel quote holds a partial unique
-- index on its generating row because several reps share one deal. Here there
-- are two readers, and §12's rule about an in-progress status column applies
-- with full force: a kickstart kills the writer before it can record either
-- verdict, so a DB-enforced latch would be immortal and a deal could never be
-- composed on again. Concurrency is refused in the route against `requested_at`
-- and a staleness horizon instead — a check that cannot wedge.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists composed_documents (
  id uuid primary key default gen_random_uuid(),

  -- Shared children (§4): a project OR an opportunity, never both, never
  -- neither. Nullable both ways, so no reader may assume project_id is set.
  project_id uuid references projects(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,

  -- The kind, as a key into the registry in src/lib/documents/kinds.ts.
  -- ⚠ TEXT AND NOT A CHECK, ON PURPOSE. The kinds grow with what Richard asks
  -- for — the `draft` tool's hand-written `email | agenda | report` enum was
  -- already drifted against 20 measured asks before this table existed. §12: if
  -- the value set grows with the business it is not a CHECK. It is not an FK
  -- either, because each kind carries a prompt and a shape in code, exactly as
  -- `economics_lines.line_type` carries a formula — so the registry is the
  -- module, and a kind this build does not know is refused there with its name.
  document_kind text not null,

  -- What the human typed. The instruction is the record of what was asked for,
  -- so a document can be re-read against its own brief.
  instructions text not null,

  status text not null default 'composing'
    check (status in ('composing', 'ready', 'failed')),

  -- The title the pass settled on, kept apart from the model's prose so the
  -- file name and the heading cannot disagree.
  title text,

  -- The filed document. ⚠ WHICH TABLE IT POINTS AT DEPENDS ON THE PARENT:
  -- `documents` for a project, `opportunity_documents` for an opportunity —
  -- `documents` has no opportunity_id (§2). Not an FK for that reason; the
  -- parent columns above say which table to read, and `document_table` records
  -- it explicitly so no reader has to re-derive it.
  document_id uuid,
  document_table text
    check (document_table in ('documents', 'opportunity_documents')),

  -- Custody: the editable Google Doc. The documents row above is the record and
  -- owns the index; this is the artifact a human opens and sends.
  drive_file_id text,
  drive_file_url text,

  -- What it was built from, so a figure in a signed-looking document can be
  -- chased back to the thread or file it came from.
  sources jsonb not null default '[]'::jsonb,

  -- The figures handed TO the model, as the only numbers it was allowed to use.
  -- Kept so the guard's verdict is reproducible after the fact.
  figures jsonb not null default '{}'::jsonb,

  error text,

  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint composed_documents_one_parent check (
    (project_id is not null and opportunity_id is null) or
    (project_id is null and opportunity_id is not null)
  ),

  -- A terminal row must say how it ended, or the status column is decoration.
  constraint composed_documents_ready_has_document check (
    status <> 'ready' or (document_id is not null and document_table is not null)
  ),
  constraint composed_documents_failed_has_reason check (
    status <> 'failed' or error is not null
  )
);

comment on table composed_documents is
  'One row per "make me a document" request. Recorded before the work starts, because a deploy kickstarts the app and kills anything in flight. The DOCUMENT is the deliverable; this is the job record and the audit of what was asked.';

comment on column composed_documents.status is
  'composing | ready | failed. ⚠ Never read ''composing'' without requested_at — a kickstart leaves it behind forever (§12).';

comment on column composed_documents.figures is
  'The only numbers the model was permitted to use, injected from the platform. The model composes prose; code does the arithmetic (§12, and src/lib/economics/extract.ts).';

-- The one query the UI makes: the newest requests for this record.
create index if not exists idx_composed_documents_project
  on composed_documents (project_id, requested_at desc)
  where project_id is not null;

create index if not exists idx_composed_documents_opportunity
  on composed_documents (opportunity_id, requested_at desc)
  where opportunity_id is not null;

-- The liveness query: anything still composing, paired with its clock.
create index if not exists idx_composed_documents_composing
  on composed_documents (requested_at desc)
  where status = 'composing';

alter table composed_documents enable row level security;

-- RLS is defense-in-depth here; app traffic is service-role (§8).
drop policy if exists "composed_documents_all" on composed_documents;
create policy "composed_documents_all" on composed_documents
  for all using (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The text that says it is ready.
--
-- ⚠ THIS DOES NOT REOPEN THE HELD CHANNELS. src/lib/notify/policy.ts holds
-- eight of Pepper's eleven passes at Richard's direction (2026-10-21) because
-- the CONTENT was not worth reading. That file already draws the distinction
-- this relies on: "A HUMAN PRESSING A BUTTON IS NOT 'MESSAGING GOING OUT'" —
-- which is why lead_handoff and agent_answer stay live. A document you pressed
-- a button to get, and are waiting for, is that same category.
--
-- The CHECK below mirrors the union in src/lib/provenance/db.ts and must move
-- with it: a value not in the constraint fails the whole INSERT (§12), which
-- here means the self-loop guard row is never written and sendText refuses to
-- send at all. Previous additions: record_alert (20261019000001), task_week and
-- task_due_today (20261021000008).
-- ─────────────────────────────────────────────────────────────────────────────

alter table pepper_outbound_texts
  drop constraint if exists pepper_outbound_texts_kind_check;

alter table pepper_outbound_texts
  add constraint pepper_outbound_texts_kind_check check (
    kind in (
      'morning',
      'week_ahead',
      'nudge',
      'reply',
      'record_alert',
      'task_week',
      'task_due_today',
      'document_ready',
      'ad_hoc'
    )
  );
