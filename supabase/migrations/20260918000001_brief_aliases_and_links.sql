-- Record aliases + a durable home for record briefs.
--
-- WHY ALIASES: route-phase matches a thread to a record by name similarity, and
-- deliberately refuses to guess when the evidence is thin. That is the right
-- default, but it leaves real correspondence unrouted whenever people write the
-- short name they actually use. Measured on this corpus: the Stockton Power
-- Nexus project matched 1 of its 19 threads, because the others say "Stockton
-- Project (Power Grid)" or "Water Questions from Ber Wilson" — never the full
-- record name. An alias is a human asserting "this short form means this
-- record", which is evidence the matcher cannot derive on its own.
--
-- text[] rather than a join table, following parties.tags / entities.specialties.

alter table projects add column if not exists match_aliases text[] not null default '{}';
alter table opportunities add column if not exists match_aliases text[] not null default '{}';

comment on column projects.match_aliases is
  'Short forms people actually write for this project, used by the email router. A single-word alias is allowed to match on its own because a human asserted it; ambiguity between two records still means no match.';
