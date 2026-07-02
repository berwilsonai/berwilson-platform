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

## Future (optional) — auto-POST instead of paste

When you want to skip the copy-paste, add an **HTTP Request** node after *Format Markdown Export*
that POSTs `{ raw_text: <markdown>, label: <exportLabel> }` to a token-gated platform endpoint
(e.g. `POST /api/email-ingestion/inbound`, added to `middleware.ts`'s public allowlist with a
shared secret). The review/confirm screen stays identical — the package just shows up as a
pending item under Recent. Not wired in this version by design (paste keeps it simple and
human-triggered).
