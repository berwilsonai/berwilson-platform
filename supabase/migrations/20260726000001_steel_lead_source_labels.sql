-- Lead sources become a free-form, self-maintaining vocabulary: the display
-- text is stored directly in steel_deals.lead_source (the deal form suggests
-- values in use and typing a new one creates it — no code change per source).
-- Convert the original fixed-vocab slugs to their labels.

update steel_deals set lead_source = case lead_source
  when 'marketing' then 'Marketing'
  when 'team_member' then 'Team Referral'
  when 'architect' then 'Architect Firm'
  when 'engineer' then 'Engineering Firm'
  when 'existing_customer' then 'Existing Customer'
  when 'website' then 'Website'
  when 'trade_show' then 'Trade Show'
  when 'other' then 'Other'
  else lead_source
end
where lead_source in (
  'marketing', 'team_member', 'architect', 'engineer',
  'existing_customer', 'website', 'trade_show', 'other'
);

alter table steel_deals alter column lead_source set default 'Other';
