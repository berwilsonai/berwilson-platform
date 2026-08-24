#!/bin/zsh
# One-shot Google Workspace auth setup for the platform.
#
# Run it on the MacBook first, then on the Studio. It is idempotent — running
# it twice is harmless.
#
#   zsh scripts/setup-google-auth.sh
#
# What it does, all of which you could do by hand in the console except the
# last step, which requires the CLI:
#   1. finds your Cloud project and the mail service account
#   2. enables the IAM Service Account Credentials API (the "signing API")
#   3. grants YOU permission to sign as that service account
#   4. logs the machine in so the platform can request signatures
#
# It creates no keys and changes no org policies.

set -euo pipefail

SA_UNIQUE_ID="111229421328742032282"   # the service account created 2026-08-23

echo
echo "=== Ber Wilson — Google Workspace auth setup ==="
echo

# ── 0. gcloud present? ───────────────────────────────────────────────────────
if ! command -v gcloud >/dev/null 2>&1; then
  cat <<'EOF'
gcloud is not installed on this machine.

Install it (no sudo, no Homebrew needed):

  cd ~
  curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-darwin-arm.tar.gz
  tar -xzf google-cloud-cli-darwin-arm.tar.gz
  ./google-cloud-sdk/install.sh --quiet --path-update true

Then open a NEW terminal and run this script again.
EOF
  exit 1
fi
echo "gcloud: $(gcloud version 2>/dev/null | head -1)"

# ── 1. Signed in? ────────────────────────────────────────────────────────────
ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"
if [ -z "$ACCOUNT" ] || [ "$ACCOUNT" = "(unset)" ]; then
  echo
  echo "--> Signing you in to gcloud. A browser will open."
  gcloud auth login
  ACCOUNT="$(gcloud config get-value account)"
fi
echo "signed in as: $ACCOUNT"

# ── 2. Which project? ────────────────────────────────────────────────────────
echo
echo "--> Finding your Cloud project..."
PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo
  echo "Your projects:"
  gcloud projects list --format="table(projectId, name)"
  echo
  echo -n "Paste the PROJECT_ID for 'Ber Intelligence' (the left column): "
  read -r PROJECT
  gcloud config set project "$PROJECT" >/dev/null
fi
echo "project: $PROJECT"

# ── 3. Which service account? ────────────────────────────────────────────────
echo
echo "--> Locating the mail service account..."
SA_EMAIL="$(gcloud iam service-accounts list \
  --project="$PROJECT" \
  --filter="uniqueId=$SA_UNIQUE_ID" \
  --format="value(email)" 2>/dev/null || true)"

if [ -z "$SA_EMAIL" ]; then
  echo "  Could not find the service account with ID $SA_UNIQUE_ID in $PROJECT."
  echo "  Service accounts in this project:"
  gcloud iam service-accounts list --project="$PROJECT" --format="table(email, uniqueId)"
  echo
  echo -n "  Paste the correct service account EMAIL: "
  read -r SA_EMAIL
fi
echo "service account: $SA_EMAIL"

# ── 4. Enable the signing API ────────────────────────────────────────────────
echo
echo "--> Enabling the IAM Service Account Credentials API..."
echo "    (this is the 'signing API' — its library name is why it was hard to find)"
gcloud services enable iamcredentials.googleapis.com --project="$PROJECT"
echo "    enabled."

# Gmail / Calendar / People, in case they were missed in the console.
echo "--> Enabling Gmail, Calendar, and People APIs..."
gcloud services enable \
  gmail.googleapis.com \
  calendar-json.googleapis.com \
  people.googleapis.com \
  --project="$PROJECT"
echo "    enabled."

# ── 5. Let this user sign as the service account ─────────────────────────────
echo
echo "--> Granting $ACCOUNT permission to sign as $SA_EMAIL..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT" \
  --member="user:$ACCOUNT" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --quiet >/dev/null
echo "    granted."

# ── 6. Application Default Credentials ───────────────────────────────────────
echo
ADC_PATH="$HOME/.config/gcloud/application_default_credentials.json"
if [ -s "$ADC_PATH" ]; then
  echo "--> Application Default Credentials already present at:"
  echo "    $ADC_PATH"
  echo "    (delete that file and re-run if you need to switch accounts)"
else
  echo "--> Logging this machine in so the platform can request signatures."
  echo "    A URL will be printed — open it, approve, paste the code back."
  gcloud auth application-default login --no-launch-browser
fi

# ── 7. What to do next ───────────────────────────────────────────────────────
cat <<EOF

=== Done on this machine ===

Put these two lines in .env.local on the MacBook:

GOOGLE_SERVICE_ACCOUNT_EMAIL=$SA_EMAIL
GOOGLE_IMPERSONATE_MAILBOXES=moose@berwilson.com,tuaone@berwilson.com

Make sure GOOGLE_SERVICE_ACCOUNT_KEY_FILE is NOT set — leaving it unset is what
selects the keyless signing path.

Then check the whole chain actually works:

  node scripts/verify-google-auth.mjs

If that passes here, run this same script on the Studio:

  ssh richardwhite@100.86.79.4
  cd berwilson-platform && zsh scripts/setup-google-auth.sh

EOF
