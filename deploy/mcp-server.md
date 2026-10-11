# MCP server — scoped access for an external assistant

Lets an outside assistant (Grok, Claude, anything speaking MCP) read a small,
audited slice of the CRM over HTTPS with a bearer token — instead of being given
a browser session, a mailbox, or the run of the machine.

**It ships switched OFF.** Nothing answers until you enable it deliberately.

---

## Read this first: what it is, and what it is not

**It replaces the dangerous shape of this idea.** A computer-use agent — one that
reads the screen, the mail and the texts — cannot be made safe on the Mac Studio,
because every containment control in this platform filters rows *server-side at
read time* and a screen reader sits downstream of all of them. Worse, the
confidential step-up inverts: clear TOTP, and anything capturing the screen in
that 30-minute window ships the protected deal out with the lock already
cleared. MCP removes that entirely — the assistant gets typed answers and never
a screen.

**⚠ It is NOT cleared for CUI, and no setting here changes that.** §8's GovCloud
trigger is unchanged. Under NIST 800-171 / CMMC L2 any external service that
*processes, stores or transmits* CUI must meet FedRAMP Moderate equivalence; a
bearer token and a database view are not that control. ITAR/EAR applies
separately for defense technical data, and DFARS 252.204-7012 brings 72-hour
incident reporting you cannot discharge for a third-party LLM provider you have
no contract with.

And the pipe itself is a finding: an assessor asks what transmits CUI, and an
always-available endpoint that *can* reach project records is in scope even if
you intend to mark those projects confidential — because that is a mutable
column, one `UPDATE` from exposure. **For government work the answer is
separation, not configuration:** the data lives where this server cannot reach
it. Settle that with counsel before the first DoD award, not after.

---

## The security model

Three layers, and only the first is structural.

**1. SQL decides what exists.** `mcp_projects` and `mcp_tasks`
(`supabase/migrations/20261011000001_mcp_server.sql`) carry the exclusion in
their own `WHERE` clauses. A protected project is not filtered out of a
result — it was never in one. New code cannot forget the filter, because the
filter is not in the code. **Every read in `src/lib/mcp/tools.ts` names a view
and never a base table**; if you are about to write `.from('projects')` there,
you are removing the only structural protection this surface has.

The task rule is measured, not assumed. Live on 2026-10-11: 46 tasks — 5 on a
project, 3 on an opportunity, 27 on a lead, 11 with no parent at all.

| Task parent | Treatment | Why |
|---|---|---|
| A project | Exposed iff the project is not confidential | The flag is authoritative |
| Anything else, or nothing | Exposed **unless its own text names a confidential project** | `confidential` exists only on projects, so there is no flag to consult — and the text check is also the only thing that catches a task written *about* a protected deal with no link to it |

An earlier version withheld every non-project parent as "unverifiable" and
exposed 16 of 46 rows. That is a tool not worth having, and the reasoning was
wrong: absence of a flag is not a withheld answer.

**2. `src/lib/mcp/policy.ts` decides who may ask.** Kill switch (read first, on
every request, fails closed), then the token: sha256 at rest, scoped per tool,
expiring, revocable. Every rejection returns the same words, so the error text
cannot be used to probe which tokens or scopes exist.

**3. `mcp_audit` records what left.** Every call including refusals, with the
count *and the ids* of what went out and how many rows were withheld — never the
content, so the audit table does not become a second copy of the data.

**Withheld counts are counted, not derived.** §12: `total - visible` is
structurally zero once the exclusion ran in SQL. Responses carry the real figure
plus a note telling the assistant not to describe the result as complete.

---

## Turning it on

```bash
cd ~/berwilson-platform
RUN="node --experimental-strip-types --import ./deploy/register.mjs --env-file=.env.local"

# 0. Prove containment still holds. Do this after ANY migration touching
#    projects, tasks or the mcp_* views.
zsh deploy/mcp-containment-check.sh

# 1. Mint a credential. The secret prints ONCE.
#    mint "<label>" [days] [tool …]   — tools default to all of them
$RUN scripts/mcp-token.mts mint "Grok on my phone" 30 list_projects list_tasks

# 2. Switch the server on.
$RUN scripts/mcp-token.mts on
```

Other commands:

```bash
$RUN scripts/mcp-token.mts list                 # every credential and its state
$RUN scripts/mcp-token.mts revoke <id>          # stops on the next request
$RUN scripts/mcp-token.mts off "why"            # the kill switch
$RUN scripts/mcp-token.mts audit 50             # what has been called
```

**Rotation.** Tokens default to 30 days and expire hard — an expired token is
refused with the same "Invalid token." as an unknown one. To rotate: mint the
new one, update the assistant's config, then `revoke` the old id. Minting does
not revoke anything, so there is no gap.

### Give it the narrowest scope that works

A token with no scopes can call nothing (that is deliberate — empty means none,
not all). `tools/list` only advertises the tools the presented token may
actually call, so a narrow token also keeps the assistant from planning around
calls that would fail.

| Tool | Returns |
|---|---|
| `list_projects` | name, stage, status, sector, location, bid due date, next milestone, open task count |
| `get_project` | one project plus its open tasks |
| `list_tasks` | title, what, why, status, due date, project, assignee |
| `search` | project names and task titles |

**There are no write tools, deliberately.** Every record-writing path in this
platform is draft-only or human-confirmed by construction (§11,
`leads/draft-reply.ts`, `commitments/chase.ts`), and an external actor creating
records directly is the thing that invariant exists to prevent. When writes are
wanted they should *stage a proposal a human confirms* — the pattern used
everywhere else here — not a direct insert behind a config flag.

---

## Reaching it from outside the tailnet

**Nothing here opens a public port, and that is the current state: the endpoint
is tailnet-only like the rest of the platform.** An assistant running on your
phone over Tailscale can already reach it. An assistant running in xAI's or
Anthropic's cloud cannot.

Making it publicly reachable is a separate, deliberate decision with
consequences this code cannot contain:

- A permanently internet-reachable endpoint **on the production host** — the box
  that also holds the mail refresh tokens (`~/berwilson-data/google-oauth-tokens.json`),
  `SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` — guarded by one bearer token.
- `deploy/tailnet-setup.sh` asserts **two** listeners. A Funnel listener is
  outside the only check that watches for these disappearing, and Tailscale
  state is wiped by a logout, upgrade or reinstall.
- It inverts §8's US-only, no-public-ingress premise, which is the GovCloud
  story.

If you decide to do it anyway, the materially safer orderings are, best first:

1. **Terminate on a different host.** A small always-on box runs the tunnel and
   forwards to the Studio over the tailnet. A compromise of the public surface
   then reaches a machine holding no credentials.
2. **Invert the direction.** Have the platform *push* to the assistant, the way
   it already pushes to Google Tasks and Chat. Production keeps zero inbound
   ports. This is the shape to prefer if the use case is reminders rather than
   questions.
3. **`tailscale funnel 443 on`** directly, accepting the above — and then add the
   listener assertion to `tailnet-setup.sh` so its disappearance is noticed,
   and shorten token life.

In every case: keep the kill switch to hand, and re-read `audit` regularly.
`middleware.ts` allowlists `/api/mcp` as an **exact match, not a prefix** —
§12's `matchesPrefix` is not method-aware, so a prefix would unauthenticate
anything added underneath it later.

---

## Checklist before connecting an assistant

Run against the real endpoint. `TOKEN` is the minted secret;
`BASE=https://richards-mac-studio.tail9acc02.ts.net/api/mcp`.

```bash
# With the MCP Inspector, which is the quickest way to see the tool schemas:
npx @modelcontextprotocol/inspector
#   transport: Streamable HTTP   url: $BASE
#   header:    Authorization: Bearer <token>
```

Verified on 2026-10-11 against the built app; each should still hold:

| Check | Expected |
|---|---|
| `off`, then any call with a **valid** token | `503`, switched off — the kill switch is read before the token |
| No `Authorization` header | `401` from the route, **not** middleware's `"Not authenticated"` |
| Garbage token | `401 Invalid token.` |
| Revoked token | `401 Invalid token.` — same words as unknown |
| `tools/list` with a 2-scope token | exactly those 2 tools, not all 4 |
| `tools/call` a tool outside scope | `No such tool: <name>` — identical to a tool that does not exist |
| `list_projects` | real rows, `confidential_projects_withheld: 0` |
| Mark a project confidential, re-run | it is **absent**, the count rises to 1, and the response carries the "do not describe this list as complete" note |
| `audit` afterwards | one row per call, refusals included, with ids and withheld counts |

The last two are the ones worth repeating after any schema change.
`zsh deploy/mcp-containment-check.sh` automates the containment half — it
protects a real project *inside a transaction it always rolls back*, asserts the
project, its tasks, an unlinked task naming it, and a search by its name all
return nothing, and refuses to pass vacuously by first requiring the subject to
be visible. Its failure path is itself tested: breaking the view's `WHERE`
clause makes it report 2 failures and exit 1.
