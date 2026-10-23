/**
 * The global keyboard shortcuts and the docks they open, in one place.
 *
 * ⚠ THESE WERE UNTYPED STRING EVENTS. `window.dispatchEvent(new
 * Event('open-ber-ai'))` in seven call sites, matched by
 * `addEventListener('open-dev-note')` in three listeners, with nothing
 * connecting a typo to a failure: a renamed event silently stops opening its
 * dock, and `tsc` cannot see it because the contract is a string literal.
 * `nav.ts` has done this properly for routes since the beginning; this is the
 * same discipline for the things that are NOT routes.
 *
 * ⚠ AND THE HELP OVERLAY IS GENERATED FROM THIS LIST. There was no shortcuts
 * help at all — ⌘K and ⌘J had a visible hint in the header, and the `/decide`
 * vim keys were documented on `/decide` alone. §12: a hand-written
 * enumeration beside a registry drifts, so a new shortcut added here cannot be
 * missing from the help.
 *
 * In `src/lib` because both server pages and client components read it.
 */

export const DOCK_EVENTS = ['open-ber-ai', 'open-dev-note', 'open-quick-upload'] as const
export type DockEvent = (typeof DOCK_EVENTS)[number]

/**
 * `detail` is the payload a dock may need. Exactly one does today: the command
 * palette hands Ask Ber AI the query already typed, so the reader does not
 * retype it — which is also why this uses `CustomEvent` rather than `Event`.
 *
 * ⚠ AND THAT PAYLOAD IS WHY THE FIRST VERSION OF THE CONVENTION TEST MISSED A
 * SITE: it matched `new Event(` only, and the two dispatches that carried a
 * detail used `new CustomEvent(` — including the one dock that also kept its
 * own duplicate copy of the event name.
 */
export function openDock(event: DockEvent, detail?: { query?: string }): void {
  window.dispatchEvent(detail ? new CustomEvent(event, { detail }) : new Event(event))
}

export interface Shortcut {
  /** As a reader should see it. */
  keys: string[]
  label: string
  /** The dock this opens, when it opens one. */
  event?: DockEvent
  /** Where it works. A page-local set is named so the help can say so. */
  scope: 'global' | 'decide' | 'attention' | 'forms'
}

/**
 * Declaration order is the reading order (§12), so the global keys a reader
 * will actually reach for come first.
 */
export const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘', 'K'], label: 'Command palette — jump to anything', scope: 'global' },
  { keys: ['⌘', 'J'], label: 'Ask Ber AI', event: 'open-ber-ai', scope: 'global' },
  { keys: ['?'], label: 'This list', scope: 'global' },
  { keys: ['⌘', '↵'], label: 'Save a note or submit a form', scope: 'forms' },
  { keys: ['j'], label: 'Move down the list', scope: 'decide' },
  { keys: ['k'], label: 'Move up the list', scope: 'decide' },
  { keys: ['x'], label: 'Select the row', scope: 'decide' },
  { keys: ['shift', 'click'], label: 'Select a range', scope: 'decide' },
  { keys: ['a'], label: 'Accept the selection', scope: 'decide' },
  { keys: ['↵'], label: 'Open the row', scope: 'decide' },
  { keys: ['esc'], label: 'Clear the selection or the filter', scope: 'decide' },
]

export const SCOPE_LABELS: Record<Shortcut['scope'], string> = {
  global: 'Anywhere',
  forms: 'In a form',
  decide: 'On Decide and Attention',
  attention: 'On Attention',
}
