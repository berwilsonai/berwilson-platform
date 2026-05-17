/**
 * scripts/configure-storage.ts
 * Configure Supabase Storage bucket limits.
 *
 * IMPORTANT: Supabase Free plan caps file uploads at 50MB.
 * To handle large construction plans/drawings (100+ page PDFs):
 *   1. Go to https://supabase.com/dashboard → your project → Settings → Billing
 *   2. Upgrade to Pro plan ($25/month)
 *   3. Then run this script: npx tsx scripts/configure-storage.ts
 *
 * After upgrading to Pro, this script sets the bucket limit to 2GB.
 *
 * Run: npx tsx scripts/configure-storage.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) process.env[key] = value
  }
} catch {
  console.error('Could not load .env.local')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const BUCKET_NAME = 'documents'
// 2 GB — covers even massive drawing sets. Increase if needed up to 5GB on Pro.
const TARGET_LIMIT = 2 * 1024 * 1024 * 1024

async function main() {
  // Check current config
  const { data: bucket } = await supabase.storage.getBucket(BUCKET_NAME)
  const currentMB = bucket ? Math.round((bucket.file_size_limit || 0) / 1024 / 1024) : 0
  console.log(`Current bucket "${BUCKET_NAME}" limit: ${currentMB} MB`)

  // Remove MIME type restrictions
  const mimeRes = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET_NAME}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ allowed_mime_types: null }),
  })
  const mimeData = await mimeRes.json()
  if (mimeData.message === 'Successfully updated') {
    console.log('✓ MIME type restrictions removed (all file types allowed)')
  }

  // Try to set the target limit
  const sizeRes = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET_NAME}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'apikey': serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file_size_limit: TARGET_LIMIT }),
  })
  const sizeData = await sizeRes.json()

  if (sizeData.message === 'Successfully updated') {
    console.log(`✓ File size limit set to ${TARGET_LIMIT / 1024 / 1024 / 1024} GB`)
    console.log('\nDone! Large file uploads are now supported.')
  } else if (sizeData.statusCode === '413') {
    console.log(`\n✗ Cannot increase limit — your Supabase plan caps at ${currentMB} MB.`)
    console.log('\nTo fix this:')
    console.log('  1. Go to https://supabase.com/dashboard → your project → Settings → Billing')
    console.log('  2. Upgrade to Pro plan ($25/month)')
    console.log('  3. Run this script again: npx tsx scripts/configure-storage.ts')
    console.log('\nPro plan allows up to 5 GB per file upload.')
    process.exit(1)
  } else {
    console.log('Unexpected response:', sizeData)
    process.exit(1)
  }
}

main()
