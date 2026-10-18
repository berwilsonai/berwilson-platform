import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

import { AGENT_SYSTEM_PROMPT } from './agent'

/**
 * Every path the agent prompt offers must be a route that exists.
 *
 * The prompt now tells the model to link the records it names, which means it
 * hands out URLs. §12: only destinations that exist — and a prompt example is
 * training data, so a stale path is a broken link the model will emit with
 * confidence, forever, on every answer that touches that record type.
 *
 * Checked against the filesystem rather than a hand-kept list, because a list
 * beside the router is a second router (§12).
 */
test('every path the agent prompt offers resolves to a route', () => {
  const paths = [...AGENT_SYSTEM_PROMPT.matchAll(/`(\/[a-z/<>-]*)`/g)].map((m) => m[1])
  assert.ok(paths.length >= 8, `expected the prompt to name several paths, found ${paths.length}`)

  for (const p of paths) {
    if (p === '/') continue
    // `<id>` stands for a dynamic segment; the route directory is `[id]`.
    const dir = 'src/app' + p.replace(/<id>/g, '[id]').replace(/\/$/, '')
    // ⚠ A ROUTE GROUP IS INVISIBLE IN THE URL. `/opportunities/[id]` has no
    // page.tsx of its own — its index lives at `[id]/(detail)/page.tsx` — so a
    // check on the literal path reports a real route as missing. There is
    // exactly one route group in this app today, and this is the only place
    // that has to know.
    const ok = [dir, dir.replace(/\/\[id\](\/|$)/, '/[id]/(detail)$1')].some(
      (d) => existsSync(`${d}/page.tsx`) || existsSync(`${d}/layout.tsx`)
    )
    assert.ok(ok, `the agent prompt offers ${p}, which is not a route (looked for ${dir}/page.tsx)`)
  }
})
