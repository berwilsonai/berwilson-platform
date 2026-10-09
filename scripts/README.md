# scripts/

Fifty-odd files, and the thing you cannot tell from the filenames is which are
**tools you may want today** and which are **passes that ran once in September
against data that has since moved on**. That distinction is the whole purpose of
this file; nothing here is load-bearing for the app.

Four scripts that declare themselves one-shot live in `one-shot/`. Everything
below is in `scripts/` itself. A script whose header says it is idempotent or
re-runnable says so because somebody checked — trust that over the name.

Most `.mts`/`.mjs` scripts here import application code through the `@/` alias,
which needs the loader shim:

```bash
node --experimental-strip-types --import ./scripts/register-aliases.mjs \
     --env-file=.env.local scripts/<name>.mts
```

## Tools — reach for these

| Script | What it does |
|---|---|
| `verify-*.mts` / `verify-*.mjs` | Assert a feature against the live database. Twelve of them, one per feature. Run after touching the area; they are the closest thing here to integration tests. |
| `setup-google-oauth.mjs` | One-time mailbox consent — the no-gcloud, no-service-account path. Referenced by `deploy/`. |
| `setup-map-data.sh`, `setup-rail-data.sh` | Rebuild the PMTiles archives in `~/berwilson-data/maps/`. |
| `build-ocr.sh` | Build the Apple Vision OCR binary (`bw-ocr`). |
| `build-quote-template.mjs` | Rebuild the checked-in prefab steel quote template. |
| `build-gazetteer.mjs`, `rail-tile-hints.mjs`, `build-logo-assets.py` | Regenerate checked-in derived assets. |
| `setup-drive-structure.mts`, `migrate-drive-structure.mts` | Build the uniform Drive structure and move existing folders into it. Re-runnable. |
| `setup-lead-lanes.mts` | Create the Drive folder a handoff lane publishes into, and record its id. Run when a lane is added. |
| `copy-data-room.mts`, `refile-record-folder.mts` | Take our own copy of a counterparty's data room; re-file one using the current rules. |
| `import-thread-attachments.mts` | Import a mail search's attachments onto an existing record. Still wanted — 903 attachments have never been imported. |
| `reindex-unreadable-documents.mts`, `reindex-opportunity-documents.mts` | Re-run the document AI pass over documents holding no text. |
| `backfill-profile-photos.mts` | Find and file a photo for every contact that has none. Expect to re-run it across days: the Gemini key is free-tier at 20 requests/day. |
| `backfill-company-folder-paths.mts`, `backfill-meeting-records.mts` | Both safe to re-run / idempotent per their own headers. |
| `dedupe-documents.mts` | Retire cross-source duplicate documents. |
| `check-drive.mjs`, `configure-storage.ts` | Inspect Drive; set Storage bucket limits. |
| `register-aliases.mjs` | The `@/` loader shim every script above uses. **Not a task.** |
| `seed.ts`, `wipe.ts` | Test fixtures. Do not point them at this database. |

## Spent — read them, do not run them

These did a specific job to specific records and are kept for the record of
what was done, not to be run again.

| Script | Ran for |
|---|---|
| `one-shot/backfill-correspondence.mjs` | the first correspondence pass |
| `one-shot/backfill-thread-embeddings.mjs` | the original thread-chunk embed |
| `one-shot/dark-tints.mjs`, `one-shot/dark-variants.mjs` | generating the dark-mode palette |
| `seed-cliffs-sites.mts` | the five Cleveland-Cliffs sites, 2026-10-08 |
| `setup-delta-vehicles.mts`, `setup-delta-cap-tables.mts` | Delta's three vehicles and their cap tables, 2026-10-08 |
| `import-delta-parcels.mts` | Delta's 11 parcels from Utah AGRC (upserts, so safe, but Delta-specific) |
| `clear-estimated-value.mts` | clearing `estimated_value` ahead of economics, 2026-10-05 |
| `recount-thread-attachments.mts` | recounting after the inline-classification fix |
| `fix-values.ts` | a one-off value repair; header is a usage line, nothing more |

⚠ `npm run gen-types` is a **deploy** script, not one of these — `deploy/gen-types.sh`.
