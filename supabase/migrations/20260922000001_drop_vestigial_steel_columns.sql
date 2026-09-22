-- Drop six steel columns that nothing reads.
--
-- All six were superseded by the 2026-08-03/04 comp-plan work and left in
-- place as non-destructive. Verified before dropping, on 2026-09-21:
--   * no reference anywhere in src/ outside the generated database.ts, except
--     steel_deal_services.commission_paid, which actions.ts read ONLY in order
--     to write the same value straight back — never displayed, never filtered
--     on, never set to true by any code path;
--   * zero rows carry a non-default value (6 deals, 16 service lines).
--
-- The deal-level payout flags on steel_deals (sales_commission_paid,
-- install_fee_paid, referral_fee_paid) are the live ones and are untouched:
-- commission became a deal-level concept in 20260803000001, which is what made
-- the per-line pair below vestigial.
--
-- marketer_id is deliberately KEPT. It is equally empty, but unlike these it is
-- still read — agent-tools-modules.ts resolves it to a name for the agent — so
-- dropping it would be a code change, not a cleanup.

alter table steel_deals
  drop column if exists marketing_rate_override,
  drop column if exists marketing_commission_paid,
  drop column if exists marketing_commission_paid_date,
  -- The old team-member referrer, replaced by referral_party_id in
  -- 20260804000001 so a referral could be paid to any contact.
  drop column if exists lead_source_id;

alter table steel_deal_services
  drop column if exists commission_paid,
  drop column if exists commission_paid_date;
