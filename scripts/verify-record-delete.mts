/**
 * The two confirmation dialogs make promises about what else goes. Prove them.
 *
 * ⚠ THE DIALOG IS THE ONLY WARNING A READER GETS, SO ITS SENTENCE IS A CLAIM
 * ABOUT THE SCHEMA AND NOT A PIECE OF COPY:
 *
 *   opportunity — "removes the opportunity and its attached documents"
 *   investor    — "removes the investor, their investments and their notes.
 *                  The directory contact stays."
 *
 * Each of those is a cascade (or the deliberate ABSENCE of one) on a foreign
 * key, and nothing in `tsc`, the build or a render check can see whether the
 * database agrees. If `party_id` cascaded, deleting an investor would silently
 * take a contact out of the rolodex while the dialog promised it would not.
 *
 * Runs inside a transaction that ROLLS BACK, so it leaves nothing behind.
 *
 * Run: node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/verify-record-delete.mts
 */

import { execFileSync } from 'node:child_process'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * ⚠ RUN AS `postgres` THROUGH `docker exec`, NEVER `supabase db push --linked`
 * (§12 — that targets the wrong database), and in ONE transaction so the
 * rollback is guaranteed even if an assertion throws.
 */
function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8' }
  ).trim()
}

console.log('\n── What the confirmation dialogs promise ────────────────────\n')

/*
  One transaction, one round trip. Each SELECT prints a labelled line so the
  assertions below read from the real database rather than from a variable this
  script set itself.

  ⚠ `on_conflict`-free inserts with explicit ids, because the point is to delete
  these exact rows and count what went with them.
*/
const script = `
begin;

-- An opportunity with a document attached.
insert into opportunities (id, name, opp_type, status)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'VERIFY scratch opportunity', 'partnership', 'identified');

insert into opportunity_documents (id, opportunity_id, file_name, storage_path)
values ('aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000001',
        'VERIFY scratch doc.pdf', 'verify/scratch.pdf');

select 'opp_docs_before=' || count(*) from opportunity_documents
  where opportunity_id = 'aaaaaaaa-0000-4000-8000-000000000001';

delete from opportunities where id = 'aaaaaaaa-0000-4000-8000-000000000001';

select 'opp_rows_after=' || count(*) from opportunities
  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select 'opp_docs_after=' || count(*) from opportunity_documents
  where opportunity_id = 'aaaaaaaa-0000-4000-8000-000000000001';

-- An investor with an investment, a note, and a DIRECTORY CONTACT behind them.
insert into parties (id, full_name, is_organization)
values ('bbbbbbbb-0000-4000-8000-000000000001', 'VERIFY scratch contact', false);

insert into investors (id, name, party_id, investor_type, stage)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'VERIFY scratch investor',
        'bbbbbbbb-0000-4000-8000-000000000001', 'family_office', 'contacted');

insert into investments (id, investor_id, target_kind, amount_committed)
values ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002',
        'company', 1000000);

insert into investor_notes (id, investor_id, body)
values ('bbbbbbbb-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002',
        'VERIFY scratch note');

select 'inv_children_before=' || (
  (select count(*) from investments where investor_id = 'bbbbbbbb-0000-4000-8000-000000000002')
  + (select count(*) from investor_notes where investor_id = 'bbbbbbbb-0000-4000-8000-000000000002')
);

delete from investors where id = 'bbbbbbbb-0000-4000-8000-000000000002';

select 'inv_rows_after=' || count(*) from investors
  where id = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'investments_after=' || count(*) from investments
  where investor_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'notes_after=' || count(*) from investor_notes
  where investor_id = 'bbbbbbbb-0000-4000-8000-000000000002';
select 'party_after=' || count(*) from parties
  where id = 'bbbbbbbb-0000-4000-8000-000000000001';

-- A DELETE SURVIVES ITSELF (section 4): log_activity() writes to_jsonb(old)
-- into metadata, so an accidental delete is recoverable from the append-only
-- log. The opportunities table only gained that trigger on 10-19, which is why
-- it is worth asserting here rather than assuming.
-- (No backticks in this string: it lives inside a JS template literal.)
select 'opp_logged=' || count(*) from activity_log
  where record_id = 'aaaaaaaa-0000-4000-8000-000000000001' and action = 'DELETE';
select 'investor_logged=' || count(*) from activity_log
  where record_id = 'bbbbbbbb-0000-4000-8000-000000000002' and action = 'DELETE';
select 'investment_logged=' || count(*) from activity_log
  where record_id = 'bbbbbbbb-0000-4000-8000-000000000003' and action = 'DELETE';
-- The snapshot has to actually hold the row, or the log row is a tombstone
-- with no body and "recoverable" is a word rather than a fact.
select 'investor_snapshot=' || coalesce((
  select metadata->>'name' from activity_log
   where record_id = 'bbbbbbbb-0000-4000-8000-000000000002' and action = 'DELETE' limit 1
), 'MISSING');

-- The directory, audited from 2026-10-20. These two tables carried no trigger
-- at all, so nothing a human OR Pepper did to a contact left a trace. They are
-- in _audited_in_full, so an UPDATE must also carry a per-FIELD diff: that is
-- the half that answers "who changed this counterparty's phone number", which
-- is the question a rolodex actually raises.
insert into parties (id, full_name, is_organization, phone)
values ('cccccccc-0000-4000-8000-000000000001', 'VERIFY scratch party', false, '801-555-0100');

select 'party_insert_logged=' || count(*) from activity_log
  where record_id = 'cccccccc-0000-4000-8000-000000000001' and action = 'INSERT';

update parties set phone = '801-555-0199'
 where id = 'cccccccc-0000-4000-8000-000000000001';

select 'party_update_diff=' || coalesce((
  select field_changes->'phone'->>'old' || ' -> ' || (field_changes->'phone'->>'new')
    from activity_log
   where record_id = 'cccccccc-0000-4000-8000-000000000001' and action = 'UPDATE'
   order by created_at desc limit 1
), 'MISSING');

-- updated_at must NOT appear in the diff, or every edit carries a timestamp
-- change nobody asked about and the diff stops being readable.
select 'party_diff_keys=' || coalesce((
  select string_agg(k, ',' order by k) from (
    select jsonb_object_keys(field_changes) k from activity_log
     where record_id = 'cccccccc-0000-4000-8000-000000000001' and action = 'UPDATE'
     order by created_at desc limit 1
  ) x
), 'MISSING');

delete from parties where id = 'cccccccc-0000-4000-8000-000000000001';

select 'party_delete_snapshot=' || coalesce((
  select metadata->>'full_name' from activity_log
   where record_id = 'cccccccc-0000-4000-8000-000000000001' and action = 'DELETE' limit 1
), 'MISSING');

insert into entities (id, name, entity_type)
values ('cccccccc-0000-4000-8000-000000000002', 'VERIFY scratch entity', 'llc');
delete from entities where id = 'cccccccc-0000-4000-8000-000000000002';

-- ATTRIBUTION. The trigger reads the acting user out of request.headers, which
-- actorAdminClient() sets as x-actor-id / x-actor-email. A write WITHOUT them
-- records actor_type='system', which is what five of the eight parties/entities
-- write paths were doing until 10-20 — an audit trail whose every row says
-- "system" answers nothing. The two inserts below prove both directions.
select 'unattributed_actor=' || coalesce((
  select actor_type from activity_log
   where record_id = 'cccccccc-0000-4000-8000-000000000002' and action = 'INSERT' limit 1
), 'MISSING');

set local request.headers = '{"x-actor-email":"moose@berwilson.com"}';
insert into parties (id, full_name, is_organization)
values ('cccccccc-0000-4000-8000-000000000003', 'VERIFY scratch attributed', false);
reset request.headers;

select 'attributed_email=' || coalesce((
  select actor_email from activity_log
   where record_id = 'cccccccc-0000-4000-8000-000000000003' and action = 'INSERT' limit 1
), 'MISSING');

select 'entity_delete_snapshot=' || coalesce((
  select metadata->>'name' from activity_log
   where record_id = 'cccccccc-0000-4000-8000-000000000002' and action = 'DELETE' limit 1
), 'MISSING');

rollback;
`

let out: Record<string, string> = {}
try {
  const raw = psql(script)
  for (const line of raw.split('\n')) {
    const [k, v] = line.split('=')
    if (k && v !== undefined) out[k.trim()] = v.trim()
  }
} catch (err) {
  failures++
  console.error('  ✗ the transaction failed:', err instanceof Error ? err.message : err)
  out = {}
}

if (Object.keys(out).length > 0) {
  console.log('  ', JSON.stringify(out), '\n')

  check('the scratch opportunity had a document to lose', out.opp_docs_before === '1')
  check('deleting the opportunity removed it', out.opp_rows_after === '0')
  check('⚠ "and its attached documents" is TRUE — the doc cascaded', out.opp_docs_after === '0',
    `${out.opp_docs_after} left`)

  check('the scratch investor had two children', out.inv_children_before === '2')
  check('deleting the investor removed it', out.inv_rows_after === '0')
  check('⚠ "their investments" is TRUE', out.investments_after === '0', `${out.investments_after} left`)
  check('⚠ "their notes" is TRUE', out.notes_after === '0', `${out.notes_after} left`)
  check('⚠ "the directory contact stays" is TRUE — parties did NOT cascade',
    out.party_after === '1',
    'the rolodex contact was destroyed, which the dialog promises it will not be')

  // Recoverability, which is what makes a one-tap delete defensible at all.
  check('the deleted opportunity is recoverable from activity_log', out.opp_logged === '1',
    `${out.opp_logged} rows — opportunities only gained log_activity() on 10-19`)
  check('so is the deleted investor', out.investor_logged === '1', `${out.investor_logged} rows`)
  check('and so is each investment the cascade took with it',
    out.investment_logged === '1', `${out.investment_logged} rows`)
  check('the log row actually CARRIES the deleted row, not just its id',
    out.investor_snapshot === 'VERIFY scratch investor', out.investor_snapshot)

  // ── The directory (2026-10-20) ────────────────────────────────────────────
  check('creating a contact is now logged — Pepper does this on her own',
    out.party_insert_logged === '1', `${out.party_insert_logged} rows`)
  check('⚠ and an edit carries the FIELD that changed, not just "touched"',
    out.party_update_diff === '801-555-0100 -> 801-555-0199', out.party_update_diff)
  check('the diff holds ONLY the changed field — no updated_at noise',
    out.party_diff_keys === 'phone', out.party_diff_keys)
  check('a deleted contact is recoverable from the log', 
    out.party_delete_snapshot === 'VERIFY scratch party', out.party_delete_snapshot)
  check('so is a deleted entity', 
    out.entity_delete_snapshot === 'VERIFY scratch entity', out.entity_delete_snapshot)
  check('a write with no actor headers is honestly marked "system"',
    out.unattributed_actor === 'system', out.unattributed_actor)
  check('⚠ and one WITH them names the person — what actorAdminClient() buys',
    out.attributed_email === 'moose@berwilson.com', out.attributed_email)
}

// Nothing to clean up: the whole thing rolled back.
const leftovers = psql(
  `select count(*) from opportunities where name like 'VERIFY scratch%'
   union all select count(*) from investors where name like 'VERIFY scratch%'
   union all select count(*) from parties where full_name like 'VERIFY scratch%'
   union all select count(*) from entities where name like 'VERIFY scratch%'
   union all select count(*) from activity_log where metadata->>'full_name' like 'VERIFY scratch%'`
)
check('the rollback left nothing behind', leftovers.split('\n').every((n) => n.trim() === '0'),
  leftovers.replace(/\n/g, ','))

console.log(failures === 0 ? '\n✓ both dialogs tell the truth, and both deletes are recoverable\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
