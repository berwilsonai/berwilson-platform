-- Opportunity briefs: stored_briefs learns which OPPORTUNITY a brief belongs to.
--
-- The record-brief assembler was project-shaped by construction
-- (record-brief.ts, 2026-09-18); extending it to opportunities needs somewhere
-- to store the result the print view can find. project_id stays as-is; a brief
-- carries exactly one of the two, enforced in the writer, not a constraint —
-- the portfolio brief carries neither, so a CHECK over the pair would have to
-- special-case brief_type and buy nothing.

alter table stored_briefs
  add column if not exists opportunity_id uuid references opportunities(id) on delete cascade;

create index if not exists idx_stored_briefs_opportunity
  on stored_briefs(opportunity_id, created_at desc)
  where opportunity_id is not null;

-- The column alone is not enough: brief_type carries a CHECK from the original
-- migration, and 'opportunity' must be a legal value or every insert fails.
alter table stored_briefs drop constraint if exists stored_briefs_brief_type_check;
alter table stored_briefs add constraint stored_briefs_brief_type_check
  check (brief_type in ('portfolio', 'project', 'meeting_prep', 'opportunity'));
