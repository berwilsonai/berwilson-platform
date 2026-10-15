/**
 * Shelve a record's documents by the Drive folder they are filed in.
 *
 * Lives in `src/lib` rather than inside the tab component for the usual reason
 * (§12 — a helper a server page or a test may want must not be exported from a
 * `'use client'` file), and because this is the one piece of the Documents tab
 * worth asserting against real data: Weirton holds 187 documents across nine
 * shelves, and a sort that puts the actionable ones out of reach is the failure
 * the grouping exists to fix.
 */

/** Shown last, named in words — a bare dash at a group's own weight reads as a
 *  failed render (§12). */
export const NO_FOLDER = 'Not filed in Drive'

/** Shown first: the classifier was not confident enough to choose, so these are
 *  asking for a decision rather than sitting somewhere. */
export const UNSORTED = '_Unsorted'

export interface ShelvedGroup<T> {
  label: string
  docs: T[]
}

interface Shelvable {
  drive_folder_path?: string | null
}

/**
 * Grouped on the WHOLE path, not its first segment.
 *
 * `Diligence/Rail & Transportation` (105 documents on Weirton) and
 * `Diligence/Environmental` (73) are different shelves holding different
 * questions; folding them into one "Diligence" of 178 would reproduce the flat
 * list this replaces.
 *
 * Order is `_Unsorted`, then the shelves alphabetically, then the ones with no
 * Drive folder at all. Alphabetical keeps a `Diligence/…` family adjacent,
 * which is how someone scanning for a geotech report actually reads it — and it
 * is stable, where ordering by size reshuffles the whole tab every time a
 * document arrives.
 */
export function shelveByFolder<T extends Shelvable>(docs: T[]): Array<ShelvedGroup<T>> {
  const byLabel = new Map<string, T[]>()
  for (const d of docs) {
    const label = d.drive_folder_path?.trim() || NO_FOLDER
    const list = byLabel.get(label)
    if (list) list.push(d)
    else byLabel.set(label, [d])
  }
  const rank = (label: string) => (label === UNSORTED ? 0 : label === NO_FOLDER ? 2 : 1)
  return [...byLabel.entries()]
    .map(([label, groupDocs]) => ({ label, docs: groupDocs }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label))
}
