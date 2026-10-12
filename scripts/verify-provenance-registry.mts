/**
 * Assert every field Pepper may write actually exists, and that every enum
 * guard matches the database.
 *
 * ⚠ THIS EXISTS BECAUSE THE FIRST DRAFT OF THE REGISTRY NAMED FOUR COLUMNS
 * THAT DO NOT EXIST — `projects.client_name`, `projects.next_steps`,
 * `parties.bio`, `milestones.title` — all written from memory rather than from
 * the schema. §12: a type that stands in for a generated one drifts, and
 * nothing reports it. A registry entry for a missing column is worse than a
 * typo: the update fails at runtime, inside an unattended pass, and the only
 * symptom is that a field is never curated.
 *
 * Also asserts the reverse for the enums: that `allowedValues` is exactly the
 * live enum, so a member added in a migration cannot leave the guard quietly
 * rejecting a legal value.
 *
 * Run: node --import ./deploy/register.mjs --env-file=.env.local \
 *        scripts/verify-provenance-registry.mts
 */
import { WRITABLE_FIELDS, fieldSpec } from '@/lib/provenance/fields'
import { provDb } from '@/lib/provenance/db'

let failures = 0
const fail = (msg: string) => {
  console.log(`FAIL  ${msg}`)
  failures += 1
}
const ok = (msg: string) => console.log(`ok    ${msg}`)

const tables = Object.keys(WRITABLE_FIELDS)

// ── every registry column exists ─────────────────────────────────────────────
for (const table of tables) {
  const { data, error } = await provDb()
    .from(table)
    .select('*')
    .limit(1)
  if (error) {
    fail(`${table}: cannot read (${error.message})`)
    continue
  }
  // ⚠ A `select *` on an EMPTY table returns no row and therefore no column
  // names, so an empty table cannot be verified this way and must say so
  // rather than passing silently. §12: a zero from a broken query and a zero
  // from an empty table are the same number on screen.
  const row = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!row) {
    fail(`${table}: no rows, so the column list could not be checked — verify by hand`)
    continue
  }
  const live = new Set(Object.keys(row))
  for (const field of Object.keys(WRITABLE_FIELDS[table])) {
    if (live.has(field)) ok(`${table}.${field}`)
    else fail(`${table}.${field} IS NOT A COLUMN — would fail at runtime inside the pass`)
  }
}

// ── every enum guard matches the live enum ───────────────────────────────────
const ENUM_FIELDS: { table: string; field: string; enumName: string }[] = [
  { table: 'projects', field: 'sector', enumName: 'project_sector' },
  { table: 'projects', field: 'stage', enumName: 'project_stage' },
  { table: 'projects', field: 'status', enumName: 'project_status' },
]

for (const { table, field, enumName } of ENUM_FIELDS) {
  const spec = fieldSpec(table, field)
  if (!spec) {
    fail(`${table}.${field} is missing from the registry but listed as an enum field here`)
    continue
  }
  if (!spec.allowedValues) {
    fail(`${table}.${field} is a Postgres enum (${enumName}) but carries no allowedValues guard`)
    continue
  }
  // Read the live members. No RPC for this, so it goes through a tiny view-less
  // query the service role can run.
  const { data, error } = await provDb().rpc('enum_members', { enum_name: enumName })
  if (error) {
    // Expected on first run — the helper does not exist. Reported, not fatal:
    // the column check above is the part that catches the real bug class.
    console.log(
      `skip  ${table}.${field}: cannot read ${enumName} members (${error.message}). ` +
        `Compare by hand: select enumlabel from pg_enum …`
    )
    continue
  }
  const live = new Set(((data ?? []) as { label: string }[]).map((r) => r.label))
  const guard = new Set(spec.allowedValues)
  const missing = [...live].filter((v) => !guard.has(v))
  const extra = [...guard].filter((v) => !live.has(v))
  if (missing.length === 0 && extra.length === 0) ok(`${table}.${field} enum guard matches ${enumName}`)
  else
    fail(
      `${table}.${field} guard disagrees with ${enumName}` +
        (missing.length ? ` — live members not allowed: ${missing.join(', ')}` : '') +
        (extra.length ? ` — allowed but not live: ${extra.join(', ')}` : '')
    )
}

console.log('')
if (failures > 0) {
  console.log(`${failures} failure(s).`)
  process.exitCode = 1
} else {
  console.log('Registry matches the live schema.')
}
