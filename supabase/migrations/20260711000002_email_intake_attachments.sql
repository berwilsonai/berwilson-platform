-- Email intake attachment staging.
-- The email-research run now saves every qualifying Outlook attachment to
-- storage (documents bucket, email-intake/{sessionId}/…) so the review screen
-- can offer a picker; confirm copies the selected files into the created
-- project/opportunity as real document rows and clears the staging folder.
-- StagedAttachment[] shape lives in src/lib/email-ingestion/attachments.ts.

alter table email_intake_sessions
  add column if not exists staged_attachments jsonb default '[]';
