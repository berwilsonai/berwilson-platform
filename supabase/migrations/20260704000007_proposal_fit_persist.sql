-- Persist the fit assessment on proposal intake sessions.
-- assessFit() runs during api/proposals/intake and was returned to the wizard
-- but never stored — so there was no record of what Ber AI recommended.
-- Mirrors email_intake_sessions.fit_assessment (FitAssessment | null).

alter table proposal_intake_sessions add column if not exists fit_assessment jsonb;
