-- Add Outlook web link to both processed_emails and updates so users can
-- open the original email in Outlook on the web. Captured from Graph API's
-- webLink property during email processing.

alter table processed_emails add column outlook_web_link text;
alter table updates add column outlook_web_link text;

-- Allow raw_content on updates to be nullable so we can purge the email body
-- after the summary has been reviewed and approved (saves storage).
alter table updates alter column raw_content drop not null;
