-- Which data-room template a record's Drive folder is built from.
--
-- Richard's 2026-10-29 standard — three sections and nineteen subfolders — is
-- written for power and data-center deals: section 02 is compute offtake, GPU
-- specifications and customer acceptance, which mean nothing on a plumbing
-- acquisition, a gold mine or a DFCM building job. Asked whether to apply it
-- everywhere, he chose the power/data-center deals only, so two templates live
-- at once and the record has to say which it is.
--
-- A plain text column with a DEFAULT, deliberately, not an enum and not a CHECK:
-- §12 — a CHECK is a list baked into the schema and an FK points at rows, and
-- the member set here grows with the business (housing and steel are the
-- obvious next two). The vocabulary lives in ONE place that the build can
-- enforce instead: `ROOM_TEMPLATES` in src/lib/drive/data-room.ts is typed
-- `Record<RoomTemplateKey, …>`, so adding a member names every switch that has
-- not handled it. A value this platform does not recognise reads as 'standard'
-- through `isRoomTemplateKey`, which is the safe direction — the existing flat
-- scheme, exactly as the 24 records on it behave today.
--
-- NOT NULL with a default rather than nullable: a null would be a third state
-- meaning the same thing as 'standard', and §12 has been bitten repeatedly by a
-- nullable column hiding rows from every reader that filters on it (`.neq()` is
-- NULL, and therefore not true, for a NULL column).

alter table projects
  add column if not exists data_room_template text not null default 'standard';

alter table opportunities
  add column if not exists data_room_template text not null default 'standard';

comment on column projects.data_room_template is
  'Which Drive data-room template this record''s folder is built from. ''standard'' = the flat scheme in classify.ts; ''data_center'' = Richard''s 00/01/02 diligence room. Vocabulary and behaviour: src/lib/drive/data-room.ts.';

comment on column opportunities.data_room_template is
  'Which Drive data-room template this record''s folder is built from. See projects.data_room_template.';
