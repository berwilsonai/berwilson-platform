import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Saved views — a named filter set on a list page.
 *
 * ⚠ READ THE MIGRATION HEADER BEFORE CHANGING ANYTHING HERE
 * (`20261028000002_saved_views.sql`). A saved view was refused once, and the
 * reason survives in `url-facets.tsx`: a per-reader filter replayed out of
 * `localStorage` made a bare `/projects` render differently for each executive
 * with no way for a link's sender to know. That objection is about STORAGE.
 * These rows are shared, and choosing one navigates to a URL carrying the
 * whole query — so a pasted link still means one thing to everybody, and a
 * bare `/projects` is still the unfiltered list.
 *
 * ⚠ NOTHING HERE RESOLVES `?view=` INTO FILTERS. The slug rides along as a
 * label so the chip can highlight; the FILTERS are in the URL beside it. That
 * is what keeps a link honest for a reader who cannot see the view — and it
 * means a deleted view degrades to a working link rather than a broken one.
 */
export interface SavedView {
  id: string
  path: string
  name: string
  slug: string
  query: string
  created_by: string | null
}

const SELECT = 'id, path, name, slug, query, created_by'

/** Every saved view for one list page, in reading order. */
export async function listSavedViews(path: string): Promise<SavedView[]> {
  const { data, error } = await createAdminClient()
    .from('saved_views')
    .select(SELECT)
    .eq('path', path)
    .order('name', { ascending: true })
  if (error) {
    // A view list that cannot be read is a missing convenience, never a broken
    // page — the filters themselves are in the URL and do not depend on it.
    console.error('[saved-views] read failed:', error.message)
    return []
  }
  return (data ?? []) as SavedView[]
}

/**
 * A URL-safe slug.
 *
 * ⚠ IT CAN COME BACK EMPTY. A name of only punctuation or non-Latin script
 * reduces to nothing, and an empty slug would collide with the next one and
 * trip the unique constraint in a way that reads as "name already taken".
 * Fall back to a short random suffix instead.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || `view-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Normalise a query string for storage and comparison.
 *
 * ⚠ `view` IS STRIPPED, OR A VIEW WOULD REMEMBER WHICH VIEW IT WAS. Saving
 * while a view is selected would otherwise store `?view=active&…`, and
 * selecting it again would append a second one. Keys are sorted so two identical
 * filter sets entered in a different order compare equal — which is what lets
 * the UI tell "this is the saved view" from "this is something else".
 */
export function normalizeQuery(query: string): string {
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query)
  params.delete('view')
  const pairs = [...params.entries()]
    .filter(([, v]) => v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return new URLSearchParams(pairs).toString()
}

export interface CreateSavedViewInput {
  path: string
  name: string
  query: string
  createdBy?: string | null
}

export type CreateResult =
  | { ok: true; view: SavedView }
  | { ok: false; error: string }

/**
 * Save the current filter set under a name.
 *
 * ⚠ THREE OUTCOMES, NOT TWO. §12: a refusal reported as an absence is how the
 * caller creates the duplicate that guarantees the next refusal. A name
 * already in use on this page is a REFUSAL with a reason, not a silent second
 * row and not a thrown error.
 */
export async function createSavedView(input: CreateSavedViewInput): Promise<CreateResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Give the view a name.' }
  if (name.length > 60) return { ok: false, error: 'That name is too long — 60 characters at most.' }

  const query = normalizeQuery(input.query)
  if (!query) {
    // The unfiltered list already has a name: the page.
    return { ok: false, error: 'Set at least one filter before saving a view.' }
  }

  const { data, error } = await createAdminClient()
    .from('saved_views')
    .insert({ path: input.path, name, slug: slugify(name), query, created_by: input.createdBy ?? null })
    .select(SELECT)
    .single()

  if (error) {
    // 23505 is the (path, slug) unique constraint — a real refusal with a
    // sentence a human can act on, rather than a 500.
    if (error.code === '23505') return { ok: false, error: `A view called “${name}” already exists here.` }
    return { ok: false, error: error.message }
  }
  return { ok: true, view: data as SavedView }
}

/** Remove a saved view. Returns false when the row was not there. */
export async function deleteSavedView(id: string): Promise<boolean> {
  const { error, count } = await createAdminClient()
    .from('saved_views')
    .delete({ count: 'exact' })
    .eq('id', id)
  if (error) {
    console.error('[saved-views] delete failed:', error.message)
    return false
  }
  return (count ?? 0) > 0
}

/** The href a chip points at: the stored filters, plus the slug as a label. */
export function hrefFor(view: SavedView): string {
  const params = new URLSearchParams(view.query)
  params.set('view', view.slug)
  return `${view.path}?${params.toString()}`
}
