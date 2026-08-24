# Connecting the platform to Google Workspace

**Status: done, 2026-08-23.** Both mailboxes are connected and reading. This
document is the record of how, and the runbook for redoing it.

## What is actually in use: per-mailbox OAuth

Three auth modes exist in `src/lib/integrations/google-workspace.ts`. The one in
use is the third, because the first two are blocked here:

| Mode | Status | Why |
|---|---|---|
| Service account + downloaded key | **blocked** | The Cloud org enforces `iam.managed.disableServiceAccountKeyCreation` (part of Google's auto-applied security baseline). Keys cannot be downloaded. |
| Service account + `signJwt` (Google-managed key) | **possible, not used** | Needs no key, but needs `gcloud` installed on the Studio to supply a caller credential. Kept in the code; switch to it by setting `GOOGLE_SERVICE_ACCOUNT_EMAIL`. |
| **Per-mailbox OAuth** | **IN USE** | A stored refresh token per mailbox. Set up entirely in the Cloud console plus one browser sign-in per mailbox. No service account, no domain-wide delegation, no org policy, nothing to install. |

The tradeoff of the mode in use: a refresh token **can** be revoked — a password
change, or an admin revoking app access — and mail ingestion then stops until
someone re-consents. That is the one operational regression versus a service
account. Recovery is one command (see *Re-consenting* below).

Everything requested is **read-only**. The platform cannot send, delete, or
modify mail.

## Current configuration

- OAuth client: Desktop app type, in project **berwilson-website** (display name
  since changed to "Ber Intelligence"), client id `247991610437-…`
- Credentials stored at `~/berwilson-data/google-oauth-tokens.json`, mode 600,
  on **both** the MacBook and the Studio (outside the app dir, so the deploy
  `rsync --delete` never touches them)
- Mailboxes: `moose@berwilson.com`, `tuaone@berwilson.com`
- Env: `GOOGLE_OAUTH_TOKENS_FILE`, `GOOGLE_IMPERSONATE_MAILBOXES`.
  `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` are
  deliberately **unset** — their absence is what selects this mode.

## Check it any time

```sh
node scripts/verify-google-auth.mjs
```

Walks the whole chain and prints real message/thread counts per mailbox. It
detects which mode is active, so it works unchanged if the auth mode ever
switches. `/settings/health` shows the same thing in the UI.

## Re-consenting (the one recurring chore)

If `verify` reports `consent no longer valid`, or `/settings/health` shows the
Google check failing:

```sh
node scripts/setup-google-oauth.mjs --only tuaone@berwilson.com
scp ~/berwilson-data/google-oauth-tokens.json richardwhite@100.86.79.4:~/berwilson-data/
```

`--only` leaves the other mailbox's stored consent alone.

## Setting it up from scratch

Console steps, in order:

1. Enable **Gmail API**, **Google Calendar API**, and **People API** on the
   project. (Enablement is per-project — a client in project A is not covered by
   APIs enabled in project B. That bit us once.)
2. **APIs & Services → OAuth consent screen** (newer consoles: *Google Auth
   Platform → Audience*). User type **Internal** — no Google review, no
   verification, no scope justification.
3. **Credentials → Create Credentials → OAuth client ID → Desktop app.**
   Desktop app is required: it is the only client type that permits the
   `http://127.0.0.1` loopback redirect the consent script uses. A Web
   application client fails with `redirect_uri_mismatch`.
4. **Download JSON.** This is an OAuth client secret, *not* a service account
   key, which is why the org policy does not block it.
5. Run the consent script and sign in as each mailbox:

   ```sh
   node scripts/setup-google-oauth.mjs ~/Downloads/client_secret_*.json
   ```

   Expect a "Google hasn't verified this app" screen — it is your own Internal
   app; **Advanced → Go to …**. The script checks which account you actually
   signed in as and offers a retry on mismatch, because being already signed in
   as the wrong account is the easy mistake.
6. Copy the tokens file to the Studio (see *Re-consenting* above) and deploy.

Afterwards, delete the client secret from `~/Downloads` — its contents live in
the tokens file now.

## The service-account path, if the org policy is ever lifted

Kept for reference; nothing below is needed while per-mailbox OAuth is in use.

---

## Part 1 — Google Cloud: create the service account

1. Go to **https://console.cloud.google.com** and sign in as an admin on the
   `berwilson.com` domain.

2. **Create (or pick) a project.** Top bar → project dropdown → **New Project**.
   - Name: `berwilson-platform`
   - Leave the organization as `berwilson.com`.
   - Click **Create**, then make sure that project is selected in the top bar.

3. **Enable the three APIs.** For each one, go to the link, confirm the right
   project is selected in the top bar, and click **Enable**:
   - Gmail API — https://console.cloud.google.com/apis/library/gmail.googleapis.com
   - Google Calendar API — https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
   - People API — https://console.cloud.google.com/apis/library/people.googleapis.com

   > Skipping one of these produces a `has not been used in project` error later.

4. **Create the service account.**
   - Go to **IAM & Admin → Service Accounts**
     (https://console.cloud.google.com/iam-admin/serviceaccounts)
   - Click **+ Create Service Account**
   - Service account name: `berwilson-platform-mail`
   - Click **Create and Continue**
   - **Skip** the "Grant this service account access to project" step — it needs
     no project roles at all. Click **Continue**, then **Done**.

5. **Copy the Client ID.** You will need it in Part 2.
   - Click the service account you just created.
   - On the **Details** tab, copy the **Unique ID** — a long number. That is
     the "Client ID" the admin console asks for.
   - For the account already created on 2026-08-23 this is
     **`111229421328742032282`**.

6. **Copy the service account's email address.** Still on the Details tab —
   it looks like `berwilson-platform-mail@PROJECT-ID.iam.gserviceaccount.com`.
   You'll need it in Part 3.

7. **Do NOT create a key.** The Keys tab will refuse, and nothing here needs
   one. Skip it entirely.

8. **Enable the IAM Service Account Credentials API** — this is what performs
   the remote signing:

   ```sh
   gcloud services enable iamcredentials.googleapis.com --project=PROJECT_ID
   ```

   (or via the console:
   https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com)

9. **Let yourself sign as the service account.** Replace both placeholders:

   ```sh
   gcloud iam service-accounts add-iam-policy-binding \
     berwilson-platform-mail@PROJECT_ID.iam.gserviceaccount.com \
     --member="user:you@berwilson.com" \
     --role="roles/iam.serviceAccountTokenCreator"
   ```

   This grants the ability to sign *as* that service account. It does not grant
   the service account anything, and it does not touch any org policy.

---

## Part 2 — Admin console: authorize the delegation

This is the step that actually grants mailbox access, and the step most likely
to be the culprit if something fails later.

1. Go to **https://admin.google.com** and sign in as a super-admin.

2. Navigate to **Security → Access and data control → API controls**.
   (Direct link: https://admin.google.com/ac/owl)

3. At the bottom, click **Manage Domain Wide Delegation**.

4. Click **Add new**.

5. **Client ID**: paste the **Unique ID** you copied in Part 1, step 5.

6. **OAuth scopes**: paste this line exactly, as one comma-separated string:

   ```
   https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/contacts.readonly,https://www.googleapis.com/auth/contacts.other.readonly
   ```

   > These must match `SCOPES` in `src/lib/integrations/google-workspace.ts`
   > **exactly**. Google checks the set as a whole: one missing or misspelled
   > scope fails *every* call, not just the feature that needed it.

7. Click **Authorize**.

8. Wait a few minutes. Delegation changes take up to ~15 minutes to propagate,
   and testing too early gives a confusing `unauthorized_client` error.

---

## Part 3 — Authorize the Studio (signJwt mode only)

The Studio needs a `gcloud` credential so it can request signatures. This is a
**user** credential, not a service account key.

1. Install the gcloud CLI on the Studio if it isn't there
   (https://cloud.google.com/sdk/docs/install — the macOS ARM tarball needs no
   sudo, same pattern as the Node install).

2. Over SSH, run the login. `--no-launch-browser` prints a URL you open on your
   MacBook and a code you paste back, which is what makes this work headless:

   ```sh
   ssh richardwhite@100.86.79.4
   gcloud auth application-default login --no-launch-browser
   ```

   Sign in as the account you granted Token Creator to in Part 1, step 9.

3. This writes `~/.config/gcloud/application_default_credentials.json` on the
   Studio. That file is what the platform reads — nothing else to install.

4. Add these to `.env.local` **on the MacBook** (the deploy script regenerates
   the Studio's copy from it):

   ```sh
   GOOGLE_SERVICE_ACCOUNT_EMAIL=berwilson-platform-mail@PROJECT_ID.iam.gserviceaccount.com
   GOOGLE_IMPERSONATE_MAILBOXES=moose@berwilson.com,tuaone@berwilson.com
   ```

   Leave `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` unset — setting it switches the
   platform to local signing, which is what this org's policy prevents.

5. Remove the dead Microsoft variables from `.env.local` — they do nothing now:
   `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`,
   `MICROSOFT_WEBHOOK_SECRET`, `MICROSOFT_SECRET_EXPIRES`.

6. Apply the database migration and regenerate types:

   ```sh
   npx supabase db push
   npm run gen-types
   ```

7. Deploy:

   ```sh
   zsh deploy/deploy-to-studio.sh
   ```

## Part 4 — Verify

Open **/settings/health**. The **Google Workspace** check should read:

> Connected — token mint verified just now for moose@berwilson.com, tuaone@berwilson.com
>
> Signing via google-managed key (signJwt). …

If it does, calendar, meeting prep, contact enrichment, and the mailbox sweep
are all live. There is nothing to reconnect, now or ever.

### If it fails

| What you see | What it means | Fix |
|---|---|---|
| `unauthorized_client` | Part 2 didn't take | Re-check the Client ID is the **Unique ID** (a number), not the email. Re-check the scope string matches character for character. Wait 15 min. |
| `invalid_grant` | Mailbox rejected | Confirm both addresses exist and are active in Workspace. Also check the Studio's clock — a skewed clock invalidates the signed JWT. |
| `Invalid JWT Signature` | Bad or rotated key | Download a fresh JSON key (Part 1, step 6) and replace the file. |
| `has not been used in project` | An API is off | Go back to Part 1, step 3 and enable all three. |
| `Google is not configured` | Env var missing | Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` in `.env.local` and redeploy. |
| `No Application Default Credentials` | Part 3 step 2 not done on the Studio | Run `gcloud auth application-default login --no-launch-browser` **on the Studio**, not the MacBook. |
| `lacks Token Creator` | Part 1 step 9 missing or done for the wrong user | Re-run the `add-iam-policy-binding` command with the account you actually logged in as. |
| `IAM Service Account Credentials API is not enabled` | Part 1 step 8 missing | `gcloud services enable iamcredentials.googleapis.com` |
| `Could not refresh the gcloud credential` | The ADC login was revoked or expired | Re-run the Part 3 login. If this recurs often, a Workspace **Google Cloud session length** policy is forcing re-auth — ask for this account to be exempted. |

---

## Starting a backfill

The sweep runs hourly via `com.berwilson.cron-email-sweep`. The first
full-history backfill was started 2026-08-23 and completed its fetch phase
immediately: 84 threads in moose@, 487 in tuaone@, 38 of which were the same
conversations already captured from moose@ and correctly deduped — **533 unique
threads**.

To start one again, from the Studio:

```sh
curl -sS -X POST http://localhost:3000/api/email-sweep/run \
  -H 'Content-Type: application/json' \
  -d '{"phases":["fetch"],"sinceDays":null,"budgetMs":600000}'
```

That reads thread metadata for **all** history in both mailboxes — network-bound,
so it finishes in minutes. The slow part is the AI pass, which the hourly cron
then grinds through in the background.

Watch progress any time:

```sh
curl -sS http://localhost:3000/api/email-sweep/status | python3 -m json.tool
```

### What to expect

The AI reads roughly **one thread every 25–50 seconds** on the local model, so
budget about **8–14 hours per 1,000 threads**. A multi-year, two-mailbox backfill
realistically runs for **several days** of background inference.

That's fine, and the queue is deliberately ordered to make it fine: threads are
read **newest-first**, so the live pipeline reaches the CRM in the first day or
two and the deep archive fills in behind it. Reviews appear under **Email
Intake** continuously as clusters are staged — you don't wait for the sweep to
finish to start using it.

Nothing is ever created without you confirming it.
