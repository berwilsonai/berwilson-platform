#!/bin/zsh
# Prove the MCP views cannot return a protected record.
#
#   zsh deploy/mcp-containment-check.sh
#
# WHY A SHELL SCRIPT OVER psql. The thing being verified IS the schema — the
# exclusion lives in the views' own WHERE clauses — so a unit test with a mocked
# client would prove nothing, and `npm test` is deliberately database-free (every
# existing test is pure, which is why the suite runs anywhere). This follows the
# same shape as deploy/lmstudio-check.sh and deploy/tailnet-setup.sh: assert
# something about the live system, loudly, and exit non-zero when it is wrong.
# It also avoids adding `pg` as a dependency for one script (§11).
#
# ⚠ IT PROTECTS A REAL PROJECT AND ROLLS BACK. Everything runs inside one
# transaction that is always rolled back, so no row is left changed even if a
# check fails midway. Flipping `confidential` for real and flipping it back
# would leave a window where a cron could read the protected state — and would
# leave the flag set permanently if this script died in the middle.
#
# ⚠ AND IT PICKS A PROJECT THAT ALREADY HAS TASKS. A leak test against a project
# with no children passes for free; the first hand-run of this check did exactly
# that and reported a green tick having asserted nothing.
#
# Run it after any migration touching projects, tasks or the mcp_* views, and
# before enabling the MCP server for a new credential.

set -u
emulate -L zsh

CONTAINER=${SUPABASE_DB_CONTAINER:-supabase-db}

if ! docker exec "$CONTAINER" true 2>/dev/null; then
  print -u2 "✘ cannot reach the database container '$CONTAINER'. Is Colima running?"
  exit 1
fi

# Each check prints  PASS|name|detail  or  FAIL|name|detail  so the shell can
# count failures without parsing psql's table formatting.
OUT=$(docker exec -i "$CONTAINER" psql -U postgres -t -A -v ON_ERROR_STOP=1 <<'SQL' 2>&1
\set QUIET on
begin;

do $$
declare
  subj_id   uuid;
  subj_name text;
  n_tasks   int;
  v_proj    int;
  v_tasks   int;
  a_proj    int;
  a_tasks   int;
  a_named   int;
  a_search  int;
  exposed   int;
  total     int;
  started   int;
begin
  select count(*) into started from projects where confidential;

  -- A subject with children, so nothing passes vacuously.
  select p.id, p.name, count(t.id)
    into subj_id, subj_name, n_tasks
  from projects p join tasks t on t.project_id = p.id
  group by p.id, p.name
  order by count(t.id) desc
  limit 1;

  if subj_id is null then
    raise notice 'FAIL|subject selection|no project has any tasks, so this check could only pass vacuously';
    return;
  end if;

  raise notice 'INFO|subject|"%" with % tasks', subj_name, n_tasks;

  -- Baseline. If this fails, every assertion below is meaningless.
  select count(*) into v_proj  from mcp_projects where id = subj_id;
  select count(*) into v_tasks from mcp_tasks    where project_id = subj_id;
  if v_proj = 1 and v_tasks > 0 then
    raise notice 'PASS|baseline: subject is visible while unprotected|% project row, % task rows', v_proj, v_tasks;
  else
    raise notice 'FAIL|baseline: subject is visible while unprotected|project rows % (want 1), task rows % (want >0) — the checks below would pass for free', v_proj, v_tasks;
  end if;

  -- Protect it, and plant an UNLINKED task that names it. That second case is
  -- the one a foreign-key filter cannot see at all.
  update projects set confidential = true where id = subj_id;
  insert into tasks (title, status)
    values ('Call Paul re ' || subj_name || ' closing', 'todo');

  select count(*) into a_proj   from mcp_projects where id = subj_id;
  select count(*) into a_tasks  from mcp_tasks    where project_id = subj_id;
  select count(*) into a_named  from mcp_tasks    where title like 'Call Paul re %';
  select count(*) into a_search from mcp_projects where name ilike '%' || subj_name || '%';

  if a_proj = 0 then
    raise notice 'PASS|protected project absent from mcp_projects|returned 0 rows';
  else
    raise notice 'FAIL|protected project absent from mcp_projects|returned % rows, want 0', a_proj;
  end if;

  if a_tasks = 0 then
    raise notice 'PASS|its tasks absent from mcp_tasks|0 of the % shown a moment ago', v_tasks;
  else
    raise notice 'FAIL|its tasks absent from mcp_tasks|returned % rows, want 0', a_tasks;
  end if;

  if a_named = 0 then
    raise notice 'PASS|unlinked task naming it is withheld|0 rows — the case an FK filter cannot see';
  else
    raise notice 'FAIL|unlinked task naming it is withheld|returned % rows, want 0', a_named;
  end if;

  if a_search = 0 then
    raise notice 'PASS|not findable by its own name|0 rows';
  else
    raise notice 'FAIL|not findable by its own name|returned % rows, want 0', a_search;
  end if;

  -- Containment that hides everything is not useful containment.
  select count(*) into exposed from mcp_tasks;
  select count(*) into total   from tasks;
  if total > 0 and exposed::numeric / total > 0.5 then
    raise notice 'PASS|coverage stays useful|% of % tasks still exposed (%)', exposed, total, round(exposed::numeric * 100 / total)::text || '%';
  else
    raise notice 'FAIL|coverage stays useful|only % of % tasks exposed — a rule that withholds most of the table makes the tool pointless', exposed, total;
  end if;

  if started = 0 then
    raise notice 'INFO|starting state|no project was confidential before this run';
  else
    raise notice 'INFO|starting state|% project(s) were ALREADY confidential — coverage figures include them', started;
  end if;
end $$;

rollback;

-- The rollback is itself a check: this must report whatever it was before.
select 'INFO|after rollback|' || count(*) || ' project(s) confidential' from projects where confidential;
SQL
)

rc=$?
print -r -- "$OUT" | sed 's/^NOTICE:  //' | while IFS='|' read -r kind name detail; do
  case "$kind" in
    PASS) printf '\xE2\x9C\x94 %s\n    %s\n' "$name" "$detail" ;;
    FAIL) printf '\xE2\x9C\x98 %s\n    %s\n' "$name" "$detail" ;;
    INFO) printf '\xC2\xB7 %s \xE2\x80\x94 %s\n' "$name" "$detail" ;;
  esac
done

fails=$(print -r -- "$OUT" | grep -c '^NOTICE:  FAIL|')
passes=$(print -r -- "$OUT" | grep -c '^NOTICE:  PASS|')

print ""
if [[ $rc -ne 0 ]]; then
  print -u2 "✘ psql itself failed — the checks did not all run. Output above."
  exit 1
fi
if [[ $fails -gt 0 ]]; then
  print -u2 "✘ $fails of $((passes + fails)) containment checks FAILED. Do not enable the MCP server."
  exit 1
fi
print "✔ all $passes containment checks passed."
