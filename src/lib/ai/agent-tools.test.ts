/**
 * The tool roster the model is handed.
 *
 * ⚠ THIS FILE EXISTS BECAUSE A TOOL WAS DUPLICATED AND SHIPPED. On 2026-10-29 a
 * `search_correspondence` was added to `agent-tools.ts` while
 * `agent-tools-modules.ts` had used that name since it was written — for a
 * SEMANTIC search over message bodies and attachment text, which the agent
 * prompt explicitly directs the model to for *"what was actually said, agreed,
 * quoted, required or scheduled"*. `agentTools` spreads both files, so the
 * model received two declarations under one name, and the new case sat EARLIER
 * in the dispatch — so a keyword search silently replaced the semantic one on
 * every agent turn and every job. Typecheck, build and 824 tests were green:
 * nothing in TypeScript objects to two objects in an array sharing a `name`.
 *
 * §12 names the shape — *a fork is hardest to see as two SIBLING MODULES
 * written days apart, because neither looks like a copy; the tell is a second
 * module answering the same question* — and the remedy is to assert the members
 * against each other rather than trust a grep next time.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentTools } from './agent-tools'
import { MODULE_TOOL_NAMES } from './agent-tools-modules'

test('no two tools share a name', () => {
  const seen = new Map<string, number>()
  for (const t of agentTools) seen.set(t.name, (seen.get(t.name) ?? 0) + 1)
  const dupes = [...seen].filter(([, n]) => n > 1).map(([n]) => n)
  assert.deepEqual(dupes, [], `duplicate tool names: ${dupes.join(', ')}`)
})

test('every module tool name is actually in the roster', () => {
  // The dispatch routes by `MODULE_TOOL_NAMES.has(name)`, so a module tool
  // missing from the roster is an executor the model is never told about — the
  // §12 shape where a curated vocabulary only one caller reads is decoration.
  const names = new Set(agentTools.map((t) => t.name))
  const missing = [...MODULE_TOOL_NAMES].filter((n) => !names.has(n))
  assert.deepEqual(missing, [], `declared nowhere: ${missing.join(', ')}`)
})

test('every tool has a name, a description and a parameters object', () => {
  // A tool the model cannot understand is a tool it will not call, and an empty
  // description is invisible in review.
  for (const t of agentTools) {
    assert.ok(t.name && t.name.length > 2, `bad name: ${JSON.stringify(t.name)}`)
    assert.ok(
      typeof t.description === 'string' && t.description.length > 30,
      `${t.name} has no usable description`
    )
    assert.ok(t.parameters && typeof t.parameters === 'object', `${t.name} has no parameters`)
  }
})

test('a tool name is a plain snake_case identifier', () => {
  // The OpenAI-compatible endpoint rejects anything else, and the failure is a
  // whole-request error rather than one bad tool.
  for (const t of agentTools) {
    assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/, `${t.name} is not a usable tool name`)
  }
})
