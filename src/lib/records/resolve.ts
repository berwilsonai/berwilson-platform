/**
 * "Which project or opportunity does this name refer to?" — asked in ONE place.
 *
 * This is the record-matching ladder that was written for meeting titles
 * (resolveMeetingTarget, src/lib/meetings/file-notes.ts) and measured there at
 * 20 of 52 named deals resolved, against 5 of 52 for the trigram threshold it
 * replaced. It lives here because it was never a meetings question.
 *
 * ⚠ WHY IT MOVED, which is a §12 rule arriving for the second time. "A shared
 * renderer wired to one surface is worse than no shared renderer." The email
 * intake path was still building its candidate list with
 * `findMatchingProjects`, which
 *   - searched `projects` ONLY, so all 7 opportunities were structurally
 *     unreachable as a merge target (and `resolveMergeTarget` had been reading
 *     an `opportunity_name` field nothing ever produced — dead code), and
 *   - matched names by trigram at threshold 0.3, the exact cliff §12 documents,
 *     where "Steelton Site" scores 0.290 and fails while "Riverdale Site"
 *     scores 0.303 and passes.
 * The pre-decide model can only propose `merge` against the closed list it is
 * shown, so it proposed `create` instead: measured 2026-10-16, 110 of 126
 * pending sessions said create at 0.93 average confidence, while titles like
 * "Steelton Letter-PPL", "Helper Data Center & Community Development" and
 * "WES / GridEdge Modular Data Center Partnership" each name a live record.
 * Accepting that queue would have created ~105 projects against a register of
 * 19 — which is why the confident-block button had never once been pressed.
 *
 * TWO BARS, AND THE GAP BETWEEN THEM IS THE DESIGN. An automatic action and a
 * human-confirmed suggestion cannot share one threshold (§12):
 *
 *   1. An EXACT record name, case-insensitive, unique across BOTH tables. A
 *      name a person typed deserves an exact test.
 *   2. A SHARED IDENTITY-BEARING WORD — suggestion only, never filed on. ⚠ A
 *      score cannot do this job and that was measured, not assumed: "Eagle
 *      Mountain Development" matched Myton Development at 0.487 (wrong) while
 *      "Delta, Utah Campus" matched Delta Industrial Campus at 0.390 (right).
 *      The WRONG match scores higher, because the only thing it shares is the
 *      word every fourth project here contains. WHICH word matched is the
 *      signal.
 *
 * Ambiguity at either bar refuses rather than picking, and says which records
 * collided (§12). The caller decides what a refusal means.
 *
 * Callers add their own stronger bar ABOVE this one where they have one — the
 * meetings path tries a title a human has already filed first, because that is
 * a replayed decision rather than a guess.
 */

import { createAdminClient } from '@/lib/supabase/admin'

/** A project or an opportunity, named. */
export interface RecordTarget {
  kind: 'project' | 'opportunity'
  id: string
  name: string
}

export interface RecordResolution {
  /** Strong enough to act on automatically: an exact, unique record name. */
  target: RecordTarget | null
  /** Good enough to pre-tick for a human and never to act on. */
  suggestion: RecordTarget | null
  /** Why nothing was chosen, when that is worth saying out loud. */
  ambiguous: string | null
  /** Which bar decided, so a log can be believed rather than guessed at. */
  via: 'exact_name' | 'suggested' | null
  /**
   * The identity-bearing word(s) a `suggested` match was made on.
   *
   * §12: which word matched is the real signal, and a score throws it away.
   * Empty for every other bar.
   */
  matchedWords?: string[]
}

/** Match names case-insensitively but EXACTLY — no substrings. */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`)
}

/**
 * Words that carry no identity in a Ber Wilson record name.
 *
 * Four live projects are called Heber Development, Myton Development, Tonga
 * Development Project and American Energy Rail Corridor - Community
 * Development, so "Development" is shared vocabulary rather than a name.
 *
 * ⚠ PLACE NAMES ARE DELIBERATELY ABSENT — Myton, Delta, Heber, Tooele, Steelton
 * and Stockton are exactly what distinguishes these records from each other.
 *
 * ⚠ Three other stopword lists exist in this repo (src/lib/security/egress.ts,
 * src/lib/imessage/classify.ts, and the record-name words here). They are NOT
 * duplicates to be merged: each was measured against a different corpus for a
 * different question — what may leave the box, whether a text message names a
 * record, and which word in a name carries identity. §12 is explicit that a
 * noise filter is measured against its own corpus, so merging them would throw
 * away the measurement. The stale claim that analyze-meeting.ts held a twin of
 * THIS list was checked on 2026-10-17 and is not true; it holds no such list.
 */
const GENERIC_NAME_WORDS = new Set([
  'development', 'developments', 'project', 'projects', 'site', 'sites', 'campus',
  'expansion', 'portfolio', 'initiative', 'phase', 'center', 'centre', 'complex',
  'park', 'building', 'buildings', 'construction', 'community', 'corridor',
  'industrial', 'group', 'holdings', 'company', 'the', 'and', 'for', 'llc', 'inc',
  // Calendar vocabulary, which a meeting title carries and a record name does not.
  'meeting', 'call', 'sync', 'review', 'reviews', 'update', 'updates', 'discuss',
  'discussion', 'intro', 'kickoff', 'weekly', 'notes', 'analysis', 'joint',
  'strategic', 'partnership', 'partnerships', 'coordination', 'acquisition',
  'solutions', 'services', 'systems', 'capacity', 'technology',
  // ⚠ INDUSTRY WORDS, AND THE FIRST DRY RUN IS WHY THEY ARE HERE. Without them
  // "Steelton & Riverdale Site Reviews & Power Capacity Analysis" was suggested
  // as "Stockton Power Nexus - ER Hospital & Medevac Airport Tower" — two deals
  // in different states, matched on the word *power*. This is the §12 rule that
  // already governs company domains ("a shared industry word is the one thing an
  // identifier must not be"), and a vertically integrated energy and
  // construction business has a portfolio full of them.
  'power', 'energy', 'mining', 'capital', 'steel', 'rail', 'solar', 'gas',
  'oil', 'grid', 'water', 'land', 'data', 'quantum', 'resilience',
  // ⚠ A COMPASS DIRECTION IS NOT A PLACE, and leaving it in cost three wrong
  // suggestions out of 52 when this resolver was pointed at the deals a call
  // NAMES rather than at its title (10-14). "West Virginia Power Site", "West
  // Virginia Data Center" and "West Virginia Portfolio" each resolved to
  // **West Wendover** — a different state, a different deal — on the word
  // *west* alone, while `virginia` matched nothing. The two records here that
  // carry a direction are both identified by the word beside it (`wendover`,
  // `summit`), so nothing is lost: verified against the live corpus, which has
  // no record distinguished only by a direction.
  'west', 'east', 'north', 'south', 'western', 'eastern', 'northern',
  'southern', 'upper', 'lower', 'new', 'old', 'greenfield', 'brownfield',
  'prospective', 'additional',
  // ⚠ ADDED 2026-10-17, and measured on the real queue rather than guessed at.
  // Pointing this resolver at the 106 pending intake sessions produced 21
  // matches, and reading them found three wrong — all three on a word that
  // QUALIFIES a noun rather than naming a deal, which is the same argument the
  // compass directions above are here for:
  //   'bldg'   "General Stillwell Memorial Army Reserve Center Bldg 1520" was
  //            matched to "DFCM Camp Williams Bldg. 4140 project" — two
  //            different buildings on two different bases. `building` was
  //            already in this list; the ABBREVIATION was not, which is the
  //            whole bug.
  //   'golden' "Golden Rock" and "Golden Dome White Paper Pursuit" (a DoD
  //            programme) both resolved to "Alaska Golden Summit / True North
  //            Gold & Geologic Hydrogen JV". A COLOUR is a qualifier, not an
  //            identity. Verified nothing is lost: that record is still reached
  //            by `alaska`, `summit`, `gold` and `englert`, which is how the
  //            Englert Mining thread still finds it.
  'bldg', 'bldgs', 'golden',
])

/** Identity-bearing words in a name, lowercased. */
export function distinguishingWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w))
  )
}

const NONE: RecordResolution = { target: null, suggestion: null, ambiguous: null, via: null }

/**
 * Resolve one or more candidate name strings to a project or opportunity.
 *
 * Candidates are tried in order and the first that resolves wins, so pass them
 * strongest-first (a title segment before a location, say).
 */
export async function resolveRecordByName(candidates: string[]): Promise<RecordResolution> {
  const supabase = createAdminClient()

  // ── 1. An exact record name ────────────────────────────────────────────────
  for (const name of candidates) {
    const trimmed = name.trim()
    const needle = escapeLike(trimmed)
    if (needle.length < 3) continue // "JV", "Q3" — too thin to act on

    const [projects, opportunities] = await Promise.all([
      supabase.from('projects').select('id, name').ilike('name', needle).limit(5),
      supabase.from('opportunities').select('id, name').ilike('name', needle).limit(5),
    ])

    const hits: RecordTarget[] = [
      ...(projects.data ?? []).map((r) => ({ kind: 'project' as const, id: r.id, name: r.name })),
      ...(opportunities.data ?? []).map((r) => ({
        kind: 'opportunity' as const,
        id: r.id,
        name: r.name,
      })),
    ]

    if (hits.length === 1) {
      return { target: hits[0], suggestion: null, ambiguous: null, via: 'exact_name' }
    }
    if (hits.length > 1) {
      // Say WHICH records collided. "Could not file" with no reason is the kind
      // of silence that let the Meet folder-name bug survive 192 runs.
      return {
        ...NONE,
        ambiguous: `"${trimmed}" matches ${hits.length} records (${hits
          .map((h) => `${h.name} [${h.kind}]`)
          .join(', ')})`,
      }
    }
  }

  // ── 2. A shared identity-bearing word — suggestion only ───────────────────
  //
  // Read whole rather than searched: both tables together are a couple of dozen
  // rows, so one select each is cheaper than a trigram call per candidate and
  // treats projects and opportunities by the same rule. (`match_projects_by_name`
  // exists but has no opportunity twin, and a score is the wrong signal here
  // anyway — see the bars in this file's header.)
  const [allProjects, allOpportunities] = await Promise.all([
    supabase.from('projects').select('id, name').limit(500),
    supabase.from('opportunities').select('id, name').limit(500),
  ])
  const everything: RecordTarget[] = [
    ...(allProjects.data ?? []).map((r) => ({ kind: 'project' as const, id: r.id, name: r.name })),
    ...(allOpportunities.data ?? []).map((r) => ({
      kind: 'opportunity' as const,
      id: r.id,
      name: r.name,
    })),
  ]

  for (const name of candidates) {
    const words = distinguishingWords(name)
    if (words.size === 0) continue
    const shared = new Map<string, string[]>() // record id -> the words it shared
    for (const r of everything) {
      const theirs = distinguishingWords(r.name)
      const common = [...words].filter((w) => theirs.has(w))
      if (common.length) shared.set(r.id, common)
    }
    const hits = everything.filter((r) => shared.has(r.id))
    if (hits.length === 1) {
      return {
        target: null,
        suggestion: hits[0],
        ambiguous: null,
        via: 'suggested',
        // ⚠ CARRIED OUT, because WHICH word matched is the signal and a score
        // hides it (§12). This is what exposed `bldg` and `golden` on the first
        // run over the real queue: a reader seeing "matched on bldg" knows to
        // distrust it, where "0.55" tells them nothing.
        matchedWords: shared.get(hits[0].id) ?? [],
      }
    }
    if (hits.length > 1) {
      return {
        ...NONE,
        ambiguous: `"${name.trim()}" looks like ${hits.length} records (${hits
          .map((h) => h.name)
          .join(', ')})`,
      }
    }
  }

  return NONE
}
