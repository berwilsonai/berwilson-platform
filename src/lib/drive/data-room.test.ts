/**
 * The data room's vocabulary.
 *
 * What is locked here is not the contents of Richard's list but the properties
 * every consumer depends on: one key per section, a real parent on every leaf,
 * a path that parses back to the key it was built from, and a `Record` over
 * every template so a new one cannot be half-wired (§12, 10-29 — the fix for a
 * drifting enumeration is the TYPE, and the test that proves the type bites).
 *
 * The hostile cases in `sectionOf` are the point of the file: one of them
 * (`10.5 MW study`) failed when it was written, which is how the parser came to
 * check membership of the template rather than the shape of a number.
 */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  DATA_CENTER_ROOM,
  DRAFTS_FOLDER,
  ROOM_TEMPLATES,
  UNSORTED_SECTION,
  WORKING_FOLDERS,
  folderName,
  isDraftPath,
  isRoomTemplateKey,
  leafSections,
  roomFolderPaths,
  sectionByKey,
  FOLDER_TO_SECTION,
  SECTION_HINTS,
  foldDecision,
  sectionHintCollisions,
  sectionOf,
  sectionPath,
  type RoomTemplateKey,
} from './data-room'

describe('the template itself', () => {
  test('has a unique key per section', () => {
    const keys = DATA_CENTER_ROOM.map((s) => s.key)
    assert.equal(new Set(keys).size, keys.length)
  })

  test('names a real parent on every leaf', () => {
    const keys = new Set(DATA_CENTER_ROOM.map((s) => s.key))
    for (const s of DATA_CENTER_ROOM) {
      if (s.parent !== null) assert.ok(keys.has(s.parent), `${s.key} → ${s.parent}`)
    }
  })

  test('carries Richard’s three sections and nineteen subfolders', () => {
    // The count is the thing a partner experiences, so it is asserted rather
    // than described. `00.0 — _Unsorted` is ours, not his, and is excluded.
    const parents = DATA_CENTER_ROOM.filter((s) => !s.parent && s.key !== UNSORTED_SECTION)
    const leaves = DATA_CENTER_ROOM.filter((s) => s.parent !== null)
    assert.deepEqual(parents.map((s) => s.key), ['00', '01', '02'])
    assert.equal(leaves.length, 19)
  })

  test('gives every leaf at least one expected document', () => {
    // A section with no `expects` contributes no row to the 00.2 tracker, so it
    // would be a folder the index can never report on.
    for (const s of leafSections()) {
      if (s.key === UNSORTED_SECTION) continue
      assert.ok(s.expects.length > 0, `${s.key} ${s.label}`)
    }
  })

  test('marks only the genuinely optional section optional', () => {
    const optional = DATA_CENTER_ROOM.filter((s) => s.optional).map((s) => s.key)
    // 01.6 is Richard's own "Not Applicable for projects without on-site
    // generation". 00.0 is ours and is empty on a clean room.
    assert.deepEqual(optional.sort(), [UNSORTED_SECTION, '01.6'])
  })

  test('covers every template key, so a new template cannot be half-wired', () => {
    const keys: RoomTemplateKey[] = ['standard', 'data_center']
    for (const k of keys) assert.ok(k in ROOM_TEMPLATES, k)
    assert.deepEqual(Object.keys(ROOM_TEMPLATES).sort(), [...keys].sort())
    assert.equal(isRoomTemplateKey('data_center'), true)
    assert.equal(isRoomTemplateKey('housing'), false)
    assert.equal(isRoomTemplateKey(null), false)
  })
})

describe('folder names', () => {
  test('formats a section the way Drive will hold it', () => {
    assert.equal(folderName(sectionByKey('01.5')!), '01.5 — Utility Power Commitment')
    assert.equal(folderName(sectionByKey('00')!), '00 — Start Here')
  })

  test('nests a leaf under its parent and leaves 00.0 at the root', () => {
    assert.equal(
      sectionPath(sectionByKey('01.5')!),
      '01 — Power & Property/01.5 — Utility Power Commitment'
    )
    assert.equal(sectionPath(sectionByKey(UNSORTED_SECTION)!), '00.0 — _Unsorted')
  })

  test('builds every folder the room needs, parents before children', () => {
    const paths = roomFolderPaths()
    assert.equal(new Set(paths).size, paths.length)
    for (const p of paths) {
      const parent = p.split('/').slice(0, -1).join('/')
      if (parent) assert.ok(paths.indexOf(parent) < paths.indexOf(p), p)
    }
    // 3 parents + 20 leaves + 19×2 status folders + 3 working folders.
    assert.equal(paths.length, 3 + 20 + 38 + WORKING_FOLDERS.length)
    assert.ok(paths.includes('01 — Power & Property/01.5 — Utility Power Commitment/Drafts'))
    assert.ok(paths.includes('Correspondence'))
  })

  test('sorts the data room above the working folders, as Drive will', () => {
    // The whole reason the sections are numbered: Drive sorts by name, so the
    // sort order IS the reading order a partner gets. Asserted rather than
    // asserted-in-a-comment, because an un-numbered working folder sorting
    // between 01 and 02 would put the mail shelf inside the diligence closet.
    const top = [...new Set(roomFolderPaths().map((p) => p.split('/')[0]))]
    const sorted = [...top].sort((a, b) => a.localeCompare(b))
    const firstWorking = sorted.findIndex((n) => (WORKING_FOLDERS as readonly string[]).includes(n))
    const lastNumbered = sorted.reduce((last, n, i) => (/^\d/.test(n) ? i : last), -1)
    assert.ok(lastNumbered < firstWorking, `${lastNumbered} < ${firstWorking}`)
  })
})

describe('sectionOf — the one parser', () => {
  test('reads the key out of a stored path', () => {
    assert.equal(sectionOf('01 — Power & Property/01.5 — Utility Power Commitment'), '01.5')
    assert.equal(sectionOf('00 — Start Here/00.2 — Master Document Index & Outstanding Items'), 
      '00.2'
    )
    assert.equal(sectionOf('00.0 — _Unsorted'), '00.0')
  })

  test('still reads it through a status subfolder', () => {
    assert.equal(sectionOf('01 — Power & Property/01.1 — Site Control & Title/Drafts'), '01.1')
  })

  test('answers null for the folders that are not sections', () => {
    assert.equal(sectionOf('Correspondence'), null)
    assert.equal(sectionOf('Diligence/Rail & Transportation'), null)
    assert.equal(sectionOf('_Unsorted'), null)
    assert.equal(sectionOf(null), null)
    assert.equal(sectionOf(''), null)
  })

  test('cannot be fooled by a human folder name that contains a slash or a number', () => {
    // ⚠ This drive really holds `Fort Polk / Johnson - Design Build Matocc`,
    // and `PQC Giovanni Campus /Utah Land Records /Land Tenure Documents` —
    // both of which split into segments that are not sections.
    assert.equal(sectionOf('Fort Polk / Johnson - Design Build Matocc'), null)
    assert.equal(sectionOf('PQC Giovanni Campus /Utah Land Records /Land Tenure Documents'), null)
    // A year, a phone number and a version are not section keys.
    assert.equal(sectionOf('2026 Budget'), null)
    assert.equal(sectionOf('Rev 01.5 drawings'), null)
    // ⚠ The shape alone matched this one: `10.5` + a space. Caught here, which
    // is why `sectionOf` checks membership of the template rather than the shape.
    assert.equal(sectionOf('10.5 MW study'), null)
    assert.equal(sectionOf('03.1 — Something We Never Declared'), null)
  })

  test('resolves every path the template generates', () => {
    for (const s of leafSections()) {
      assert.equal(sectionOf(sectionPath(s)), s.key, s.key)
    }
  })
})

describe('isDraftPath', () => {
  test('is true only for the Drafts leaf itself', () => {
    assert.equal(isDraftPath(`01 — Power & Property/01.1 — Site Control & Title/${DRAFTS_FOLDER}`), 
      true
    )
    assert.equal(isDraftPath('01 — Power & Property/01.1 — Site Control & Title'), false)
    // A record folder a human named "Drafts something" is not the convention.
    assert.equal(isDraftPath('Draft Agreements'), false)
    assert.equal(isDraftPath(null), false)
  })
})

describe('folding the old scheme in', () => {
  test('no filename token places a document in two sections', () => {
    // ⚠ The mirror of classify.ts's `ambiguousHintRules()`, which exists
    // because a collision there is SILENT — the rule resolves to two
    // candidates, is refused, and the document falls through with nothing
    // reporting it. That cost every land and title rule for eighteen days.
    const collisions = sectionHintCollisions()
    assert.deepEqual(
      collisions,
      [],
      `tokens claimed by two sections: ${collisions
        .map((c) => `${c.token} → ${c.sections.join(' + ')}`)
        .join('; ')}`
    )
  })

  test('every mapping target is a section this template declares', () => {
    const keys = new Set(DATA_CENTER_ROOM.map((s) => s.key))
    const working = new Set<string>(WORKING_FOLDERS)
    for (const [from, to] of Object.entries(FOLDER_TO_SECTION)) {
      if (to === null) continue
      assert.ok(keys.has(to) || working.has(to), `${from} → ${to} is neither a section nor a working folder`)
    }
    for (const rule of SECTION_HINTS) {
      assert.ok(keys.has(rule.section), `hint rule targets unknown section ${rule.section}`)
    }
  })

  test('a file already in a section is left alone, so a second run is a no-op', () => {
    // §12: pair a fill-not-overwrite pass with a script that calls it TWICE and
    // asserts the second run reports nothing.
    const d = foldDecision('ALTA Survey.pdf', '01 — Power & Property/01.1 — Site Control & Title')
    assert.equal(d.target, null)
    assert.match(d.reason, /already/)
    // Including through a status subfolder.
    assert.equal(
      foldDecision('Draft PSA.pdf', '01 — Power & Property/01.1 — Site Control & Title/Drafts')
        .target,
      null
    )
  })

  test('the folder it is in outranks the file name', () => {
    // A human curated the folder; the file name is whatever the counterparty
    // called it. Measured 10-08: an exact-name folder map scored 24% on
    // Steelton and 0–6% on Weirton, so the folder is strong evidence HERE and
    // a weak generalisation — which is why an unmapped folder falls through.
    const d = foldDecision('Phase I ESA.pdf', 'Land & Title')
    assert.equal(d.target, '01.1', 'the folder rule should win over the "phase i" token')
    assert.match(d.reason, /folder rule/)
  })

  test('the working folders keep their place', () => {
    for (const name of WORKING_FOLDERS) {
      const d = foldDecision('anything.pdf', name)
      assert.equal(d.target, null, name)
      assert.match(d.reason, /stays/)
    }
  })

  test('maps the real folders measured on this drive', () => {
    const cases: Array<[string, string]> = [
      ['Diligence/Environmental', '01.3'],
      ['Diligence/Power & Utilities', '01.5'],
      ['Diligence/Rail & Transportation', '01.4'],
      ['Financials', '00.4'],
      ['Insurance & Bonding', '01.8'],
      ['_Unsorted', UNSORTED_SECTION],
      ['Land Legal', '01.1'],
      ['Previous Land Offers', '02.2'],
      ['PQC Giovanni Campus /Utah Land Records /Land Tenure Documents', '01.1'],
      ['Corporate /NDA NC', '00.3'],
    ]
    for (const [from, to] of cases) {
      assert.equal(foldDecision('x.pdf', from).target, to, from)
    }
  })

  test('tolerates the trailing spaces this drive really has', () => {
    // 16 of 233 folders carry one, and `coerce()`-style verbatim comparison is
    // why an invisible character reads as the classifier being wrong.
    assert.equal(foldDecision('x.pdf', '  Land & Title ').target, '01.1')
    assert.equal(foldDecision('x.pdf', 'LAND & TITLE').target, '01.1')
  })

  test('places by file name when the folder is unknown', () => {
    assert.equal(foldDecision('Will-Serve Letter.pdf', 'Some Folder Nobody Mapped').target, '01.5')
    assert.equal(foldDecision('ALTA Survey 2026.pdf', '').target, '01.1')
    assert.equal(foldDecision('Phase I ESA.pdf', '').target, '01.3')
    assert.equal(foldDecision('Term Sheet - Nebius.pdf', '').target, '02.2')
    assert.equal(foldDecision('Certificate of Insurance.pdf', '').target, '01.8')
  })

  test('a short token cannot match inside a longer word', () => {
    // ⚠ The haystack is the file name wrapped in spaces. A bare `psa` would
    // match "Gypsa", a bare `nda` would match "Agenda", a bare `coi` would
    // match "Coil", and a bare `loi` would match "Exploit".
    assert.notEqual(foldDecision('Gypsa Supply.pdf', '').target, '01.1')
    assert.notEqual(foldDecision('Board Agenda.pdf', '').target, '00.3')
    assert.notEqual(foldDecision('Coil Spec.pdf', '').target, '01.8')
  })

  test('parks what no rule places, and says why', () => {
    const loose = foldDecision('Scan_0042.pdf', '')
    assert.equal(loose.target, UNSORTED_SECTION)
    assert.match(loose.reason, /loose in the room root/)

    const unknown = foldDecision('Scan_0042.pdf', 'Stockton Infographics 2')
    assert.equal(unknown.target, UNSORTED_SECTION)
    assert.match(unknown.reason, /no rule for folder/)
  })

  test('02 rules win over the broader 01 and 00 vocabularies', () => {
    // A compute services agreement is also "an agreement"; a GPU purchase
    // order is also a purchase. Order is load-bearing and this is the assertion
    // that keeps it so.
    assert.equal(foldDecision('Compute Services Agreement - TensorIQ.pdf', '').target, '02.3')
    assert.equal(foldDecision('H100 Server Purchase Order.pdf', '').target, '02.6')
    assert.equal(foldDecision('Credit Report - Nebius.pdf', '').target, '02.1')
  })
})

describe('the land and acquisition vocabulary', () => {
  test('places the document class these deals actually arrive by', () => {
    // ⚠ §12 records this gap in classify.ts and it was repeated here: "`lease`
    // and `assignment` were ABSENT, and both are the central document class on
    // a land/power acquisition — Steelton arrives by ASSIGNMENT of an executed
    // PSA". The Riverdale dry run parked `Assignment Agreement .doc`, which is
    // what caught it.
    for (const name of [
      'Assignment Agreement .doc',
      'Ground Lease - Riverdale.pdf',
      'Facility Lease Executed.pdf',
      'Escrow Instructions.pdf',
      'Deposit Receipt 2026-03-01.pdf',
      'Option Agreement - Daves Farms.pdf',
      'Quit Claim Deed.pdf',
      'Nondisturbance Agreement.pdf',
    ]) {
      assert.equal(foldDecision(name, '').target, '01.1', name)
    }
  })

  test('a landlord estoppel is site control, a customer estoppel is a lender right', () => {
    // Ordering, not duplication: 02.7 holds plain `estoppel` and is evaluated
    // first, so the longer phrase has to be listed ahead of it.
    assert.equal(foldDecision('Landlord Estoppel Certificate.pdf', '').target, '01.1')
    assert.equal(foldDecision('Estoppel - TensorIQ.pdf', '').target, '02.7')
  })

  test('refuses the words that genuinely do not say which section', () => {
    // ⚠ Richard's 01.1 expects "Amendments, extensions, deposit receipts" and
    // his 02.3 expects "Amendments, side letters, exhibits". A bare `lease` is
    // equally 02.6's "Equipment financing or lease agreements". Parking these
    // with a reason is the honest answer; guessing would put a compute
    // amendment on the land shelf.
    assert.equal(foldDecision('Amendment No. 2.pdf', '').target, UNSORTED_SECTION)
    assert.equal(foldDecision('Lease.pdf', '').target, UNSORTED_SECTION)
  })
})

describe('a fold target is a section OR a working folder', () => {
  test('every FOLDER_TO_SECTION value is one of the two, or null', () => {
    // ⚠ THE TEST THAT PASSED WHILE THE SCRIPT WAS WRONG. This assertion already
    // allowed a working-folder name as a target — correctly — but the script
    // resolved targets through `sectionByKey` alone, so the five documents
    // mapped `Master Proposal - Land Development` → `Proposals & Bids` were
    // counted "already placed" and never moved. A vocabulary assertion cannot
    // see a missing arm in its CONSUMER; §12: grep every reader of a value set,
    // and walk every member × every action in a test.
    const keys = new Set(DATA_CENTER_ROOM.map((s) => s.key))
    const working = new Set<string>(WORKING_FOLDERS)
    const targets = new Set(
      Object.values(FOLDER_TO_SECTION).filter((v): v is string => v !== null)
    )
    for (const rule of SECTION_HINTS) targets.add(rule.section)

    for (const t of targets) {
      assert.ok(keys.has(t) || working.has(t), `${t} is neither a section nor a working folder`)
    }
    // And at least one target really is a working folder, so the arm the script
    // was missing is exercised rather than merely permitted.
    assert.ok(
      [...targets].some((t) => working.has(t)),
      'no mapping targets a working folder — the second arm is untested'
    )
  })

  test('the working-folder targets are reachable by name, not by section lookup', () => {
    assert.equal(sectionByKey('Proposals & Bids'), null)
    assert.ok((WORKING_FOLDERS as readonly string[]).includes('Proposals & Bids'))
    assert.equal(
      foldDecision('Giovanni_Master_Proposal.docx', 'Master Proposal - Land Development').target,
      'Proposals & Bids'
    )
  })
})
