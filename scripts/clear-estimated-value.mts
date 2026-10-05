/**
 * Clear `estimated_value` on every project and opportunity, after backing it up.
 *
 *   node --no-deprecation --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/clear-estimated-value.mts              # dry run, prints what it would do
 *   … scripts/clear-estimated-value.mts --confirm       # actually clears it
 *
 * WHY. Richard's instruction: "None of it is accurate. Clear it all out and I
 * will have it recalculate properly using our new calculator." The column held
 * $57.5B across 8 of 14 projects, mixing a plain total project value with a
 * fee-scale job, and no total built on it could be defended.
 *
 * ⚠ A BACKUP IS NOT A BACKUP UNTIL IT HAS BEEN READ BACK, and its filename
 * needs SECONDS or a same-minute retry overwrites the good copy (CLAUDE.md §12,
 * 09-15). This writes the file, re-reads it from disk, parses it, and checks
 * every row against what it just read from the database. Only then does it
 * write. A failure at any point leaves the column untouched.
 *
 * ⚠ AND IT IS RECOVERABLE TWICE OVER. `log_activity()` already logs a change to
 * `projects.value`, so the old figures are in an append-only table as well as
 * in the file this writes.
 *
 * Dry run by default. Nothing destructive happens without --confirm.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { calcDb, calcDbAs } from '@/lib/economics/db'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

const confirm = process.argv.includes('--confirm')
const db = calcDb()

interface Backed {
  table: 'projects' | 'opportunities'
  id: string
  name: string
  estimated_value: number
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`
}

async function read(table: 'projects' | 'opportunities'): Promise<Backed[]> {
  const { data, error } = await db
    .from(table)
    .select('id,name,estimated_value')
    .not('estimated_value', 'is', null)
    .order('estimated_value', { ascending: false })
  // Checked, because a 42703 comes back on `error` with `data` null and an
  // empty backup followed by a successful wipe is the worst outcome here.
  if (error) throw new Error(`Could not read ${table}: ${error.message}`)
  return (data ?? []).map((r) => {
    const row = r as { id: string; name: string; estimated_value: number | string }
    return {
      table,
      id: row.id,
      name: row.name,
      estimated_value: Number(row.estimated_value),
    }
  })
}

console.log(`${BOLD}Clearing estimated_value${OFF}`)
console.log(confirm ? `${YELLOW}  --confirm given: this WILL write${OFF}` : `${DIM}  dry run${OFF}`)

const rows = [...(await read('projects')), ...(await read('opportunities'))]

if (rows.length === 0) {
  console.log(`\n${GREEN}Nothing to clear.${OFF} No project or opportunity carries an estimated_value.`)
  process.exit(0)
}

const total = rows.reduce((sum, r) => sum + r.estimated_value, 0)
console.log(`\n${rows.length} record(s) carry a value, totalling ${money(total)}:\n`)
for (const row of rows) {
  console.log(`  ${money(row.estimated_value).padStart(20)}  ${row.name} ${DIM}(${row.table})${OFF}`)
}

// ── Back it up, and read it back ────────────────────────────────────────────
const dir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(homedir(), 'Backups', 'berwilson')
await mkdir(dir, { recursive: true })

// Seconds in the name: a same-minute retry must not overwrite the good copy.
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
const file = path.join(dir, `estimated-value-${stamp}.json`)
const payload = {
  written_at: new Date().toISOString(),
  reason:
    "Cleared on Richard's instruction so the deal economics calculator recomputes from scratch. Restore by UPDATE ... SET estimated_value = <value> WHERE id = <id>.",
  rows,
}
await writeFile(file, JSON.stringify(payload, null, 2), 'utf8')

const readBack = JSON.parse(await readFile(file, 'utf8')) as typeof payload
if (readBack.rows.length !== rows.length) {
  console.log(`\n${RED}Backup read back with ${readBack.rows.length} rows, expected ${rows.length}. Nothing cleared.${OFF}`)
  process.exit(1)
}
for (const row of rows) {
  const found = readBack.rows.find((r) => r.id === row.id)
  if (!found || found.estimated_value !== row.estimated_value) {
    console.log(`\n${RED}Backup does not match the database for ${row.name}. Nothing cleared.${OFF}`)
    process.exit(1)
  }
}
console.log(`\n${GREEN}✓${OFF} Backup written and read back, all ${rows.length} rows match: ${file}`)

if (!confirm) {
  console.log(
    `\n${DIM}Dry run. Re-run with --confirm to clear the column.${OFF}\n` +
      `${DIM}Every surface that showed this figure now reads pipelineValue(), which falls back` +
      ` to estimated_value while it is still there and labels it "Estimated, unmodelled".${OFF}`
  )
  process.exit(0)
}

// ── Clear ───────────────────────────────────────────────────────────────────
// Through calcDbAs so the activity_log rows name a person rather than "system",
// which matters more here than usual: this is a deliberate bulk erasure.
const actor = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'estimated-value-cutover@berwilson.com',
}
const write = calcDbAs(actor)

for (const table of ['projects', 'opportunities'] as const) {
  const ids = rows.filter((r) => r.table === table).map((r) => r.id)
  if (ids.length === 0) continue
  const { error } = await write.from(table).update({ estimated_value: null }).in('id', ids)
  if (error) {
    console.log(`\n${RED}Clearing ${table} failed: ${error.message}${OFF}`)
    console.log(`${DIM}The backup is intact at ${file}.${OFF}`)
    process.exit(1)
  }
  console.log(`${GREEN}✓${OFF} ${table}: ${ids.length} cleared`)
}

// ── Verify ──────────────────────────────────────────────────────────────────
const after = [...(await read('projects')), ...(await read('opportunities'))]
if (after.length > 0) {
  console.log(`\n${RED}${after.length} record(s) still carry a value.${OFF}`)
  process.exit(1)
}

console.log(
  `\n${GREEN}Done.${OFF} Every project and opportunity now reads "No value set" until an` +
    ` economics model is built and computed.\n${DIM}Restore from ${file} if any of it is wanted back.${OFF}`
)
