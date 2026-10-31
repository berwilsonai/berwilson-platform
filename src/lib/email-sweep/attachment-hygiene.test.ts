import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  attachmentSkipReason,
  isDeviceGeneratedName,
  isMailChrome,
  isMarketingPicture,
  isNeverADocument,
  SKIP_REASON_NOTE,
  type SkipReason,
} from './attachment-hygiene'
import type { Target } from './route-phase'

/**
 * The attachment door.
 *
 * ⚠ EVERY FIXTURE HERE IS A REAL FILE NAME FROM THE LIVE CORPUS, measured on
 * 2026-10-30 across the 465 unparented `documents` rows. That matters because
 * §12 is repeatedly explicit that a threshold or a filter is measured against
 * the real corpus and never chosen — and because a hygiene rule tested only
 * against invented names is a rule tested against its own author's
 * imagination. The junk below is what actually arrived; the keepers below are
 * what would have been destroyed by a rule one notch looser.
 */

const target = (name: string): Target =>
  ({ kind: 'project', id: `id-${name}`, name } as unknown as Target)

/** The portfolio, near enough: a few real record names. */
const TARGETS: Target[] = [
  target('Steelton'),
  target('Pedro Dome Complex'),
  target('Eagle Mountain'),
  target('GridEdge'),
]

const img = (name: string, size = 60_000) => ({ name, mimeType: 'image/jpeg', size })
const png = (name: string, size = 60_000) => ({ name, mimeType: 'image/png', size })
const pdf = (name: string, size = 400_000) => ({ name, mimeType: 'application/pdf', size })

const orphan = { toOrphanQueue: true, targets: TARGETS }
const onRecord = { toOrphanQueue: false, targets: TARGETS }

// ─── mail chrome ─────────────────────────────────────────────────────────────

test('the mail-client artefacts measured in the corpus are all refused', () => {
  // `image001.png` was already caught; the rest walked past the old pattern
  // because it required `image` to be followed by digits.
  for (const name of [
    'image001.png', 'image002.png', 'image.png', 'icon.png',
    'apple-touch-icon-180x180.png', 'mime-attachment.png', 'favicon.ico',
    'ATT00002.png', 'noname', 'untitled',
  ]) {
    assert.ok(
      isMailChrome(name, 'image/png', 60_000),
      `${name} is mail chrome and should be refused`
    )
  }
})

test('a large file is somebody\'s document whatever it is called', () => {
  // The size bound is what lets a genuine photo left named `image001.png` off
  // a phone still come through.
  assert.equal(isMailChrome('image001.png', 'image/png', 5_000_000), false)
})

test('a PDF named like chrome is still a document', () => {
  // Only images and mail-client blobs. A PDF called image001.pdf is a document.
  assert.equal(isMailChrome('image001.pdf', 'application/pdf', 60_000), false)
})

test('a real file name is never mistaken for chrome', () => {
  for (const name of [
    'Ber Wilson Pedro Dome Complex - Fairbanks.JPG',
    'AVIDIAN MAP.jpeg',
    'freegoldmap.jpg',
    'SPV_Architecture.png',
    'Title Commitment - AS.pdf',
    'Steelton_PSA_Buyer_Redline.docx',
  ]) {
    assert.equal(isMailChrome(name, 'image/jpeg', 60_000), false, `${name} is real`)
  }
})

// ─── never a document ────────────────────────────────────────────────────────

test('the non-documents measured in the corpus are refused', () => {
  for (const name of [
    'smime.p7s',
    'The Art and Science of The Schedule And Going Vertical.pkpass',
    'MG 36% 4YR Chart 6.24.26.webloc',
    'link.url',
    'message.asc',
  ]) {
    assert.ok(isNeverADocument(name), `${name} is not a document`)
  }
})

test('the unreadable-but-real formats are NOT refused', () => {
  /*
    ⚠ THE MOST IMPORTANT ASSERTION IN THIS FILE. §12: a file type with no
    branch is invisible, not unreadable, and nothing reports it — a missing
    pptx branch left two investor decks with no `documents` row at all, then
    `.doc` and `.eml` did it again and hid a Steelton PSA assignment. A drawing
    set is the single most important file on a construction deal and the
    platform cannot read a byte of it. Refusing these at the door would be
    that bug on purpose.
  */
  for (const name of [
    'Steelton Site Plan.dwg',
    'Model.rvt',
    'Bid Package.zip',
    'IMG_2530.HEIC',
    'Lease.pdf',
    'Pricing.xlsx',
  ]) {
    assert.equal(isNeverADocument(name), false, `${name} IS a document`)
  }
})

// ─── device-generated names ──────────────────────────────────────────────────

test('the camera-roll and scanner names from the corpus carry no words', () => {
  for (const name of [
    'IMG_2530.HEIC', 'IMG_5038.JPG', 'IMG_2748.heic',
    '1000005406.jpg', '1000005426.jpg', '67146-1.jpeg', '67174-1.jpeg',
    '02A3C962-.jpg', '18106F83-_2.jpg', '49F668CF-.jpg',
    '20250630_170546.jpg',
    'Image_20260927131449_27_4474.jpg',
    'Screenshot 2026-10-30 at 1.28.26 PM.png',
    'Screenshot 2024-04-12 082156.png',
    'DSC_0001.jpg', 'PXL_20240612_101530.jpg',
    // Found by READING the 16 the first replay let through, not by guessing.
    '1000033270-id-684228ba-62ff-4345-8fde-e02525441ffc.png',
  ]) {
    assert.ok(isDeviceGeneratedName(name), `${name} is device-generated`)
  }
})

test('a named photograph is never called device-generated', () => {
  // All four of the real images in the measured corpus.
  for (const name of [
    'Ber Wilson Pedro Dome Complex - Fairbanks.JPG',
    'AVIDIAN MAP.jpeg',
    'freegoldmap.jpg',
    'SPV_Architecture.png',
    'SPV_Phased_Formation.png',
    'Steelton aerial 2026.jpg',
  ]) {
    assert.equal(isDeviceGeneratedName(name), false, `${name} carries words`)
  }
})

// ─── the picture gate ────────────────────────────────────────────────────────

test('ON A RECORD, every picture still comes through', () => {
  /*
    ⚠ THE ASSERTION THAT PROTECTS THE REAL DILIGENCE.
    `scripts/one-shot/exclude-mail-chrome.mts` records a previous session
    planning to exclude the images and abandoning it on reading them: 15
    scanned 2007 bridge inspection sheets on Weirton, 20 scanned survey plats
    on Helper, the Millard County zoning exhibit, two Alaska claim maps. All of
    those arrive on threads that ARE filed to a record, and all of them have
    device-ish or wordless names. Richard's condition — "unless it is very
    clear what project they belong to" — is already met by the destination.
  */
  for (const f of [
    png('plat.png'),
    img('Survey Plat Sheet 2 of 4.jpg'),
    img('Bridge Inspection 2007.jpg'),
    img('zoning exhibit.png'),
  ]) {
    assert.equal(
      attachmentSkipReason(f, onRecord),
      null,
      `${f.name} is on a record and must come through`
    )
  }
})

test('a DEVICE name is refused even on a record', () => {
  /*
    ⚠ A DELIBERATE WIDENING OF THE FIRST DRAFT, which gated pictures on the
    orphan path only. `IMG_2530.HEIC` on a filed thread is still a `documents`
    row with no text and no summary — and §12 notes that a NULL `ai_summary` is
    a document the agent never opens, which is true on a record as much as off
    one.

    ⚠ IT DOES NOT REACH THE SCANNED DILIGENCE. The 15 Weirton bridge inspection
    sheets and 20 Helper survey plats that `exclude-mail-chrome.mts` warns
    about arrive as multi-page PDFs, and the replay over the whole corpus
    refuses 33 images of which every one is an `IMG_`, a `Screenshot`, a bare
    digit run or a hex blob id.
  */
  for (const f of [img('IMG_2530.HEIC'), img('1000005406.jpg'), img('67146-1.jpeg')]) {
    assert.equal(attachmentSkipReason(f, onRecord), 'device-picture', f.name)
  }
})

test('TO THE ORPHAN QUEUE, a picture that names no record is refused', () => {
  // ⚠ `device-picture`, the SPECIFIC reason — a phone named all three, so
  // nobody could ever have filed them. The looser `unnamed-picture` is for a
  // picture carrying real words that match no record, below.
  for (const f of [img('IMG_2530.HEIC'), img('1000005406.jpg'), img('02A3C962-.jpg')]) {
    assert.equal(attachmentSkipReason(f, orphan), 'device-picture', f.name)
  }
})

test('TO THE ORPHAN QUEUE, a picture that NAMES a record comes through', () => {
  // The whole name, contiguously — `identifiesRecord`, the same bar that gates
  // creating a record from a recording (§11).
  for (const name of [
    'Ber Wilson Pedro Dome Complex - Fairbanks.JPG',
    'Steelton aerial.jpg',
    'GridEdge_site_photo.png',
    'Eagle Mountain parcel.jpeg',
  ]) {
    assert.equal(
      attachmentSkipReason(img(name), orphan),
      null,
      `${name} names a record and must come through`
    )
  }
})

test('a worded picture is KEPT, even when it names no record', () => {
  /*
    ⚠ THIS TEST ASSERTED THE OPPOSITE UNTIL THE RULE WAS MEASURED, and the
    flip is the whole finding. The first gate refused any orphan picture whose
    name did not NAME a record. Replayed over the 419 unparented documents on
    file it refused all 68 images and kept zero — and among the 23 refused on
    the name test alone were `AVIDIAN MAP.jpeg`, `freegoldmap.jpg` and three
    `SPV_*.png` diagrams: real material, gone because the portfolio holds no
    record called Avidian or SPV. §12 says replay every candidate rule over the
    decided corpus and take the LOOSEST that loses nothing, and the name test
    was not it.

    A picture carrying real words reaches the queue, where a human can read
    them. The dispositioning there is one click as of the same day.
  */
  for (const name of [
    'AVIDIAN MAP.jpeg',
    'freegoldmap.jpg',
    'SPV_Architecture.png',
    'SPV_Rights_Flow.png',
    'chart_growth.png',
    'TPSEIBERT-PIC.png',
  ]) {
    assert.equal(
      attachmentSkipReason(img(name), orphan),
      null,
      `${name} carries words and must reach the queue`
    )
  }
})

test('marketing collateral is refused on BOTH paths', () => {
  // The seven measured in the corpus. A vendor's flyer is not evidence about a
  // deal even on a thread filed to one.
  for (const name of [
    'CCR Logo_Transparent_EMAIL.png',
    'ode png logo.png',
    'SBDR Campaign Flyer_ W PROGRAMMING LOGO (1).png',
    'Telarus Summer Heat Sales Incentive Flyer.png',
    'general flyer.png',
    'dashboard_mockup.png',
  ]) {
    assert.ok(isMarketingPicture(name), `${name} is collateral`)
    for (const opts of [orphan, onRecord]) {
      assert.equal(attachmentSkipReason(img(name), opts), 'marketing-picture', name)
    }
  }
})

test('the marketing words match WHOLE words only', () => {
  /*
    §12: a substring hint matches any word that CONTAINS it — `title` inside
    `Entitlements` killed every land/title filing rule. These are the shapes
    that would break an `includes()` version.
  */
  for (const name of [
    'Pickering site survey.jpg',   // contains "pic"
    'Epic Center elevation.png',   // contains "pic"
    'Flyerton Parcel Map.jpg',     // "Flyerton" is not "flyer"
    'Logophile Holdings LOI.jpg',  // "Logophile" is not "logo"
  ]) {
    assert.equal(isMarketingPicture(name), false, `${name} is not collateral`)
  }
})

test('a NON-picture headed for the orphan queue is untouched', () => {
  /*
    ⚠ THE GATE IS ABOUT PICTURES ONLY, and that is Richard's wording: *"I don't
    want individual pictures unless it is very clear what project they belong
    to."* The 250 unparented PDFs and 99 Word documents are the actual unfiled
    backlog — real contracts, title commitments and letters that /jobs exists
    to work through. Refusing those would be destroying the corpus to tidy the
    queue.
  */
  for (const f of [
    pdf('Package.pdf'),
    pdf('Quit Claim Deed.pdf'),
    { name: 'Newman Construction Estimate Breakout 11 -2024.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 80_000 },
  ]) {
    assert.equal(attachmentSkipReason(f, orphan), null, `${f.name} is not a picture`)
  }
})

test('chrome and non-documents are refused on BOTH paths', () => {
  // These two rules are not about the destination — `icon.png` is not evidence
  // about a deal even on a thread filed to one.
  for (const opts of [orphan, onRecord]) {
    assert.equal(attachmentSkipReason(png('icon.png'), opts), 'mail-chrome')
    assert.equal(
      attachmentSkipReason({ name: 'smime.p7s', mimeType: 'application/pkcs7-signature', size: 4_000 }, opts),
      'never-a-document'
    )
  }
})

test('chrome is decided before the picture rule, so the reason is the specific one', () => {
  // `icon.png` is both chrome AND a picture naming no record. The log should
  // say which rule actually applied — §12: count the REASON beside the number.
  assert.equal(attachmentSkipReason(png('icon.png'), orphan), 'mail-chrome')
})

test('the gate no longer depends on the portfolio loading at all', () => {
  /*
    ⚠ A PROPERTY WORTH ASSERTING, because it is what the simplification bought.
    The name-test version called `identifiesRecord` against `loadTargets()`,
    which is allowed to throw — and on a failure every picture would have been
    refused, so a transient database hiccup silently became a corpus-wide
    rejection. §12: make the parameter explicit so a job that forgets gets the
    safe behaviour. The rules that survived read nothing but the file name, so
    there is no failure mode left to get wrong.
  */
  const noTargets = { toOrphanQueue: true, targets: [] as Target[] }
  assert.equal(attachmentSkipReason(img('AVIDIAN MAP.jpeg'), noTargets), null)
  assert.equal(attachmentSkipReason(img('IMG_2530.HEIC'), noTargets), 'device-picture')
  assert.equal(attachmentSkipReason(png('icon.png'), noTargets), 'mail-chrome')
  assert.equal(attachmentSkipReason(pdf('Steelton PSA.pdf'), noTargets), null)
})

test('every reason has a note, and the notes are distinct', () => {
  // §12: an unlabelled count is not a coverage signal. Typed
  // `Record<SkipReason, string>`, so the build names a new reason with no note.
  const reasons: SkipReason[] = ['mail-chrome', 'never-a-document', 'device-picture', 'marketing-picture']
  const notes = reasons.map((r) => SKIP_REASON_NOTE[r])
  for (const [i, n] of notes.entries()) {
    assert.ok(n && n.trim().length > 0, `${reasons[i]} has no note`)
  }
  assert.equal(new Set(notes).size, notes.length, 'two reasons share a note')
})
