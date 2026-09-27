/**
 * Find and file a profile photo for every contact that has none.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/backfill-profile-photos.mts [--dry-run] [--limit N] [--only <name>]
 *
 * Each contact costs one grounded Gemini search plus a handful of HTTP fetches,
 * so the whole directory is a few minutes, not an overnight job. Nothing here
 * touches the local model.
 *
 * Progress is written back after EVERY contact rather than at the end: a deploy
 * is a `launchctl kickstart` and would otherwise lose the whole run (§12). Re-
 * running is therefore free — anything already carrying an avatar is skipped,
 * and `--force` is deliberately not offered, because the one thing worse than
 * no face is silently replacing a face someone chose by hand.
 *
 * A miss is the expected result for a great many people. Measured before this
 * was written: of four real contacts, two had a public headshot and two have no
 * web presence at all. The run prints every miss with the reason so the tally
 * is readable rather than mysterious.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  findProfilePhoto,
  isQuotaExhausted,
  photoProvenance,
  storeProfilePhoto,
  type PhotoCandidate,
} from '@/lib/contacts/profile-photo'
import type { Json } from '@/lib/supabase/types'

/**
 * A short breather between contacts. Gemini answers 503 "high demand" when a
 * backfill hammers it — the finder retries, but pacing the queue means it
 * mostly does not have to.
 */
const PACE_MS = 1500

const argv = process.argv.slice(2)
const DRY_RUN = argv.includes('--dry-run')
const LIMIT = Number(argv[argv.indexOf('--limit') + 1]) || Infinity
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1]?.toLowerCase() : null

const db = createAdminClient()

const { data: parties, error } = await db
  .from('parties')
  .select('id, full_name, company, email, is_organization, avatar_url, enrichment_notes')
  .is('avatar_url', null)
  .order('is_organization', { ascending: false })
  .order('full_name')

if (error) {
  console.error('Could not read parties:', error.message)
  process.exit(1)
}

const queue = (parties ?? [])
  .filter((p) => (ONLY ? p.full_name.toLowerCase().includes(ONLY) : true))
  .slice(0, LIMIT)

console.log(
  `${queue.length} contact${queue.length === 1 ? '' : 's'} without a photo` +
    `${DRY_RUN ? '  [DRY RUN — nothing will be saved]' : ''}\n`
)

const tally = { headshot: 0, logo: 0, none: 0, failed: 0 }
let done = 0
let quotaStrikes = 0

for (const party of queue) {
  if (done > 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS))
  done++
  const label = `[${String(done).padStart(2)}/${queue.length}] ${party.full_name}`

  let candidate: PhotoCandidate | null = null
  let tried: { url: string; outcome: string }[] = []
  let searchError: string | null = null
  try {
    const result = await findProfilePhoto({
      fullName: party.full_name,
      company: party.company,
      email: party.email,
      isOrganization: party.is_organization,
    })
    candidate = result.candidate
    tried = result.tried
    searchError = result.error
  } catch (err) {
    tally.failed++
    console.log(`${label}\n    ERROR ${err instanceof Error ? err.message : String(err)}`)
    continue
  }

  // A daily quota wall means every remaining contact would report "no photo"
  // for a reason that has nothing to do with them. Stop, and say so once.
  if (isQuotaExhausted(searchError)) {
    quotaStrikes++
    console.log(`${label}\n    — skipped (Gemini daily quota reached)`)
    if (quotaStrikes >= 3) {
      console.log(
        `\nSTOPPED at ${done} of ${queue.length}: the Gemini key has hit its free-tier daily ` +
          `limit of 20 requests. Nothing has been lost — every contact still without a photo is ` +
          `simply still in the queue. Re-run tomorrow, or enable billing on the key to finish in one pass.`
      )
      break
    }
    continue
  }

  if (!candidate) {
    tally.none++
    const why = tried.length > 0 ? tried[tried.length - 1].outcome : (searchError ?? 'nothing found on the web')
    console.log(`${label}\n    — no photo (${why})`)
    continue
  }

  if (DRY_RUN) {
    tally[candidate.kind]++
    console.log(`${label}\n    ${candidate.kind.toUpperCase()} ${candidate.width}×${candidate.height} — ${candidate.note}\n    ${candidate.imageUrl}`)
    continue
  }

  try {
    const publicUrl = await storeProfilePhoto(party.id, candidate)
    const notes: Record<string, unknown> = {
      ...((party.enrichment_notes as Record<string, unknown> | null) ?? {}),
      profile_photo: photoProvenance(candidate),
    }
    // Written per contact, not batched: an interrupted run must be resumable.
    const { error: saveError } = await db
      .from('parties')
      .update({ avatar_url: publicUrl, enrichment_notes: notes as Json })
      .eq('id', party.id)
    if (saveError) throw new Error(saveError.message)

    tally[candidate.kind]++
    console.log(`${label}\n    ${candidate.kind === 'logo' ? 'LOGO    ' : 'HEADSHOT'} ${candidate.note}`)
  } catch (err) {
    tally.failed++
    console.log(`${label}\n    SAVE FAILED ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(
  `\nDone. ${tally.headshot} headshot${tally.headshot === 1 ? '' : 's'}, ` +
    `${tally.logo} logo${tally.logo === 1 ? '' : 's'}, ` +
    `${tally.none} with nothing public, ${tally.failed} failed.`
)
