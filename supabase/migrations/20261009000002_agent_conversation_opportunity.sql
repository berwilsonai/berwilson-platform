-- An agent conversation can belong to an opportunity, not only a project.
--
-- WHY. `AskBerAIDock` matched `/projects/<uuid>` and nothing else, so standing
-- on an opportunity and pressing ⌘J opened the agent portfolio-wide: the reader
-- had to name the deal in the question, on the record type where most of the
-- live pipeline sits since opportunities gained the same child tables
-- (2026-09-23). The scope was project-only all the way down — the dock's regex,
-- the request body, the system preamble, and this column.
--
-- Shaped as the shared-children convention (§4): a nullable pointer beside the
-- existing one, with a CHECK that at most one is set. `document_id` is NOT part
-- of that check — a document chat is a different axis and may legitimately
-- carry a deal as well.
--
-- `on delete cascade`, matching `project_id`: a conversation about a deal that
-- no longer exists is not evidence of anything, and `agent_messages` already
-- cascades from the conversation.

alter table public.agent_conversations
  add column if not exists opportunity_id uuid references public.opportunities(id) on delete cascade;

alter table public.agent_conversations
  drop constraint if exists agent_conversations_one_record;

alter table public.agent_conversations
  add constraint agent_conversations_one_record
  check (project_id is null or opportunity_id is null);

-- Partial, like every other scope index here: the overwhelming majority of
-- conversations are portfolio-wide and carry NULL in both columns.
create index if not exists idx_agent_conversations_opportunity
  on public.agent_conversations (opportunity_id)
  where opportunity_id is not null;
