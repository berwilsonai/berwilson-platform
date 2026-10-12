/**
 * Messages the platform itself sent, so the sweep does not read them as news.
 *
 * ⚠ THIS IS THE 2026-10-09 SELF-LOOP GUARD, PORTED TO TEXTS BEFORE IT COULD
 * HAPPEN AGAIN. In mail it cost 131 of 481 open commitments: Pepper's morning
 * note began sending as a named sender, walked through a guard keyed on her
 * display name, and the ledger started feeding on its own output — each night's
 * note listing the previous night's harvest.
 *
 * Texting is structurally worse:
 *   - The Studio sends as Richard's own Apple ID, so a text to Eric lands in
 *     the Richard↔Eric conversation, which IMESSAGE_INTERNAL_HANDLES marks
 *     internal and INGESTS unconditionally.
 *   - `is_from_me` cannot tell the two apart. Richard's own real texts are also
 *     from him, and those are exactly what the sweep exists to read.
 *   - There are no Gmail labels and no `From:` header to key on.
 *
 * So the discriminator is the SEND RECORD. `sendText` hashes every outbound
 * body into `pepper_outbound_texts` before the message leaves; this reads those
 * hashes back. Nothing here depends on a name, a prefix or a sentence anybody
 * might later reword — §12: key the guard on what cannot be renamed, including
 * by us.
 *
 * ⚠ MATCHED ON THE HASH ALONE, NOT ON (handle, hash). The handle a message is
 * stored against in chat.db is not reliably the handle it was sent to — a
 * conversation can be keyed by Apple ID, by a differently-formatted number, or
 * by a group. A sha256 of a whole morning note is specific enough on its own,
 * and a guard that misses is the failure this file exists to prevent.
 */

import { bodyHash, normalizeBody } from '@/lib/notify/text'
import { provDb } from '@/lib/provenance/db'

export interface OwnOutboundGuard {
  /** True when this body is something the platform sent. */
  isOurs: (body: string) => boolean
  /** How many send records the guard is holding. For the run's own report. */
  size: number
  /** Stated, never swallowed — a guard that failed to load must be loud. */
  error: string | null
}

/**
 * Load the guard.
 *
 * ⚠ A FAILED LOAD RETURNS AN ERROR, NOT AN EMPTY GUARD. An empty guard looks
 * identical to "we have never sent a text" and would let the loop start on the
 * one morning the database hiccuped. Callers must check `error` and skip
 * ingestion rather than proceed unguarded.
 */
export async function loadOwnOutboundGuard(): Promise<OwnOutboundGuard> {
  const { data, error } = await provDb()
    .from('pepper_outbound_texts')
    .select('body_sha256')
    // Paginated by being bounded: two notes a day for two people is ~1,500 a
    // year, so one page is correct for years — but the cap is explicit because
    // PostgREST truncates at 1000 SILENTLY (§12) and a truncated guard misses.
    .order('sent_at', { ascending: false })
    .limit(5000)

  if (error) {
    return { isOurs: () => false, size: 0, error: error.message }
  }

  const hashes = new Set(
    ((data ?? []) as { body_sha256: string }[]).map((r) => r.body_sha256)
  )

  return {
    isOurs: (body: string) => {
      const clean = normalizeBody(body)
      if (!clean) return false
      return hashes.has(bodyHash(clean))
    },
    size: hashes.size,
    error: null,
  }
}
