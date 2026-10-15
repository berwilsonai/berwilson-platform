/**
 * A document names its own deal, even when the thread that carried it named three.
 *
 * This is the guard that stopped the attachment fan-out: a thread filed onto
 * Steelton, Weirton AND Riverdale — correctly, by a human, at certainty
 * 'linked' — used to copy every attachment onto all three records. Measured
 * 2026-10-14: 16 files became 41 document rows, so the Steelton PSA and the
 * Dynegy power attestation sat on two deals they have nothing to do with.
 *
 * The three cases below are the whole contract, and the THIRD is the one most
 * likely to be "fixed" into a bug: a package named for every site genuinely
 * belongs on every site, and reaching for the highest score there is how a
 * shared due-diligence workbook ends up on one deal and missing from two.
 *
 * Run: npm test
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { matchDocument } from '@/lib/documents/match'
import type { Target } from '@/lib/email-sweep/route-phase'

function site(id: string, name: string, tokens: string[], aliases: string[]): Target {
  return {
    kind: 'project',
    id,
    name,
    tokens: new Set(tokens),
    counterparty: null,
    location: null,
    solicitationNumber: null,
    contacts: new Set(),
    identifiers: new Map(),
    aliases: aliases.map((label) => ({
      label,
      tokens: new Set(label.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)),
    })),
  }
}

/** The real three, with the aliases a human actually asserted on them. */
const SIBLINGS: Target[] = [
  site('s', 'Steelton — Cleveland-Cliffs (PA)', ['steelton', 'cleveland', 'cliffs', 'pa'], [
    'Steelton',
    'Project Steelton',
    'Cleveland-Cliffs Steelton',
  ]),
  site('w', 'Weirton — Cleveland-Cliffs (WV)', ['weirton', 'cleveland', 'cliffs', 'wv'], [
    'Weirton',
    'Project Weirton',
  ]),
  site('r', 'Riverdale — Cleveland-Cliffs (IL)', ['riverdale', 'cleveland', 'cliffs', 'il'], [
    'Riverdale',
    'Project Riverdale',
  ]),
]

function bare(file_name: string) {
  return { file_name, doc_type: null, drive_folder_path: null, ai_summary: null, extracted_text: null }
}

test('a file naming ONE of the thread\'s deals belongs to that deal alone', () => {
  for (const name of [
    'Dynegy Power Supply Attestation_Project Steelton.pdf',
    'PPL_Power Confirmation Steelton Sept 2026.pdf',
    'PSA Agreement Steelton.pdf',
  ]) {
    const m = matchDocument(bare(name), SIBLINGS)
    assert.ok(m, `${name} should resolve to a single site`)
    assert.equal(m.target.id, 's', `${name} is Steelton's, not Weirton's or Riverdale's`)
  }
})

test('each deal claims its own file when two code names share a thread', () => {
  // "Whiskey - Zorro" is one thread on two Texas deals. Before the guard, all
  // four one-pagers landed on both.
  const two = [
    site('wh', 'Whiskey (TX)', ['whiskey', 'tx'], ['Whiskey', 'Project Whiskey']),
    site('zo', 'Zorro (TX)', ['zorro', 'tx'], ['Zorro', 'Project Zorro']),
  ]
  assert.equal(matchDocument(bare('Whiskey_Site_OnePager_092326.pdf'), two)?.target.id, 'wh')
  assert.equal(matchDocument(bare('Project_Zorro_OnePager_100726.pdf'), two)?.target.id, 'zo')
})

test('a package named for EVERY deal stays on every deal', () => {
  // ⚠ The load-bearing case. Ambiguity means no single owner, and no single
  // owner means the current behaviour — import onto all of them — is kept.
  // A shared workbook belongs on three records; picking the top score here
  // would put it on one and hide it from two.
  const shared = matchDocument(
    bare('Sites-Due Diligence-10.1.2026 (Site DD for Steelton Weirton and Riverdale).xlsx'),
    SIBLINGS
  )
  assert.equal(shared, null, 'three sites named means no single owner')
})

test('a file naming NO deal stays on every deal', () => {
  // The common case, and the safe side: a title commitment names a parcel and
  // an owner, never the deal. Withholding it from the records the thread was
  // filed onto would lose it entirely.
  assert.equal(matchDocument(bare('Assignment Agreement .doc'), SIBLINGS), null)
  assert.equal(matchDocument(bare('362626.0300-SV01-ALTA-20261002-DRAFT.pdf'), SIBLINGS), null)
})

test('no targets means no opinion', () => {
  // A single-record thread, or one whose siblings all point at deleted records,
  // must reach the matcher with an empty set and get null — never a guess.
  assert.equal(matchDocument(bare('PSA Agreement Steelton.pdf'), []), null)
})
