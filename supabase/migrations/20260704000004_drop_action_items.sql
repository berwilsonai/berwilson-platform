-- Drop updates.action_items — the last remnant of the legacy JSON task model.
-- All reads moved to the tasks table 2026-07-03; writes stopped 2026-07-03
-- (manual-paste extraction now creates real tasks directly, and review-queue
-- approval converts any legacy pending items to tasks before this lands).
-- Code shipped first and no longer references the column, so this can apply
-- any time. Data loss is limited to historical JSON blobs already superseded
-- by the tasks table.

alter table updates drop column if exists action_items;
