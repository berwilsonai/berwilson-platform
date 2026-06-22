-- Pursuit / fit profile
-- Structured signals the AI uses to judge whether an inbound opportunity fits
-- Ber Wilson's appetite and capabilities. Feeds the proposal-intake fit
-- assessment and the executive agent's company-qualifications context.

alter table company_profile
  add column if not exists target_sectors      text[] not null default '{}',
  add column if not exists target_geographies  text[] not null default '{}',
  add column if not exists delivery_methods     text[] not null default '{}',
  add column if not exists contract_types       text[] not null default '{}',
  add column if not exists min_project_value    numeric(15,2),
  add column if not exists max_project_value    numeric(15,2),
  add column if not exists sweet_spot_value     numeric(15,2),
  add column if not exists annual_revenue       numeric(15,2),
  add column if not exists differentiators      text,
  add column if not exists disqualifiers        text,
  add column if not exists past_performance     text,
  add column if not exists pursuit_notes        text;

comment on column company_profile.target_sectors     is 'project_sector enum values Ber Wilson actively pursues';
comment on column company_profile.target_geographies is 'States / regions Ber Wilson targets';
comment on column company_profile.delivery_methods   is 'Delivery methods the company is set up for (Design-Build, CMAR, etc.)';
comment on column company_profile.contract_types     is 'Contract vehicles the company pursues (FFP, GMP, etc.)';
comment on column company_profile.min_project_value  is 'Smallest opportunity worth pursuing (USD)';
comment on column company_profile.max_project_value  is 'Largest opportunity the company can take on (USD)';
comment on column company_profile.sweet_spot_value   is 'Ideal project size (USD)';
comment on column company_profile.differentiators    is 'Win themes / competitive edge';
comment on column company_profile.disqualifiers      is 'Hard no-go criteria — opportunities to pass on';
comment on column company_profile.past_performance   is 'Notable past projects / relevant experience';
comment on column company_profile.pursuit_notes      is 'Freeform notes on current appetite and strategic priorities';
