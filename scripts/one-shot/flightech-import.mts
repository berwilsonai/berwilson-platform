/**
 * Import the Flightech delegation roster into the directory — 233 participants
 * off a biography book Richard was sent (18–22 October 2026).
 *
 * WHAT THIS IS AND IS NOT. It is a human-run import: Richard asked for all 233
 * after being told what they are, so he IS the confirm step §11 requires. The
 * platform still creates no contact on its own; nothing here runs on a schedule
 * and nothing here is reachable from a route.
 *
 * ⚠ THE DOCUMENT CARRIES NO EMAIL ADDRESS AND NO PHONE NUMBER — not one, across
 * all 233. So these rows are a searchable who's-who, not a contact list you can
 * write to, and `email`/`phone` are left NULL rather than guessed at. That also
 * means the directory matcher can only ever match them BY NAME, which is a guess
 * (§12), so an ambiguous name is reported and skipped rather than merged.
 *
 * Every row carries the `flightech-delegation` tag plus its city — the undo
 * handle, exactly as `auto-contact` is for Pepper's rows: they select together
 * and the existing bulk archive reverses the whole import in one press.
 *
 * The bio lands in `relationship_notes` (§4 — the standing "who is this"
 * description, as against the dated `party_notes` feed, which is what we SAID to
 * someone and we have said nothing to these people yet).
 *
 * Headshots come out of the .docx itself — 214 of them — normalised through
 * `sips` and filed in the public `avatars` bucket keyed by the party id, exactly
 * as the manual uploader and the web-research photo finder both do.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *     --env-file=.env.local scripts/one-shot/flightech-import.mts [--apply]
 *
 * Without --apply it reports what it WOULD do and writes nothing.
 * Env: ROSTER_DIR (records.json, titles.json, media/), LIMIT.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createAdminClient } from '@/lib/supabase/admin'
import { matchDirectory } from '@/lib/contacts/directory-match'
import { embedPartyEnrichment } from '@/lib/ai/embeddings'

const execFileAsync = promisify(execFile)

const APPLY = process.argv.includes('--apply')
const DIR = process.env.ROSTER_DIR
if (!DIR) throw new Error('ROSTER_DIR is required')
const LIMIT = Number(process.env.LIMIT) || Infinity

const ROSTER_TAG = 'flightech-delegation'
const DELEGATION = 'Flightech Delegation, 18–22 October 2026'
/** The avatars bucket caps at 2 MB; 512px keeps a headshot far under it. */
const MAX_PX = 512

interface Rec {
  name: string; bio: string; delegation: string; source: string
  image: string | null; photo_note: string | null; photo_dropped: boolean
}
interface Read { title: string | null; company: string | null }

const recs: Rec[] = JSON.parse(readFileSync(`${DIR}/records.json`, 'utf-8'))
const titles: Record<string, Read> = existsSync(`${DIR}/titles.json`)
  ? JSON.parse(readFileSync(`${DIR}/titles.json`, 'utf-8'))
  : {}

/**
 * Attributed to the executive who asked for the import, not to "system".
 * `parties` carries `log_activity()`, so 232 inserts land in the append-only
 * log; a trail whose every row reads "system" answers nothing, which is the
 * only question it was added to answer (§12).
 */
const ACTOR = { id: '81207093-9bad-4ef6-97f1-d926125ed1e8', email: 'moose@berwilson.com' }
const db = createAdminClient(ACTOR)

/**
 * ⚠ THE FUZZY ARM OF `matchDirectory` IS WRONG FOR THIS SOURCE, AND THE COST IS
 * INVERTED — a false match SKIPS a person, so it loses a row silently rather
 * than merging two.
 *
 * Measured on the dry run: 3 fuzzy hits, 2 of them wrong. `Christopher
 * Frankland → Christopher Johnson` and `Kevin Jeremiah O'Shea → Jeremiah`, both
 * decided on a first or middle name alone. (The third, `Ericson Hugh Tua'one →
 * Ericson Tua'one`, is right — Eric is in this delegation.)
 *
 * That arm is calibrated for a door that also carries an email address and an
 * employer to narrow with, and this document carries neither (§12 — when a
 * matcher serves a new KIND of source, enumerate the signals that source can
 * never carry). So the surname rule §12 already states is applied on top:
 * delete punctuation rather than split on it, require the SURNAME whole, and
 * never accept a bare first name.
 */
function nameParts(s: string): string[] {
  // Delete punctuation rather than split on it — `Tua'one` is one token (§12).
  const norm = s.toLowerCase().replace(/[.'’,"-]/g, '').replace(/\s+/g, ' ').trim()
  const drop = /^(jr|sr|ii|iii|iv|phd|md|esq)$/
  return norm.split(' ').filter((w) => w && !drop.test(w))
}

function samePerson(a: string, b: string): boolean {
  const pa = nameParts(a), pb = nameParts(b)
  // A single-token name has no surname to agree with — never a match.
  if (pa.length < 2 || pb.length < 2) return false

  // The surname must agree WHOLE.
  if (pa[pa.length - 1] !== pb[pb.length - 1]) return false

  // ⚠ AND SO MUST THE FIRST NAME, which the first version of this missed and
  // the live run caught: `Pia van Benthem` was skipped as a duplicate of
  // `Klaus van Benthem` — two real people in the same delegation who share a
  // surname. A surname alone is a family, not a person.
  //
  // A first name may be a PREFIX of something longer (`Eric` of `Ericson`) but
  // never a bare prefix of nothing, and three characters is the floor so `J`
  // does not match `James` and `Jennifer` alike (§12).
  const [fa, fb] = [pa[0], pb[0]]
  if (fa === fb) return true
  const [shortName, longName] = fa.length <= fb.length ? [fa, fb] : [fb, fa]
  return shortName.length >= 3 && longName.startsWith(shortName)
}

/** `Atlanta` → `delegation-atlanta`, so a city is selectable on its own. */
const cityTag = (c: string) => `delegation-${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

/** Re-encode a headshot to JPEG under the bucket's ceiling. Never upscaled. */
async function normalize(path: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'bw-roster-'))
  try {
    const out = join(dir, 'out.jpg')
    await execFileAsync('sips', ['-s', 'format', 'jpeg', '-Z', String(MAX_PX), path, '--out', out], { timeout: 30_000 })
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

const report = {
  created: 0, photos: 0, embedded: 0,
  skipped_existing: [] as string[],
  skipped_ambiguous: [] as string[],
  fuzzy_rejected: [] as string[],
  no_title: [] as string[],
  photo_failed: [] as string[],
  failed: [] as string[],
}

let n = 0
for (const r of recs) {
  if (++n > LIMIT) break

  const read = titles[r.name] ?? { title: null, company: null }
  if (!read.title && !read.company) report.no_title.push(r.name)

  // Name is the only key this document gives us, so a match is a guess and an
  // ambiguous one must mean NO match (§12). Reported, never merged.
  const match = await matchDirectory(null, r.name, read.company)

  // ⚠ AN AMBIGUOUS VERDICT IS ONLY AMBIGUOUS AMONG CANDIDATES THAT COULD BE
  // THIS PERSON. `Mark William McCoy` came back ambiguous between `Mark
  // William Van Leuven` and `Marc William Haddle` — three different people who
  // share a MIDDLE name. Filtering the candidates by the name rule first turns
  // a refusal into the correct answer, which is that he is somebody new.
  if (match.ambiguous) {
    const real = match.candidates.filter((c) => samePerson(r.name, c.full_name))
    if (real.length > 0) {
      report.skipped_ambiguous.push(`${r.name} → ${real.map((c) => c.full_name).join(' / ')}`)
      continue
    }
    report.fuzzy_rejected.push(
      `${r.name} ≠ ${match.candidates.map((c) => c.full_name).join(' / ')} — a different person, imported`
    )
  } else if (match.existing_party_id) {
    const trusted =
      match.match_type !== 'fuzzy_name' ||
      samePerson(r.name, match.existing_party_name ?? '')
    if (trusted) {
      report.skipped_existing.push(`${r.name} → ${match.existing_party_name} (${match.match_type})`)
      continue
    }
    report.fuzzy_rejected.push(`${r.name} ≠ ${match.existing_party_name} — a different person, imported`)
  }

  const provenance = [
    r.bio,
    '',
    `— ${DELEGATION}. ${r.delegation} delegation. Imported from the participant biography book; `
      + `no email address or phone number was given for anyone in it.`,
  ].join('\n')

  if (!APPLY) { report.created++; if (r.image) report.photos++; continue }

  const { data: party, error } = await db
    .from('parties')
    .insert({
      full_name: r.name,
      title: read.title,
      company: read.company,
      relationship_notes: provenance,
      is_organization: false,
      status: 'active',
      tags: [ROSTER_TAG, cityTag(r.delegation)],
    })
    .select('id')
    .single()

  if (error || !party) {
    report.failed.push(`${r.name}: ${error?.message ?? 'no row returned'}`)
    continue
  }
  report.created++

  if (r.image) {
    const src = join(DIR, 'bio_x/word/media', r.image)
    try {
      const bytes = await normalize(src)
      const { error: upErr } = await db.storage
        .from('avatars')
        .upload(party.id, bytes, { upsert: true, contentType: 'image/jpeg' })
      if (upErr) throw new Error(upErr.message)
      const { data: pub } = db.storage.from('avatars').getPublicUrl(party.id)
      await db.from('parties').update({ avatar_url: `${pub.publicUrl}?t=${Date.now()}` }).eq('id', party.id)
      report.photos++
    } catch (err) {
      report.photo_failed.push(`${r.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (process.env.SKIP_EMBED !== '1') {
    await embedPartyEnrichment(party.id)
    report.embedded++
  }

  if (report.created % 20 === 0) console.log(`  ${report.created} created…`)
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN — nothing written'}`)
console.log(`  created            ${report.created}`)
console.log(`  headshots filed    ${report.photos}`)
console.log(`  indexed for Ber AI ${report.embedded}`)
console.log(`  already in rolodex ${report.skipped_existing.length}`)
console.log(`  ambiguous name     ${report.skipped_ambiguous.length}`)
console.log(`  fuzzy hit rejected ${report.fuzzy_rejected.length}`)
console.log(`  no title/company   ${report.no_title.length}`)
console.log(`  photo failed       ${report.photo_failed.length}`)
console.log(`  insert failed      ${report.failed.length}`)
for (const [label, rows] of [
  ['ALREADY IN THE ROLODEX', report.skipped_existing],
  ['AMBIGUOUS — NOT IMPORTED', report.skipped_ambiguous],
  ['FUZZY HIT REJECTED ON SURNAME', report.fuzzy_rejected],
  ['NO TITLE OR COMPANY READ', report.no_title],
  ['PHOTO FAILED', report.photo_failed],
  ['INSERT FAILED', report.failed],
] as const) {
  if (rows.length) console.log(`\n${label}:\n` + rows.map((s) => `  ${s}`).join('\n'))
}
