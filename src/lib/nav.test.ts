import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { NAV_ITEMS, NAV_GROUP_ORDER, TITLE_EXTRAS, navItemActive, pageTitle } from './nav'

/**
 * `nav.ts` carries two ⚠ comments warning that `navItemActive` is per-item with
 * NO dedupe, so an item claiming a path that already belongs to another lights
 * two sidebar rows at once — and the reader believes the highlighted one, which
 * made a real destination read as a sub-view of the wrong queue. A comment does
 * not stop the next person; this does.
 */

const paths = () => {
  const out: string[] = []
  for (const i of NAV_ITEMS) {
    out.push(i.href)
    for (const a of i.alsoMatches ?? []) out.push(a)
  }
  return out
}

test('no path lights two nav rows', () => {
  for (const path of paths()) {
    const lit = NAV_ITEMS.filter((i) => navItemActive(i, path)).map((i) => i.label)
    assert.equal(lit.length, 1, `"${path}" lights ${lit.length} rows: ${lit.join(', ')}`)
  }
})

test('no two items declare the same href, and alsoMatches never duplicates an href', () => {
  const hrefs = NAV_ITEMS.map((i) => i.href)
  assert.equal(new Set(hrefs).size, hrefs.length, 'duplicate href')
  // §12: `alsoMatches` may only name paths with no nav item of their own.
  for (const i of NAV_ITEMS) {
    for (const a of i.alsoMatches ?? []) {
      assert.ok(!hrefs.includes(a), `${i.label} alsoMatches ${a}, which is its own nav item`)
    }
  }
})

test('every nav destination is a real route', () => {
  // A nav row pointing nowhere is a dead end a reader finds by clicking.
  for (const i of NAV_ITEMS) {
    const dir = 'src/app' + i.href
    const ok = [dir, dir.replace(/\/\[id\](\/|$)/, '/[id]/(detail)$1')].some(
      (d) => existsSync(`${d}/page.tsx`) || existsSync(`${d}/layout.tsx`)
    )
    assert.ok(ok, `${i.label} -> ${i.href} is not a route`)
  }
  for (const e of TITLE_EXTRAS) {
    assert.ok(existsSync(`src/app${e.href}/page.tsx`), `TITLE_EXTRAS names ${e.href}, not a route`)
  }
})

test('every page in the chrome has a title of its own', () => {
  /*
    ⚠ NINE ROUTES READ "Ber Wilson" IN THE HEADER, measured 2026-10-27 — the
    /company nav LABEL, standing in for a locator while the reader was on
    /review, /documents/unfiled, /proposals/intake, /settings/contact-roles or
    one of the four governance registers. Two causes, both now fixed:
    `pageTitle` never read `alsoMatches` though `navItemActive` always had, and
    its fallback was a real destination's name.

    `navItemActive` is already proved against a dead route above; this is the
    same proof for the OTHER half of the chrome. A page whose locator says
    "Not found" is a page somebody forgot to add to `TITLE_EXTRAS`.
  */
  const routes: string[] = []
  const walk = (dir: string, href: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      // Dynamic segments carry a record's own name in the header, and a route
      // group is a layout device with no URL of its own.
      if (entry.startsWith('[')) continue
      const next = entry.startsWith('(') && entry.endsWith(')') ? href : `${href}/${entry}`
      if (existsSync(join(full, 'page.tsx'))) routes.push(next)
      walk(full, next)
    }
  }
  walk('src/app', '')

  // Outside the app shell on purpose: no sidebar, no header, no locator.
  const UNCHROMED = /^\/(?:api|login|auth|s)(?:\/|$)|\/print$/

  const untitled = routes.filter((r) => !UNCHROMED.test(r) && pageTitle(r) === 'Not found')
  assert.deepEqual(untitled, [], 'add these to TITLE_EXTRAS — the header has nothing to call them')
  assert.ok(routes.length > 40, `expected the whole app, walked ${routes.length}`)
  // The fallback must stay reachable, or the assertion above is vacuous.
  assert.equal(pageTitle('/no-such-page'), 'Not found')
})

test('every group is labelled, and every item is in a declared group', () => {
  // ⚠ `primary` was 13 UNLABELLED rows mixing triage, records, two business
  // units, a strategy board and a map. An unlabelled block only reads while it
  // is short.
  const declared = new Set(NAV_GROUP_ORDER.map((g) => g.group))
  for (const g of NAV_GROUP_ORDER) {
    assert.ok(g.label && g.label.length > 2, `group ${g.group} has no label`)
  }
  for (const i of NAV_ITEMS) {
    assert.ok(declared.has(i.group), `${i.label} is in group "${i.group}", which is not in NAV_GROUP_ORDER`)
  }
})

test('no visible group is longer than seven rows', () => {
  // The limit this split exists to respect. `system` is exempt: it is behind
  // the gear at the bottom, not in the scannable list.
  for (const g of NAV_GROUP_ORDER) {
    if (g.group === 'system') continue
    const n = NAV_ITEMS.filter((i) => i.group === g.group).length
    assert.ok(n <= 7, `${g.label} has ${n} rows`)
  }
})

test('the mobile tab bar holds exactly five, because that is what fits', () => {
  const mobile = NAV_ITEMS.filter((i) => i.mobilePrimary)
  assert.equal(mobile.length, 5, mobile.map((i) => i.label).join(', '))
})
