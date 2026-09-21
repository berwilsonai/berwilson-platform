import { NextRequest, NextResponse } from 'next/server'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { findFoldersByName, summarizeFolder } from '@/lib/integrations/google-drive'
import { isGoogleConfigured } from '@/lib/integrations/google-workspace'
import { tokenize } from '@/lib/email-sweep/cluster-phase'

/**
 * GET /api/drive/suggest?project_id=<uuid>
 *
 * Candidate Drive folders for one project, best first.
 *
 * WHY THIS SUGGESTS RATHER THAN LINKS. Nine of fifteen projects have no Drive
 * folder, so their documents are invisible to every search in the platform —
 * and the reason they were left unlinked is that folder names are genuinely
 * ambiguous: "Myton" matches five folders, two of which are different real
 * projects. That ambiguity is not a matching problem to be solved harder; it
 * is information only a person has. So this finds the candidates and shows
 * what distinguishes them — the parent path, the file count, the newest file —
 * and the human clicks. The chore was never the decision, it was the hunt.
 *
 * Read-only. Admin-only by default-deny, matching the browse route beside it.
 */
export const maxDuration = 60

interface Candidate {
  id: string
  name: string
  parentName: string | null
  files: number
  newest: string | null
  score: number
  /** Which of the record's names produced this hit. */
  matchedOn: string
}

/** How much of the shorter name the two share — the same asymmetric measure the mail router uses. */
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / Math.min(a.size, b.size)
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer()
  if (!viewer?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!isGoogleConfigured()) {
    return NextResponse.json({ error: 'Google Workspace is not configured.' }, { status: 503 })
  }

  const projectId = request.nextUrl.searchParams.get('project_id')?.trim()
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const { data: project } = await createAdminClient()
    .from('projects')
    .select('name, location, match_aliases')
    .eq('id', projectId)
    .single()

  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // Search terms come from the record's own names, resolved server-side: the
  // aliases are the human's assertion of what this deal is called, which is
  // exactly what a folder is likely to be named.
  const names = [
    project.name ?? '',
    ...(((project as { match_aliases?: string[] | null }).match_aliases ?? []) as string[]),
  ].filter(Boolean)

  // Drive matches whole words, so a full record name ("New Single Family
  // Dwelling for The Hafoka Family") finds nothing while its distinctive words
  // find the folder. Search each meaningful word, longest first.
  const terms = [
    ...new Set(
      names.flatMap((n) => [n, ...[...tokenize(n)]]).filter((t) => t.trim().length >= 4)
    ),
  ].sort((a, b) => b.length - a.length).slice(0, 6)

  const seen = new Map<string, Candidate>()
  for (const term of terms) {
    let hits: Awaited<ReturnType<typeof findFoldersByName>> = []
    try {
      hits = await findFoldersByName(term, { limit: 12 })
    } catch {
      continue // one bad term must not lose the others
    }
    for (const h of hits) {
      if (seen.has(h.id)) continue
      // Score against the record's best-matching name, not the search term, so
      // a folder found by a common word still ranks on how well it fits.
      const folderTokens = tokenize(`${h.parentName ?? ''} ${h.name}`)
      const score = Math.max(...names.map((n) => overlap(tokenize(n), folderTokens)), 0)
      seen.set(h.id, {
        id: h.id,
        name: h.name.trim(),
        parentName: h.parentName?.trim() ?? null,
        files: 0,
        newest: null,
        score,
        matchedOn: term,
      })
    }
  }

  const ranked = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 6)

  // Counts last and only for the shortlist: summarizeFolder walks the tree, so
  // costing one per search hit would make the picker slow for folders nobody
  // is going to choose. An empty folder is usually a sign to go a level deeper,
  // which is why the count is worth the calls for the ones on screen.
  await Promise.all(
    ranked.map(async (c) => {
      const s = await summarizeFolder(c.id)
      c.files = s.files
      c.newest = s.newest
    })
  )

  return NextResponse.json({
    project_name: project.name,
    searched: terms,
    candidates: ranked,
    note:
      ranked.length === 0
        ? 'No folder name matched this project. Browse to it, or paste its URL.'
        : 'Ranked by name similarity. Check the parent path and file count before linking — several projects share a place name.',
  })
}
