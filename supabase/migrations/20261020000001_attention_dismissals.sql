-- A quick action on /attention, and the mark a dismissal has to leave.
--
-- ⚠ THE SURFACE HAD NO VERBS AT ALL. `/attention` renders ten kinds of
-- slipping work as bare links: the only thing a reader could do with a row was
-- open it. Richard's words (10-20): *"it shows me leads and other items that
-- are urgent, but I don't have a quick button to simply delete them."*
--
-- Four of the ten kinds carry a row that can honestly be deleted — a task, a
-- lead, a diligence item, a compliance item — and those now delete through the
-- route that already owns them, with that route's own guard. The other six
-- cannot: a milestone and a dependency are real records a triage screen has no
-- business destroying; `stale_waiting` and `stale_decision` are entries inside
-- an `updates` jsonb array with no row of their own at all; and an investor
-- going cold or a Dino installment coming due is DERIVED from a record nobody
-- would delete to quieten a list.
--
-- So those six need "not now", and this is the table that remembers it.
--
-- ⚠ IT IS A MARK THE ENGINE RESPECTS, WHICH IS THE WHOLE POINT. §12: an
-- automatic pass and the undo for it are a LOOP unless the undo leaves a mark
-- the pass respects. `computeAttention()` rebuilds every item from live rows on
-- every call, so a dismissal that lived in component state, in the URL or in
-- localStorage would be overruled by the next render — and the one in
-- localStorage would also be invisible to Pepper's 06:50 note, which is where
-- these items are actually read. The mark is a row, the filter is at the choke
-- point, and the undo is deleting the row.
--
-- Precedent: `commitments.snoozed_until` (10-09) — a quiet, not a status. Same
-- idea, except an attention item has no row to hang a column on, because the
-- engine computes it. Hence a table keyed by the item's own identity.
create table if not exists public.attention_dismissals (
  id uuid primary key default gen_random_uuid(),

  -- The attention item's own id, exactly as `computeAttention()` builds it
  -- (`task-<uuid>`, `milestone-<uuid>`, `waiting-<uuid>-<text slice>`). It is
  -- the only identity these items have: there is no attention table for a
  -- foreign key to point at.
  --
  -- ⚠ THE PREFIX IS A DISCRIMINATOR WITH NO TYPE BEHIND IT, so it is declared
  -- in `ATTENTION_KINDS` (`idPrefixes`) and a test asserts every item the
  -- engine produces carries one of its own category's prefixes. §12 learned
  -- that one the hard way on recording thread prefixes, three switches deep.
  item_key text not null,

  -- The kind, so a dismissal can be read back without re-deriving it from the
  -- prefix, and so the Dismissed view can chip it like any other row.
  category text not null,

  -- What the row SAID when it was dismissed. The live item is gone from the
  -- engine's output by then — that is what the dismissal does — so the
  -- Dismissed view has nothing else to render. A snapshot, never authoritative.
  title text not null,
  project_name text,

  -- ⚠ KEPT SO THE DISMISSED VIEW CAN BE CONTAINED (§8). An item belonging to a
  -- `confidential` project leaves every cross-portfolio surface, and a list of
  -- dismissed titles is one. `dropHidden()` needs the project id to do that, so
  -- the dismissal carries it; null for the kinds that have no project at all
  -- (a lead, a Dino payment), which are never withheld.
  project_id uuid references public.projects(id) on delete cascade,

  -- When it comes back. A date, not a boolean: a milestone dismissed in March
  -- that matters in June must return on its own, and a permanent dismissal
  -- would silently swallow it. Richard chose two weeks.
  dismissed_until date not null,

  -- ⚠ ATTRIBUTABLE, AND DELIBERATELY NOT PER-PERSON. The dismissal is GLOBAL:
  -- /attention is one shared board for two executives and §12's first UI rule
  -- is that one quantity gets one definition, so two independent dismissal sets
  -- would mean two different screens and two different morning notes under one
  -- name. Instead it says who, and the UI says "you" when the reader is the
  -- dismisser rather than printing their own name back at them (§12).
  dismissed_by text,
  created_at timestamptz not null default now()
);

-- One live dismissal per item. A second dismiss of the same row EXTENDS it
-- rather than stacking, which is what `on conflict (item_key)` gives the
-- upsert in `dismissAttentionItem()`.
create unique index if not exists idx_attention_dismissals_key
    on public.attention_dismissals (item_key);

-- The engine's read: every key still suppressed today.
create index if not exists idx_attention_dismissals_until
    on public.attention_dismissals (dismissed_until);

comment on table public.attention_dismissals is
  'Attention items a human has pushed out of sight for a while. Read at the '
  'choke point by computeAttention() and countAttention(), so one dismissal '
  'clears the row from /attention, the dashboard rail, the sidebar badge, '
  'Pepper''s morning note and the agent''s get_attention_items tool at once. '
  'Expires on dismissed_until; deleting the row is the undo.';

-- Grants
-- ---------------------------------------------------------------------------
--
-- ⚠ EXPLICIT, NOT INHERITED. A table created by a migration applied as anything
-- but `postgres` receives no API grants at all and every PostgREST call answers
-- 42501 — which is how `notification_log` shipped dead for five weeks (§12,
-- 09-24). Stated here so the outcome does not depend on who ran the file.
alter table public.attention_dismissals owner to postgres;
grant all on table public.attention_dismissals to anon, authenticated, service_role;

alter table public.attention_dismissals enable row level security;

-- RLS is defense-in-depth here; app traffic is service-role (§8).
drop policy if exists "attention_dismissals_all" on public.attention_dismissals;
create policy "attention_dismissals_all" on public.attention_dismissals
  for all using (auth.role() = 'authenticated');
