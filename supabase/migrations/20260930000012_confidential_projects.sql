-- Confidential projects + step-up (TOTP) unlock sessions.
--
-- Two separable ideas, deliberately not one column:
--
--   projects.confidential  — CONTAINMENT. The project is excluded from every
--     cross-portfolio surface, from portfolio-wide retrieval, and from every
--     outbound channel (briefs, Pepper's note, digests, Drive publish). This is
--     the half that actually keeps the data in. It applies to EVERYONE,
--     including both admins, and it cannot be unlocked away — a confidential
--     project is never summarised into an email, because an email has already
--     left the lock behind.
--
--   step_up_sessions      — ACCESS. A short-lived record that a specific auth
--     user cleared a TOTP challenge for a specific project. Written only by
--     POST /api/security/step-up, which verifies the code against the user's
--     enrolled authenticator via gotrue. No row (or an expired one) means the
--     project's pages and APIs are closed.
--
-- Why a table rather than a signed cookie: a cookie cannot be revoked and
-- cannot be audited. A row can — `delete from step_up_sessions` closes every
-- open session on the platform, and every grant is visible with who/when.
--
-- MUST BE APPLIED AS `postgres`. A table created by any other role gets no
-- PostgREST grants at all and answers 42501 on every call (CLAUDE.md §12).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The flag
-- ─────────────────────────────────────────────────────────────────────────────

alter table projects
  add column if not exists confidential boolean not null default false;

comment on column projects.confidential is
  'Protected project. Hidden from cross-portfolio surfaces, portfolio-wide '
  'retrieval and ALL outbound channels; its pages require a fresh TOTP '
  'step-up. See src/lib/security/confidential.ts.';

-- Partial: the set is small by definition and every reader asks for exactly
-- the true rows.
create index if not exists idx_projects_confidential
  on projects (id) where confidential;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Step-up sessions
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists step_up_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Bare uuid, no FK to auth.users — matches team_members.auth_user_id, which
  -- is the existing convention in this schema.
  auth_user_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  -- Which enrolled factor cleared it, for the audit trail. Nullable so a
  -- future factor type (webauthn/Touch ID) needs no migration here.
  factor_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  ip text,
  user_agent text
);

comment on table step_up_sessions is
  'A verified TOTP step-up for one user against one confidential project. '
  'Absolute expiry, never sliding — an idle tab must not stay unlocked.';

-- The only read this table ever serves: "is there a live session for this
-- user and project right now".
create index if not exists idx_step_up_live
  on step_up_sessions (auth_user_id, project_id, expires_at desc);

-- Housekeeping read: expire old rows.
create index if not exists idx_step_up_expiry
  on step_up_sessions (expires_at);

alter table step_up_sessions enable row level security;

-- RLS is defence-in-depth here, not the boundary (CLAUDE.md §8) — app traffic
-- is service-role. A user may READ their own sessions (so a future "you are
-- unlocked, 24 minutes left" indicator needs no new route) and nothing more.
-- Writes are service-role only, i.e. only through the verify route.
drop policy if exists step_up_sessions_select_own on step_up_sessions;
create policy step_up_sessions_select_own on step_up_sessions
  for select using (auth.uid() = auth_user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. match_chunks gains an EXCLUDE filter
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The existing signature can only ever INCLUDE (filter_project_ids widens the
-- search). So an unscoped portfolio question — which is most of what Ber AI is
-- asked — retrieved a confidential project's passages with no way to say no.
-- Exclusion has to happen in SQL, not in the caller after the fact: the LIMIT
-- is applied before any post-filter, so twenty confidential passages at the top
-- would return an empty answer rather than the next twenty real ones.
--
-- Also excludes chunks reached through a confidential project's DOCUMENTS. A
-- document can be double-claimed as company knowledge (is_company = true,
-- project_id null) — see CLAUDE.md §12, drive-sync's ownedElsewhere bug — and
-- such a chunk would otherwise slip past a project_id-only test.

-- ⚠ DROP THE OLD SIGNATURE FIRST. Adding a parameter — even one with a default
-- — does not REPLACE a function, it OVERLOADS it: the 8-argument version would
-- survive beside the 9-argument one, both would match an 8-named-argument call,
-- and PostgREST answers "function is not unique" rather than picking one. The
-- exclusion would then fail OPEN on every call, which is the one failure mode
-- this migration exists to prevent.
drop function if exists match_chunks(
  vector, uuid[], timestamptz, integer, uuid[], boolean, uuid[], boolean
);

create or replace function match_chunks(
  query_embedding vector,
  filter_project_ids uuid[] default '{}'::uuid[],
  filter_after timestamptz default null,
  match_count integer default 20,
  filter_entity_ids uuid[] default '{}'::uuid[],
  filter_include_company boolean default false,
  filter_opportunity_ids uuid[] default '{}'::uuid[],
  filter_company_only boolean default false,
  filter_exclude_project_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid, project_id uuid, update_id uuid, document_id uuid, entity_id uuid,
  party_id uuid, opportunity_id uuid, investor_id uuid, source_type text,
  is_company boolean, content text, chunk_index integer, token_count integer,
  created_at timestamptz, similarity double precision, source_confidence numeric
)
language sql stable security definer
as $function$
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
    -- The exclusion applies to EVERY branch above, including company-only:
    -- a confidential project's document re-claimed as company knowledge is
    -- exactly the case that must not answer.
    and (
      array_length(filter_exclude_project_ids, 1) is null
      or (
        (c.project_id is null or not (c.project_id = any(filter_exclude_project_ids)))
        and (
          c.document_id is null
          or not exists (
            select 1 from documents d
            where d.id = c.document_id
              and d.project_id = any(filter_exclude_project_ids)
          )
        )
      )
    )
    and (array_length(filter_entity_ids, 1) is null or c.entity_id = any(filter_entity_ids))
    and (filter_after is null or c.created_at >= filter_after)
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$function$;
