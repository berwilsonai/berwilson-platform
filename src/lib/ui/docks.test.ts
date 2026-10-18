import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DOCK_EVENTS, SHORTCUTS, SCOPE_LABELS } from './docks'
import { sourceFiles, scan } from './source-scan'

/**
 * The dock events were four untyped string literals, dispatched from seven call
 * sites and matched by three listeners, with nothing connecting a typo to a
 * failure — a renamed event silently stops opening its dock and `tsc` cannot
 * see it. These assert the contract now holds in both directions.
 */

test('every dispatched dock event is in the registry', () => {
  // The dispatch side goes through `openDock()`, which is typed — so what this
  // really guards is that nobody reintroduces a raw dispatchEvent.
  // ⚠ `CustomEvent` TOO. The first version of this check matched only
  // `new Event(`, and AppHeader's quick-calc button used `new CustomEvent(` —
  // so the one dispatch site that had its own duplicate copy of the event name
  // was the one the check could not see.
  const raw = scan(/dispatchEvent\(new (?:Custom)?Event\(/).filter((h) => !h.file.endsWith('ui/docks.ts'))
  assert.deepEqual(raw.map((h) => `${h.file}:${h.line}`), [], 'use openDock() from @/lib/ui/docks')
})

test('every dock in the registry has something listening for it', () => {
  /*
   * The listening side cannot be typed by a function signature, so it is
   * checked here: a registry entry nobody listens for is a dead dock, and a
   * listener for an event nobody can dispatch is a dock that never opens.
   *
   * ⚠ It matches the event NAME in a file that also calls addEventListener,
   * rather than the literal inside the call — because `QuickCalcDock` quite
   * correctly listens through a typed constant, and a stricter pattern reported
   * its dock as dead.
   */
  for (const event of DOCK_EVENTS) {
    const found = sourceFiles('src', ['.tsx', '.ts']).some((file) => {
      if (file.endsWith('ui/docks.ts') || file.endsWith('.test.ts')) return false
      const src = readFileSync(file, 'utf8')
      return src.includes(`'${event}'`) && src.includes('addEventListener')
    })
    assert.ok(found, `${event} is in DOCK_EVENTS but nothing listens for it`)
  }
})

test('the help lists every global shortcut, including itself', () => {
  // §12: a hand-written enumeration beside a registry drifts. The overlay is
  // generated from SHORTCUTS, so the only thing left to assert is that the
  // registry is complete — including `?`, which an earlier version of this
  // list omitted, leaving the help itself undiscoverable.
  const global = SHORTCUTS.filter((s) => s.scope === 'global').map((s) => s.keys.join(''))
  for (const expected of ['⌘K', '⌘J', '⌘/', '?']) {
    assert.ok(global.includes(expected), `${expected} is not in the shortcuts registry`)
  }
})

test('every shortcut scope has a reader-facing label', () => {
  for (const s of SHORTCUTS) {
    assert.ok(SCOPE_LABELS[s.scope], `scope "${s.scope}" has no label`)
    assert.ok(!SCOPE_LABELS[s.scope].includes('_'), 'a scope label must not read like a key')
  }
})

test('every shortcut that names a dock names a real one', () => {
  for (const s of SHORTCUTS) {
    if (!s.event) continue
    assert.ok((DOCK_EVENTS as readonly string[]).includes(s.event), `${s.label} -> ${s.event}`)
  }
})

test('the overlay is generated, not hand-listed', () => {
  const src = readFileSync('src/components/layout/ShortcutsOverlay.tsx', 'utf8')
  assert.ok(src.includes('SHORTCUTS.filter'), 'the overlay must read the registry')
  // A literal ⌘K in the overlay would mean someone started spelling them out.
  assert.ok(!/<Kbd>⌘<\/Kbd>\s*<Kbd>K<\/Kbd>/.test(src), 'shortcuts are rendered from the registry')
})
