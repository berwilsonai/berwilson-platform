/**
 * Turn an answer's tool calls into citations a reader can click.
 *
 * ⚠ THE DATA WAS ALWAYS THERE AND THE UI THREW IT AWAY. Every stored message
 * carries `toolCalls: { name, args }[]`, and the chat rendered
 * `Data sources: query project data, search documents` — the tool NAMES, joined
 * with commas, with the args discarded. So an answer about Steelton's lease
 * could not be checked against the record it came from: no link, no document
 * name, no sign of WHICH project was read. For a tool whose whole promise is
 * grounded answers, an uncheckable citation is the weakest part of it.
 *
 * Pure and in src/lib so the mapping is testable: a citation that links to the
 * wrong record is worse than none, and §12 is explicit that only destinations
 * which exist may be offered.
 */

/** Argument keys that name a routable record, in the order they are preferred. */
const ROUTES: { key: string; path: (id: string) => string }[] = [
  { key: 'project_id', path: (id) => `/projects/${id}` },
  { key: 'opportunity_id', path: (id) => `/opportunities/${id}` },
  { key: 'investor_id', path: (id) => `/investors/${id}` },
  { key: 'party_id', path: (id) => `/contacts/${id}` },
]

/**
 * `record_kind` + `record_id` is the polymorphic pair several tools take.
 * ⚠ The KIND decides the route, never the id's shape — §12: a new record type
 * is a destination for the human, and carrying the kind the match came from is
 * what stops an opportunity's uuid being sent to the projects branch.
 */
const KIND_PATH: Record<string, (id: string) => string> = {
  project: (id) => `/projects/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Args that are worth showing a reader because they say what was looked for. */
const TERM_KEYS = ['query', 'find', 'name']

export interface Citation {
  /** The tool, humanised: `search_documents` -> `search documents`. */
  tool: string
  /** The search term or record hint, if the call carried one. */
  term: string | null
  /** An internal path, when the call named a record that has a page. */
  href: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

export function citationFor(name: string, args: Record<string, unknown>): Citation {
  let href: string | null = null

  for (const r of ROUTES) {
    const id = str(args[r.key])
    if (id && UUID.test(id)) {
      href = r.path(id)
      break
    }
  }

  if (!href) {
    const kind = str(args.record_kind)
    const id = str(args.record_id)
    if (kind && id && UUID.test(id) && KIND_PATH[kind]) href = KIND_PATH[kind](id)
  }

  let term: string | null = null
  for (const k of TERM_KEYS) {
    const v = str(args[k])
    // A uuid is not a term — it is the id already covered above, and printing
    // it at a reader is noise.
    if (v && !UUID.test(v)) {
      term = v.length > 48 ? `${v.slice(0, 47)}…` : v
      break
    }
  }

  return { tool: name.replace(/_/g, ' '), term, href }
}

/**
 * Citations for a whole answer, deduplicated.
 *
 * An agent turn routinely calls the same tool several times — twelve rounds are
 * allowed — so the raw list repeats. Dedupe on what a reader would SEE, because
 * two identical chips are a worse citation than one.
 */
export function citationsFor(
  calls: Array<{ name: string; args: Record<string, unknown> }> | undefined
): Citation[] {
  if (!calls?.length) return []
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const c of calls) {
    const cite = citationFor(c.name, c.args ?? {})
    const key = `${cite.tool}|${cite.term ?? ''}|${cite.href ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cite)
  }
  return out
}
