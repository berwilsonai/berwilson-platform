# Ber Wilson AI — Email Research (n8n) → Platform Email Ingestion

This workflow runs on Richard's Mac Studio. It searches Outlook, pulls the matching
threads + attachments, extracts attachment text (local Python service), runs the local
**Qwen** model per thread, aggregates everything, and **emails a markdown report**.

The platform now has an **Email Ingestion** area (`/email-ingestion`) that digests that
report: paste the report text (or drop the `.md`), and Ber AI (Gemini) maps it into a
proposed **opportunity or project** — with people and tasks — for you to review and confirm.

> **You do NOT need to re-import the workflow JSON.** Re-importing would wipe the Outlook
> OAuth credential you selected on the 3 Graph nodes and the model id you pasted into
> *Build LLM Request*. Instead make the two in-place edits below. Everything else stays as-is.

---

## Edit 1 — enrich the Qwen prompt (node: **Build LLM Request**)

Open the *Build LLM Request* code node and replace the `systemPrompt` line with the version
below. It keeps the exact same JSON shape (so the rest of the workflow is unchanged) but tells
the model to fold **opportunity signals** into `key_facts`. Those ride through aggregation and
land in the emailed report, giving the platform's Gemini pass more to map — no other node needs
to change.

```js
const systemPrompt = 'You are an information-extraction engine. You will be given the full text of an email thread (and any attachment text). Extract structured information ONLY. Do not add commentary, opinions, or anything not grounded in the text. Respond with valid JSON only, no markdown fences, matching exactly this shape: {"people":[{"name":"","email":"","role_guess":"","relevance_note":""}],"key_facts":[""],"decisions":[""],"action_items":[""],"dates_mentioned":[""],"dollar_figures":[""]}. IMPORTANT: if the thread describes a business opportunity or a construction/development project, PREPEND these entries to key_facts (one per line, only when supported by the text): "OPPORTUNITY SIGNAL — kind: opportunity|project", "OPPORTUNITY SIGNAL — type: <acquisition|partnership|joint_venture|investment|teaming|market_entry OR sector for a project>", "OPPORTUNITY SIGNAL — counterparty/target: <name>", "OPPORTUNITY SIGNAL — location: <city, state>", "OPPORTUNITY SIGNAL — value: <$ amount>", "OPPORTUNITY SIGNAL — live pursuit: yes|no". Omit any signal you cannot ground in the text.';
```

That's the only functional change. The `model`, `temperature`, and `messages` lines below it
stay exactly as they are (keep your pasted model id).

## Edit 2 — update the Setup Notes (node: **Setup Notes** sticky)

Add this as a new step 5 so the loop is documented:

```
5. When the report email arrives (or from the n8n execution log), open the Ber Wilson platform → Email Ingestion (/email-ingestion), paste the markdown (or upload the .md file), and click "Analyze with Ber AI". Review the proposed opportunity/project, people, and tasks, then Confirm to create them.
```

---

## How the loop works now

```
n8n (Mac, Qwen)                          Platform (Vercel, Gemini)
────────────────                         ─────────────────────────
search term → threads + attachments →    /email-ingestion  (paste or upload .md)
Qwen per-thread extract →                POST /api/email-ingestion/analyze
aggregate → markdown report → email      → Gemini maps → review screen
                                         → pick Opportunity | Project, edit people/tasks
                                         → Confirm → records created
```

The platform re-runs one Gemini pass on the report, so the **current markdown output already
works** — Edit 1 just sharpens the signal. Keep Qwen doing the private, local gathering.

## Automatic mode — trigger from the platform + auto-delivery (now supported)

The platform can now both **start** a run and **receive** the finished report, so you don't have
to open the n8n form or copy-paste. Two platform endpoints + two secrets are involved (kept
distinct on purpose):

| Direction | Platform side | n8n side | Secret / header |
| --- | --- | --- | --- |
| Start a run | `/email-research` page → `POST /api/email-research/trigger` | a **Webhook** trigger node | `N8N_WEBHOOK_SECRET` sent as `X-Webhook-Secret` |
| Deliver report | `POST /api/email-ingestion/inbound` (public, secret-gated) | an **HTTP Request** node | `INGESTION_INBOUND_SECRET` sent as `X-Ingestion-Secret` |

**1. Receive the trigger (replaces the manual form).** Add a **Webhook** node (method POST) as an
alternate entry point. Set the platform env var `N8N_WEBHOOK_URL` to that webhook's URL and
`N8N_WEBHOOK_SECRET` to a shared secret; optionally verify the incoming `X-Webhook-Secret` header
inside n8n. The webhook receives `{ "searchTerm": "...", "exportLabel": "..." }` — feed those into
the existing *Normalize Input* node (it already reads `searchTerm` / `exportLabel`).

**2. Deliver the report (replaces the email step).** After *Format Markdown Export*, add an
**HTTP Request** node:
- Method **POST**, URL `https://<your-platform-domain>/api/email-ingestion/inbound`
- Header `X-Ingestion-Secret: <INGESTION_INBOUND_SECRET>` (same value you set on the platform)
- JSON body `{ "raw_text": {{ $json.markdown }}, "label": {{ $json.exportLabel }} }`

The report then shows up as a **pending** item under **Email Ingestion &gt; Recent**, awaiting the
same human review/confirm step — nothing is auto-created. You can keep the email step too if you
still want a copy in your inbox. Manual paste/upload on `/email-ingestion` also keeps working
exactly as before.
