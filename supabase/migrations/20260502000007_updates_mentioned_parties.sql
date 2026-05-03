-- Add mentioned_parties JSONB column to updates table.
-- Stores the list of people/companies the AI extracted from an email or paste.
-- Used to surface one-click "Add as Contact" actions in the review queue.

alter table updates
  add column if not exists mentioned_parties jsonb not null default '[]';
