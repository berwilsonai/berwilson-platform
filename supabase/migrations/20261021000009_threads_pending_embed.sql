-- Admit an ASSERTED thread to the correspondence index, whatever the
-- summarizer called it.  (2026-10-21)
--
-- `embedPendingThreads` excluded `summary->>relevance = 'noise'`, and the
-- router had ALREADY learned that this is the wrong question. From
-- route-phase.ts, written 2026-09-22:
--
--     ⚠ DO NOT GATE THIS ON summary.relevance === 'noise'. […] `relevance`
--     grades whether a thread is SUBSTANTIVE PROSE, not whether it is junk.
--     Automated-in-form and about-a-real-deal are independent, and conflating
--     them silently drops exactly the notices worth keeping on a record.
--
-- Only the ROUTING half was fixed. Measured today, 66 noise-judged deal threads
-- carry a thread_link and 48 of them are `certainty='linked'` — among them the
-- Helper appraisal, "Fwd: Helper Data Center Risk Analysis", the Drive share of
-- the Helper UT folder, and the executed Ber Wilson / Taylor Englert agreed
-- terms. Two of those are the very threads the route-phase comment cites as its
-- evidence, and they have been unsearchable by meaning ever since.
--
-- WHY `linked` AND NOT `inferred`. `linked` is written only on an IDENTITY: a
-- matching solicitation number, a learned record_identifier taught by a human
-- filing decision, or a human-asserted alias matched whole. `inferred` is the
-- trigram similarity tier. Replayed over the live corpus: `linked` admits 48,
-- adding `inferred` admits 18 more that are almost all "Accepted: …" calendar
-- notices, and `attachment_count > 0` admits 276 including newsletters carrying
-- PDFs. `linked` is the loosest rule that loses nothing — and it gates on a
-- fact rather than another model's guess (§12).
--
-- A VIEW rather than a widened filter in TS, for two reasons: the eligibility
-- rule then has ONE home (the progress count and the selector cannot drift
-- apart), and `.in.(…)` over a list of thread ids would ride in the query
-- string and hit the URI cap Kong refuses (§12).

-- `security_invoker` so the view is NOT a way around RLS on email_threads: a
-- view defaults to running as its OWNER, which would make it a wider door than
-- the table it reads. The only caller is the sweep's service-role client
-- (`sweepDb()`), which bypasses RLS on its own account anyway, so nothing is
-- lost by asking the caller's privileges to carry it.
create or replace view public.email_threads_pending_embed
with (security_invoker = true) as
select
  t.id,
  t.subject,
  t.raw_markdown,
  t.mailbox,
  t.gmail_thread_id,
  t.attachment_count,
  t.summary,
  t.pipeline,
  t.last_at
from public.email_threads t
where t.summary_state = 'summarized'
  and t.embedded_at is null
  and (
    -- A lead thread has no summary at all, so `relevance` is NULL for every one
    -- of them; a .neq() filter drops NULLs and would exclude the whole lead
    -- pipeline. Their marketing verdict lives in `leads.status = 'spam'` and is
    -- applied by the caller, because it is a different table.
    t.summary->>'relevance' is null
    or t.summary->>'relevance' <> 'noise'
    -- …or somebody/something ASSERTED which record this thread belongs to.
    or exists (
      select 1 from public.thread_links l
      where l.thread_id = t.id and l.certainty = 'linked'
    )
  );

comment on view public.email_threads_pending_embed is
  'Threads eligible for the correspondence index. Deal-noise is excluded UNLESS the thread carries an asserted (certainty=linked) record link — relevance grades prose, not deal-relevance. Lead threads have a null relevance and are kept here; their spam verdict is applied by the caller from the leads table.';

-- ⚠ Without these the view answers 42501 to every API call while looking
-- perfectly healthy in psql (§12 — an object created by a migration applied as
-- anything but `postgres` gets no API grants).
-- service_role is the sole reader (`embedPendingThreads` via sweepDb()).
grant select on public.email_threads_pending_embed to service_role;

-- ⚠ AND THE GRANT ABOVE IS NOT THE WHOLE STORY. This database carries a
-- Supabase default privilege (`pg_default_acl`) handing anon and authenticated
-- ALL privileges on every new table and view, so naming only service_role above
-- changes nothing by itself — verified: anon came out with INSERT/UPDATE/DELETE
-- on this view, exactly as it has on `projects`. RLS is what actually restrains
-- those roles (§8), and `security_invoker` above is what makes this view
-- inherit it rather than bypass it. Nothing here is writable, so say so.
revoke insert, update, delete, truncate, references, trigger
  on public.email_threads_pending_embed from anon, authenticated;
