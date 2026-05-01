/**
 * scripts/gen-types.ts
 *
 * Generates TypeScript types from your live Supabase schema.
 *
 * Usage:
 *   npm run gen-types
 *
 * Requires SUPABASE_PROJECT_ID in .env.local (or set in the shell).
 * Find your project ID in: Supabase Dashboard → Settings → General → Reference ID
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Load .env.local without a third-party dependency
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/)
    if (!match) continue
    const key = match[1].trim()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvLocal()

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------
const projectId = process.env.SUPABASE_PROJECT_ID
if (!projectId) {
  console.error('\nError: SUPABASE_PROJECT_ID is not set.')
  console.error('Add this line to your .env.local file:')
  console.error('  SUPABASE_PROJECT_ID=your-project-ref-id\n')
  console.error('Find your Reference ID at:')
  console.error('  Supabase Dashboard → Settings → General → Reference ID\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
const outPath = resolve(process.cwd(), 'src/types/database.ts')
console.log(`\nGenerating types from project: ${projectId}`)

try {
  const result = execSync(
    `npx supabase gen types typescript --project-id ${projectId}`,
    { encoding: 'utf-8' }
  )
  writeFileSync(outPath, result, 'utf-8')
  console.log(`✓ Written to src/types/database.ts\n`)
} catch (err) {
  console.error('\nGeneration failed. Common causes:')
  console.error('  · Not logged in — run: npx supabase login')
  console.error('  · Wrong project ID in .env.local')
  console.error('  · No internet connection\n')
  process.exit(1)
}
