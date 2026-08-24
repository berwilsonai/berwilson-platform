#!/usr/bin/env node
/**
 * End-to-end check of the Google Workspace connection.
 *
 *   node scripts/verify-google-auth.mjs
 *
 * Walks the exact chain the platform uses and reports which link is broken,
 * with the specific fix for that link. Five things have to be true and any one
 * of them failing looks identical from the app, which is why this exists:
 *
 *   1. gcloud Application Default Credentials exist on this machine
 *   2. they still refresh (not revoked / not session-expired)
 *   3. the IAM Credentials API is on AND you may sign as the service account
 *   4. domain-wide delegation is authorized in the Workspace admin console
 *   5. the scopes actually grant mailbox read access
 *
 * Read-only. Creates nothing, changes nothing.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
]

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m'
const ok = (m) => console.log(`${GREEN}  PASS${OFF}  ${m}`)
const bad = (m) => console.log(`${RED}  FAIL${OFF}  ${m}`)
const info = (m) => console.log(`${DIM}        ${m}${OFF}`)

function fixBlock(lines) {
  console.log(`${YELLOW}\n  How to fix:${OFF}`)
  for (const l of lines) console.log(`    ${l}`)
  console.log()
}

/** Load .env.local without a dependency. */
function loadEnv() {
  const path = join(process.cwd(), '.env.local')
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
      }
    }
  } catch {
    // Fine — the values may already be in the environment.
  }
}

async function main() {
  loadEnv()
  console.log('\n=== Google Workspace connection check ===\n')

  const oauthPath = process.env.GOOGLE_OAUTH_TOKENS_FILE ??
    join(process.env.HOME, 'berwilson-data/google-oauth-tokens.json')
  let oauthStore = null
  try { oauthStore = JSON.parse(readFileSync(oauthPath, 'utf8')) } catch { /* not this mode */ }

  const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const mailboxes = (process.env.GOOGLE_IMPERSONATE_MAILBOXES ??
    'moose@berwilson.com,tuaone@berwilson.com')
    .split(',').map((m) => m.trim()).filter(Boolean)

  // ── Step 0: config ─────────────────────────────────────────────────────────
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    console.log(`${YELLOW}  NOTE${OFF}  GOOGLE_SERVICE_ACCOUNT_KEY_FILE is set — the platform will sign`)
    info('locally with that key and ignore the keyless path this script tests.')
    info('Unset it unless you deliberately have a downloaded key.\n')
  }
  // ── Mode 3: per-mailbox OAuth (no service account, no gcloud) ─────────────
  if (!saEmail && oauthStore) {
    console.log(`  mode: per-mailbox OAuth`)
    info(`tokens: ${oauthPath}`)
    console.log()
    let bad3 = 0
    for (const mailbox of mailboxes) {
      const refresh = oauthStore.tokens?.[mailbox.toLowerCase()]
      if (!refresh) {
        bad(`${mailbox}: no stored consent`)
        bad3++
        continue
      }
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: oauthStore.client.client_id,
          client_secret: oauthStore.client.client_secret,
          refresh_token: refresh,
        }),
      })
      const text = await res.text()
      if (!res.ok) {
        bad(`${mailbox}: consent no longer valid`)
        info(text.slice(0, 200))
        bad3++
        continue
      }
      const token = JSON.parse(text).access_token
      const prof = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/profile`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!prof.ok) {
        bad(`${mailbox}: token issued but Gmail refused it`)
        info((await prof.text()).slice(0, 200))
        bad3++
        continue
      }
      const p = await prof.json()
      ok(`${mailbox}: reading OK — ${p.messagesTotal?.toLocaleString() ?? '?'} messages, ${p.threadsTotal?.toLocaleString() ?? '?'} threads`)
    }
    console.log()
    if (bad3 === 0) {
      console.log(`${GREEN}=== All checks passed ===${OFF}\n`)
      console.log('Next: apply the migration, deploy, then start the backfill —')
      console.log('deploy/google-workspace-setup.md, Part 5.\n')
      process.exit(0)
    }
    fixBlock(['Re-run the consent for the failing mailbox:', '', '  node scripts/setup-google-oauth.mjs'])
    process.exit(1)
  }

  if (!saEmail) {
    bad('no Google auth is configured')
    fixBlock([
      'Simplest path (no gcloud, no service account):',
      '',
      '  node scripts/setup-google-oauth.mjs',
      '',
      'Or, for the service-account path, set in .env.local:',
      '',
      '  GOOGLE_SERVICE_ACCOUNT_EMAIL=...@PROJECT.iam.gserviceaccount.com',
    ])
    process.exit(1)
  }
  console.log(`  mode: service account`)
  ok(`service account: ${saEmail}`)
  info(`mailboxes: ${mailboxes.join(', ')}`)
  console.log()

  // ── Step 1: ADC file present ───────────────────────────────────────────────
  const adcPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    join(process.env.HOME, '.config/gcloud/application_default_credentials.json')
  let adc
  try {
    adc = JSON.parse(readFileSync(adcPath, 'utf8'))
    ok(`found gcloud credentials at ${adcPath}`)
  } catch {
    bad(`no gcloud credentials at ${adcPath}`)
    fixBlock([
      'Run this on THIS machine:',
      '',
      '  gcloud auth application-default login --no-launch-browser',
      '',
      'If gcloud is not installed, run: zsh scripts/setup-google-auth.sh',
    ])
    process.exit(1)
  }

  // ── Step 2: the credential still refreshes ─────────────────────────────────
  let callerToken
  {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: adc.client_id,
        client_secret: adc.client_secret,
        refresh_token: adc.refresh_token,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      bad('the gcloud credential could not be refreshed')
      info(text.slice(0, 300))
      fixBlock([
        'It was revoked, or a Workspace session-length policy expired it.',
        'Re-run:',
        '',
        '  gcloud auth application-default login --no-launch-browser',
      ])
      process.exit(1)
    }
    callerToken = JSON.parse(text).access_token
    ok('gcloud credential is valid')
  }

  // ── Step 3: may we sign as the service account? ────────────────────────────
  const now = Math.floor(Date.now() / 1000)
  async function signFor(mailbox) {
    const payload = {
      iss: saEmail,
      sub: mailbox,
      scope: SCOPES.join(' '),
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }
    const res = await fetch(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(saEmail)}:signJwt`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${callerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: JSON.stringify(payload) }),
      }
    )
    return { res, text: await res.text() }
  }

  {
    const { res, text } = await signFor(mailboxes[0])
    if (!res.ok) {
      bad('Google refused to sign as the service account')
      info(text.slice(0, 300))
      if (text.includes('SERVICE_DISABLED') || text.includes('has not been used in project')) {
        fixBlock([
          'The IAM Service Account Credentials API is off. In the console it is',
          'called "IAM Service Account Credentials API" — there is no API named',
          '"signing". Enable it with:',
          '',
          '  gcloud services enable iamcredentials.googleapis.com',
        ])
      } else if (text.includes('PERMISSION_DENIED')) {
        fixBlock([
          'Your account lacks Token Creator on the service account. Run:',
          '',
          `  gcloud iam service-accounts add-iam-policy-binding ${saEmail} \\`,
          `    --member="user:$(gcloud config get-value account 2>/dev/null || echo YOU@berwilson.com)" \\`,
          '    --role="roles/iam.serviceAccountTokenCreator"',
        ])
      } else if (text.includes('NOT_FOUND')) {
        fixBlock([
          `No service account named ${saEmail} exists, or it is in another project.`,
          'Check GOOGLE_SERVICE_ACCOUNT_EMAIL, then run:',
          '',
          '  gcloud iam service-accounts list',
        ])
      }
      process.exit(1)
    }
    ok('Google will sign on the service account\'s behalf')
  }

  // ── Steps 4 + 5: delegation + real mailbox read, per mailbox ───────────────
  console.log()
  let failures = 0
  for (const mailbox of mailboxes) {
    const { res: signRes, text: signText } = await signFor(mailbox)
    if (!signRes.ok) {
      bad(`${mailbox}: could not sign`)
      info(signText.slice(0, 200))
      failures++
      continue
    }
    const assertion = JSON.parse(signText).signedJwt

    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })
    const tokenText = await tokenRes.text()
    if (!tokenRes.ok) {
      bad(`${mailbox}: delegation rejected`)
      info(tokenText.slice(0, 300))
      failures++
      if (tokenText.includes('unauthorized_client')) {
        fixBlock([
          'Domain-wide delegation is not authorized, or its scopes do not match.',
          'Go to https://admin.google.com/ac/owl → Manage Domain Wide Delegation.',
          '',
          '  Client ID:  111229421328742032282',
          '  Scopes:     ' + SCOPES.join(','),
          '',
          'The scope list is checked as a WHOLE — one missing scope fails all of',
          'them. Changes take up to 15 minutes to take effect.',
        ])
      } else if (tokenText.includes('invalid_grant')) {
        fixBlock([
          `${mailbox} was rejected. Confirm the address exists and is active in`,
          'Workspace, and that this machine\'s clock is accurate.',
        ])
      }
      continue
    }
    const accessToken = JSON.parse(tokenText).access_token

    // Prove real read access rather than trusting the token.
    const profRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/profile`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!profRes.ok) {
      bad(`${mailbox}: token issued but Gmail refused it`)
      info((await profRes.text()).slice(0, 300))
      failures++
      continue
    }
    const profile = await profRes.json()
    ok(`${mailbox}: reading OK — ${profile.messagesTotal?.toLocaleString() ?? '?'} messages, ${profile.threadsTotal?.toLocaleString() ?? '?'} threads`)
  }

  console.log()
  if (failures === 0) {
    const total = '(see per-mailbox thread counts above)'
    console.log(`${GREEN}=== All checks passed ===${OFF}`)
    console.log(`\nThe platform can read both mailboxes. ${total}`)
    console.log('Next: apply the migration, deploy, then start the backfill —')
    console.log('deploy/google-workspace-setup.md, Part 5.\n')
    process.exit(0)
  }
  console.log(`${RED}=== ${failures} mailbox(es) failed ===${OFF}\n`)
  process.exit(1)
}

main().catch((err) => {
  console.error(`\n${RED}Unexpected error:${OFF}`, err?.message ?? err)
  process.exit(1)
})
