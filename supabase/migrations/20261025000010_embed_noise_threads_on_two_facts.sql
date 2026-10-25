-- Widen the mail index's noise gate on two FACTS, not on prose.
--
-- `email_threads_pending_embed` withheld every `relevance='noise'` deal thread
-- that no human had asserted a filing for. Measured 2026-10-25: that is 1,277
-- of 1,895 summarized deal threads — 65% of the deal corpus unsearchable.
--
-- Sampling them, the gate's correct rejects are genuinely correct: eSignature
-- notifications, calendar accepts and cancellations, out-of-office replies, a
-- Drive folder-share notice, a work order for a 2019 Toyota 4Runner. But the
-- wrong ones share one unmistakable shape — A THREE-WORD BODY CARRYING EIGHT TO
-- FOURTEEN FILES. `Requested information` (14 attachments), `Powers Mines` (11),
-- `Fwd: Steel pricing` (8, across four messages), `Fw: Deeds` (5),
-- `bplan and financial model` (4), `Fwd: ALABAMA FERRY FIELD` (4). The
-- summarizer reads PROSE, and the most document-dense threads in the corpus
-- have almost none of it, so a prose gate discards exactly the mail that
-- carries the artifacts.
--
-- ⚠ THE CONTRADICTION THAT PROVES IT: 18 of these threads are ALREADY FILED to
-- a record by the router, which matched them on an identity — a solicitation
-- number, a learned identifier, an asserted alias — while the summarizer called
-- the same thread noise. Two passes over one thread returning opposite verdicts
-- means at least one is wrong, and only one of them looked at a fact.
--
-- So the widening is on facts, never on another model's score, and it is the
-- same shape as the record-creation rule in `src/lib/records/from-recording.ts`:
--
--   * `attachment_count >= 1` — it carries a document. Whatever the prose is
--     worth, the file is an artifact and §12 already says an artifact belongs on
--     the record whenever it arrived.
--   * `message_count >= 3` — somebody replied, twice. A real back-and-forth is
--     not a notification, and a notification never gets two replies.
--
-- Scoped to `pipeline='deal'` deliberately. Leads have their own triage and are
-- skipped inside `embedThread` regardless; saying so in the predicate keeps the
-- view honest about what it is for rather than relying on a filter downstream.
--
-- Measured effect: 334 threads recovered, 919 still withheld.
--
-- ⚠ NO CURSOR CLEAR IS NEEDED, and reaching for one would have been the wrong
-- instinct. A withheld thread was never STAMPED — `embedded_at` is filtered in
-- SQL, never written, precisely so the question can be re-asked for free — so
-- all 334 already carry a NULL cursor and the view returns them the moment it is
-- replaced. Verified immediately after applying this file: 0 pending before,
-- 334 after, with no UPDATE run against any row.
--
-- ⚠ THE PREDICATE LIVES IN THIS VIEW AND NOWHERE ELSE, which is why this is the
-- only edit. `embedPendingThreads` reads the view for its SELECTOR and again for
-- its `remaining` COUNT, specifically so a run cannot report work it will never
-- pick up (§12 — a count must carry the list's own predicates). Adding the test
-- to either caller instead would reintroduce exactly that drift.

create or replace view email_threads_pending_embed as
  select
    id,
    subject,
    raw_markdown,
    mailbox,
    gmail_thread_id,
    attachment_count,
    summary,
    pipeline,
    last_at
  from email_threads t
  where summary_state = 'summarized'
    and embedded_at is null
    and (
      (summary ->> 'relevance') is null
      or (summary ->> 'relevance') <> 'noise'
      or exists (
        select 1 from thread_links l
        where l.thread_id = t.id and l.certainty = 'linked'
      )
      -- The two facts. `coalesce` because both counts are nullable and NULL
      -- compared with >= is NULL, which is not true — §12, and the whole
      -- recovery would have silently returned nothing.
      or (
        t.pipeline = 'deal'
        and (coalesce(t.attachment_count, 0) >= 1 or coalesce(t.message_count, 0) >= 3)
      )
    );

comment on view email_threads_pending_embed is
  'Threads owed a place in the mail index. Withholds deal-noise that carries no '
  'attachment, has no real back-and-forth, and that no human has asserted a '
  'filing for. See 20261025000010 for why the test is two facts and not a score.';
