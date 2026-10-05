-- Seed the benchmark library, every row marked for review.
--
-- ⚠ EVERY ONE OF THESE IS `needs_review = true` AND THAT IS NOT A FORMALITY.
-- The brief asks for "a handful of entries, marked for review; I will maintain
-- it", and the reason matters: picking a benchmark sets an input's provenance to
-- "Benchmark" with that row's source, which is a claim that somebody checked a
-- market. These were not checked against a subscription data service. They are
-- plausible public ranges to make the mechanism usable on day one, and the
-- source field says so in words rather than naming an authority that did not
-- supply them.
--
-- The reader sees `needs_review` on the row and in the picker. Replacing the
-- figure and the source, then clearing the flag, is the act that makes a
-- benchmark real. Until then an input citing one still reads as weakly sourced,
-- because `benchmark` is the second-weakest rung of the provenance ladder.
--
-- Ranges rather than points wherever the market has one: collapsing $8M to
-- $12M per MW into "$10M" loses the fact that nobody knows which end applies,
-- and a midpoint fill is labelled as a midpoint in the UI.

insert into economics_benchmarks
  (key, label, value_low, value_high, unit, geography, source, as_of, notes, tone, needs_review, sort_order)
values
  ('dc-lease-primary', 'Wholesale data center lease rate, primary markets',
   110, 185, '$/kW-month', 'US primary markets',
   'Unverified public range, entered as a starting point. Replace with a broker or JLL/CBRE figure.',
   '2026-10-05',
   'Turnkey critical IT. Powered shell trades materially lower. Check whether a quote is per kW-month or per kW-year before using it.',
   'sky', true, 10),

  ('dc-dev-cost-per-mw', 'Greenfield data center development cost',
   8000000, 14000000, '$/MW', 'US',
   'Unverified public range, entered as a starting point.',
   '2026-10-05',
   'Facility MW, not IT MW. Excludes the tenant internals package, which on our deals is a partner line of its own.',
   'violet', true, 20),

  ('powered-land-per-mw', 'Powered land',
   250000, 1500000, '$/MW', 'US primary markets',
   'Unverified public range, entered as a starting point. The spread is real: it tracks how firm the interconnect is.',
   '2026-10-05',
   'Priced on deliverable MW, not acres. An LOI-stage queue position and an energised interconnect are not the same asset.',
   'amber', true, 30),

  ('dc-cap-rate-turnkey', 'Data center cap rate, turnkey',
   5.5, 7.0, '%', 'US',
   'Unverified public range, entered as a starting point.',
   '2026-10-05',
   'Applies to a stabilized NOI. Powered shell prices wider.',
   'emerald', true, 40),

  ('dc-cap-rate-shell', 'Data center cap rate, powered shell',
   6.5, 8.5, '%', 'US',
   'Unverified public range, entered as a starting point.',
   '2026-10-05',
   null,
   'emerald', true, 50),

  ('utah-industrial-power', 'Utah industrial power rate',
   0.055, 0.075, '$/kWh', 'Utah',
   'Unverified public range, entered as a starting point. Replace with the applicable Rocky Mountain Power schedule.',
   '2026-10-05',
   'A large-load tariff is the number that matters and it is schedule-specific. This is a sanity band, not a rate.',
   'sky', true, 60),

  ('fuel-cell-heat-rate', 'Fuel cell heat rate',
   6400, 7200, 'Btu/kWh', null,
   'Unverified vendor-literature range, entered as a starting point.',
   '2026-10-05',
   'Feeds the fuel cost helper: heat rate x gas price / 1,000,000 = $/kWh. At 6,500 and $3.50/MMBtu that is $0.02275/kWh.',
   'violet', true, 70),

  ('fuel-cell-fixed-om', 'Fuel cell fixed O&M',
   14, 26, '$/kW-year', null,
   'Unverified vendor-literature range, entered as a starting point.',
   '2026-10-05',
   'Excludes stack replacement, which is usually a scheduled capital event rather than O&M.',
   'slate', true, 80)
on conflict (key) do nothing;
