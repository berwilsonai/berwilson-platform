# Website deal intake — the contract

The berwilson.com lead form collects a due-diligence checklist and creates one
Google Drive folder per submitted deal. This is what the form has to do for that
folder to reach Ber Intelligence.

## Why a file and not an HTTP call

Ber Intelligence is tailnet-only. `middleware.ts` admits nine cron paths and the
login page; everything else without a Supabase session gets a 401. A public form
cannot POST to it, and putting the Studio back on the internet for one endpoint
was deliberately undone in July.

So the submission travels as a file: the form writes its answers into the folder
it already creates, and the platform reads it on a 15-minute cron. Nothing is
re-extracted by a model on the way in — the structure the form collected is the
structure that lands.

## 1. Create the folder as the platform's own identity

Create each deal folder **as `moose@berwilson.com`, using the same OAuth client
id the platform uses**.

This is not incidental. The platform holds `drive.file`, which grants access to
files *the app created* — so a folder created under this client is one the
platform can both read and **write**. That is the difference between:

- one folder, which the team works in and the platform publishes into, and
- two folders that drift apart, because documents added inside Ber Intelligence
  have nowhere to go but a second, platform-created folder.

If the form ends up using different credentials, share the parent folder with
`moose@` (Viewer is enough) — importing still works via `drive.readonly`, but
accept the second folder. Nothing else in the platform needs changing.

Place the folder **directly inside** the parent folder whose id is set as
`GOOGLE_DEAL_INTAKE_FOLDER_ID`. Name it after the deal; the name is only used in
logs, the title comes from the manifest.

## 2. Write `_intake.json` LAST

The manifest's presence is the "this submission is complete" signal. The scan
skips a folder that has none and tries again on the next pass, so a folder that
is still receiving uploads is never picked up half-written.

Write it after the folder exists and after any documents have finished uploading.

```json
{
  "version": 1,
  "title": "Millcreek Mixed-Use — 240 units",
  "submitted_at": "2026-09-05T18:22:00Z",
  "route": "construction",

  "contact": {
    "name": "Dana Reyes",
    "email": "dana@sponsorco.com",
    "phone": "801-555-0142",
    "company": "SponsorCo Development LLC"
  },

  "deal": {
    "summary": "One paragraph — what the deal is.",
    "scope": "Longer description of the work.",
    "location": "Millcreek, UT",
    "sector": "real_estate",
    "estimated_value": 62000000,
    "bid_due_date": "2026-10-15"
  },

  "checklist": {
    "site_control": { "answer": "Under contract, closing Nov 2026", "provided": true },
    "fin_capital_stack": { "answer": "60% senior debt, 30% LP equity, 10% sponsor", "provided": true },
    "env_phase_one": { "answer": null, "provided": false }
  }
}
```

Notes on the fields:

- **`title` is the only required field.** Everything else may be absent; a
  missing optional field costs a blank on the lead, not a rejected submission.
- **`route`** — one of `construction`, `corporate`, `steel`, `dino`, `unknown`.
  It decides what Promote offers to create. Anything unrecognised (or absent)
  becomes `construction`, which is where a development deal belongs.
- **`sector`** is free text and is validated on the platform side, so a bad
  value cannot break anything. Useful values: `real_estate`, `government`,
  `infrastructure`, `institutional`, `prefab`, `technology`, `health`.
- **`estimated_value`** may be a number or a typed string — `"$62,000,000"`
  parses.
- **`checklist`** entries may also be a bare string (`"site_control": "Under
  contract"`) or a boolean. All three shapes are accepted, because losing the
  answers over a shape mismatch would be the worst failure available here.
- Any **extra checklist key** the platform does not recognise still becomes a
  visible diligence item, filed under `Other`. Drift is surfaced, not dropped.

## 3. Checklist keys

They must match `key` in `src/lib/deal-intake/checklist.ts`, which is the single
definition — the form is built from a copy of that list. Changing a question is
a one-line edit on each side.

Current keys, by category:

| Category | Keys |
| --- | --- |
| Site | `site_address`, `site_acreage`, `site_control`, `site_survey`, `site_utilities`, `site_access` |
| Title | `title_report`, `title_encumbrances` |
| Regulatory | `zoning_current`, `zoning_entitlements`, `permit_timeline`, `impact_fees` |
| Environmental | `env_phase_one`, `env_geotech`, `env_floodplain` |
| Financial | `fin_capital_stack`, `fin_proforma`, `fin_hard_costs`, `fin_ber_role`, `fin_returns` |
| Market | `market_demand`, `market_study` |
| Partner | `partner_entity`, `partner_track_record`, `partner_references` |
| Legal | `legal_structure`, `legal_litigation` |
| Bonding | `bonding_required` |

Read the labels off `checklist.ts` rather than retyping them — the dd_item on
the Diligence tab is created from the label, so the two staying identical is
what makes an answered question and a hand-typed one indistinguishable.

## 4. Documents

Put whatever the submitter uploads in the same folder. Nothing needs naming or
declaring — everything except `_intake.json` is imported when the lead is
promoted, and re-imported nightly as the folder fills during diligence.

Supported for text extraction and indexing: PDF, .docx, plain text/markdown/CSV,
and Google Docs. Spreadsheets and slides are stored but deliberately not indexed
(a flattened spreadsheet is misleading evidence). Anything over 30MB is skipped.

## What happens next, on the platform side

1. **Within 15 minutes** the folder becomes a lead in `/leads`, tagged
   *Deal form*, with the checklist and its gaps visible.
2. **On the next lead sweep** it is scored by `assessFit` against the company
   profile and knowledge base, reading the checklist plus the text of whatever
   documents are in the folder. Nothing is copied at this stage.
3. **A human presses Promote.** Only then is a project created — the platform
   proposes, a person decides. The project adopts the folder, imports every
   document into it and indexes them for Ber AI, and turns the checklist into
   diligence items with the unanswered required ones left open.
4. **Nightly** the folder is re-read, so anything added during diligence reaches
   the project.

## Configuration

| Where | What |
| --- | --- |
| `.env.local` on the Studio | `GOOGLE_DEAL_INTAKE_FOLDER_ID=<parent folder id>` |
| launchd | `com.berwilson.cron-deal-intake` — every 15 minutes |
| Check it | `/settings/health` → **Deal Intake** |

Unset means intake is off: the form still runs and still creates folders,
nothing reaches the queue, and the health page says so.
