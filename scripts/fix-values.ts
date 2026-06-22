/**
 * scripts/fix-values.ts
 * Finds projects with estimated_value > 2,000,000,000 and corrects them
 * by removing extra digits until the value is reasonable (under 2B).
 * Run: npx tsx scripts/fix-values.ts
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* env vars already set externally */ }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function fixValue(value: number): number {
  // Divide by 10 until under 2 billion
  let fixed = value
  while (fixed > 2_000_000_000) {
    fixed = fixed / 10
  }
  return Math.round(fixed * 100) / 100
}

async function main() {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, estimated_value')
    .gt('estimated_value', 2_000_000_000)

  if (error) { console.error('Query error:', error); process.exit(1) }
  if (!projects || projects.length === 0) {
    console.log('No projects found with estimated_value > $2B. Nothing to fix.')
    return
  }

  console.log(`Found ${projects.length} project(s) to fix:\n`)

  for (const p of projects) {
    const original = p.estimated_value as number
    const corrected = fixValue(original)
    console.log(`  ${p.name}`)
    console.log(`    Before: $${original.toLocaleString()}`)
    console.log(`    After:  $${corrected.toLocaleString()}\n`)

    const { error: updateError } = await supabase
      .from('projects')
      .update({ estimated_value: corrected })
      .eq('id', p.id)

    if (updateError) {
      console.error(`  ERROR updating ${p.name}:`, updateError)
    } else {
      console.log(`  ✓ Updated`)
    }
  }

  console.log('\nDone.')
}

main()
