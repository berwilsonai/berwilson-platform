-- match_chunks learns the two scopes it was missing: opportunities, and
-- company-only.
--
-- WHY. The function could filter by project or by entity, and nothing else.
-- Two consequences, both measured on live data:
--
--   1. An OPPORTUNITY could not be scoped at all. Opportunities are a
--      first-class record with their own documents and notes — one of them
--      carries 260 chunks — yet asking about one searched all 2,706 rows in
--      the table. `assembleOpportunityBrief` had to work around this by
--      pulling that record's vectors into Node and ranking them by hand.
--
--   2. There was no COMPANY-ONLY mode. `filter_include_company` is an OR
--      branch that only does anything when a project list is also given, so
--      with an empty filter it is dead code and the search covers everything.
--      Asked "what certifications do we hold", the top hit was a Stockton
--      question-tracker CSV header at 0.575 while the capability material sat
--      below it — the company knowledge base is 924 of 2,706 chunks, so
--      scoping to it makes that search roughly three times more selective.
--
-- Both new arguments carry defaults, so every existing five- and six-argument
-- call keeps working unchanged. The return shape is untouched.

drop function if exists match_chunks(vector, uuid[], timestamptz, int, uuid[], boolean);

create or replace function match_chunks(
  query_embedding vector,
  filter_project_ids uuid[] default '{}'::uuid[],
  filter_after timestamptz default null,
  match_count int default 20,
  filter_entity_ids uuid[] default '{}'::uuid[],
  filter_include_company boolean default false,
  filter_opportunity_ids uuid[] default '{}'::uuid[],
  filter_company_only boolean default false
)
returns table (
  id uuid,
  project_id uuid,
  update_id uuid,
  document_id uuid,
  entity_id uuid,
  party_id uuid,
  opportunity_id uuid,
  investor_id uuid,
  source_type text,
  is_company boolean,
  content text,
  chunk_index integer,
  token_count integer,
  created_at timestamptz,
  similarity float,
  source_confidence numeric
)
language sql
stable
security definer
as $$
  select
    c.id,
    c.project_id,
    c.update_id,
    c.document_id,
    c.entity_id,
    c.party_id,
    c.opportunity_id,
    c.investor_id,
    c.source_type,
    c.is_company,
    c.content,
    c.chunk_index,
    c.token_count,
    c.created_at,
    (1 - (c.embedding <=> query_embedding))::float as similarity,
    coalesce(u.confidence, 0.5)::numeric as source_confidence
  from chunks c
  left join updates u on u.id = c.update_id
  where
    (
      -- Company-only wins outright: the caller is asking about Ber Wilson
      -- itself, and unioning in project material is what made that search
      -- unusable in the first place.
      (filter_company_only and c.is_company)
      or (
        not filter_company_only
        and (
          -- No record filter at all still means "everything", which is what
          -- portfolio-wide questions need.
          (
            array_length(filter_project_ids, 1) is null
            and array_length(filter_opportunity_ids, 1) is null
          )
          or c.project_id = any(filter_project_ids)
          or c.opportunity_id = any(filter_opportunity_ids)
          or (filter_include_company and c.is_company)
        )
      )
    )
    and (array_length(filter_entity_ids, 1) is null or c.entity_id = any(filter_entity_ids))
    and (filter_after is null or c.created_at >= filter_after)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
