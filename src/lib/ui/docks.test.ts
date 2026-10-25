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
  // `new Event(`, and one of AppHeader's dock buttons used `new CustomEvent(`
  // — so the one dispatch site that had its own duplicate copy of the event
  // name was the one the check could not see.
  //
  // ⚠ THE EXEMPTIONS ARE NAMED AND THEN PROVED, never just excluded. §12: a
  // legitimate exemption gets named with its reason and is never absorbed by
  // loosening the check. Each file below is a TYPED dispatch helper — its event
  // name is an exported const and the only `dispatchEvent` in the codebase for
  // it sits beside that const — which is the discipline this test exists to
  // enforce, not a second way around it. The assertion under the list is what
  // stops this becoming a place to park a raw dispatch.
  const TYPED_DISPATCHERS: { file: string; constName: string; why: string }[] = [
    { file: 'ui/docks.ts', constName: 'DOCK_EVENTS', why: 'openDock() — the docks registry' },
    { file: 'ui/agent-unread.ts', constName: 'AGENT_UNREAD_EVENT', why: 'announceUnreadChanged() — the Ask Ber AI badge' },
  ]

  for (const d of TYPED_DISPATCHERS) {
    const file = sourceFiles('src', ['.ts']).find((f) => f.endsWith(d.file))
    assert.ok(file, `${d.file} is exempted but no longer exists`)
    const src = readFileSync(file, 'utf8')
    assert.match(
      src,
      new RegExp(`export const ${d.constName}\\b`),
      `${d.file} is exempted as a typed dispatcher but does not export ${d.constName} — the exemption is only earned by the name being typed (${d.why})`
    )
  }

  const raw = scan(/dispatchEvent\(new (?:Custom)?Event\(/)
    .filter((h) => !TYPED_DISPATCHERS.some((d) => h.file.endsWith(d.file)))
  assert.deepEqual(
    raw.map((h) => `${h.file}:${h.line}`),
    [],
    'use openDock() from @/lib/ui/docks, or a typed dispatch helper named in TYPED_DISPATCHERS'
  )
})

test('every dock in the registry has something listening for it', () => {
  /*
   * The listening side cannot be typed by a function signature, so it is
   * checked here: a registry entry nobody listens for is a dead dock, and a
   * listener for an event nobody can dispatch is a dock that never opens.
   *
   * ⚠ It matches the event NAME in a file that also calls addEventListener,
   * rather than the literal inside the call — because a dock quite correctly
   * listens through a typed constant, and a stricter pattern reported its dock
   * as dead.
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
  // ⚠ `⌘/` WAS IN THIS LIST AND CAME OUT ON 2026-10-23 with the quick calc it
  // opened. A hardcoded expectation is right here — these are the keys a reader
  // must be able to discover, which is a claim about the product, not a copy of
  // the registry (§12) — but it means removing a feature has to come here too,
  // and this test is what says so rather than leaving a help entry for a dock
  // that no longer exists.
  const global = SHORTCUTS.filter((s) => s.scope === 'global').map((s) => s.keys.join(''))
  for (const expected of ['⌘K', '⌘J', '?']) {
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
