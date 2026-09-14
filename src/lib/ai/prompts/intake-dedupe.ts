/**
 * Grouping staged intake proposals that describe the SAME deal.
 *
 * The queue does not propose one record per deal — it proposes one per cluster
 * of correspondence, and a long-running programme generates many. Measured on
 * the real backlog: "Myton" appeared in 8 separate proposals, data centres in 8,
 * GridEdge in 5, West Wendover in 4. Confirming them as they stand would create
 * eight Myton projects.
 *
 * The existing merge check cannot fix this: it compares a proposal against
 * records that ALREADY EXIST, and these deals are not in the CRM yet, so every
 * cluster looks new. This asks the question that one missed — are any of these
 * proposals the same thing as each other?
 *
 * WHY A MODEL AND NOT A NAME MATCH. The real names defeat token similarity in
 * both directions. "Myton Rail" and "Myton Development" are two different live
 * projects that share their only distinctive word, so matching on names merges
 * them. "Uintah Basin Railway & Myton Quantum Data Center" and "CP3 Myton 1"
 * are plausibly one deal and share almost nothing. A place name is not a deal,
 * and only reading the summaries tells you which is which.
 */

export const INTAKE_DEDUPE_PROMPT_VERSION = 'intake-dedupe-1.0'

export interface DedupeGroup {
  /** Ordinals from the input list. A single-member group is normal. */
  members: number[]
  /** What the combined deal should be called. */
  title: string
  /** One sentence naming the shared site, counterparty or scope. */
  reason: string
}

export interface DedupeResult {
  groups: DedupeGroup[]
}

export const INTAKE_DEDUPE_SYSTEM_PROMPT = `You are consolidating a queue of proposed CRM records for Ber Wilson, a vertically integrated construction, development and prefab steel company in Salt Lake City.

Each numbered entry is a proposal to create ONE record, built from one cluster of email. Several entries often describe the same deal from different conversations. Your job is to group the entries that are the same deal, so the company ends up with one record per deal instead of one per email thread.

GROUP entries together only when they are unmistakably the same undertaking. Evidence that they are:
- the same named site or property, AND a compatible scope
- the same counterparty about the same work
- one is plainly a phase, tranche, sub-scope or follow-up of another (financing for it, permitting for it, a schedule for it)

KEEP entries apart when any of these is true — this is the more important half:
- Different sites. Two jobs in the same town are two jobs.
- Different counterparties pursuing different things, even at one location. A rail corridor and a data centre on the same land are separate undertakings unless the correspondence treats them as one deal.
- A shared PLACE NAME and nothing else. A town is not a deal. "Myton Rail" and "Myton Development" are two real, different projects that share their only distinctive word — grouping on that alone is exactly the mistake to avoid.
- Different business lines: a steel supply quote and a development pursuit are not one record even for the same building.

When you are unsure, DO NOT GROUP. A deal left as its own entry costs one extra row in a queue; a wrong merge silently fuses two pursuits into one record and loses one of them, which nobody will notice until it matters.

Every entry must appear in exactly one group. An entry that belongs with nothing else is a group of one — that is the normal case and most groups will look like this.

Give each group a title that names the actual deal, preferring the clearest of the member names over inventing a new one.

Return ONLY JSON:
{"groups":[{"members":[1],"title":"...","reason":"..."},{"members":[4,9,12],"title":"...","reason":"..."}]}`

export interface DedupeEntry {
  ordinal: number
  name: string
  location: string | null
  counterparty: string | null
  summary: string | null
}

export function buildDedupeMessage(entries: DedupeEntry[]): string {
  const lines = entries.map((e) => {
    const bits = [`${e.ordinal}. ${e.name}`]
    if (e.location) bits.push(`   site: ${e.location}`)
    if (e.counterparty) bits.push(`   with: ${e.counterparty}`)
    if (e.summary) bits.push(`   ${e.summary.slice(0, 180)}`)
    return bits.join('\n')
  })
  return `${entries.length} proposed records:\n\n${lines.join('\n\n')}`
}
