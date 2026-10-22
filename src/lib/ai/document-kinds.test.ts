/**
 * The file types the document pipeline can read.
 *
 * ⚠ These exist because a type with NO BRANCH is invisible rather than
 * unreadable, and nothing reports it (§12). That rule was written when .pptx
 * was found missing and two investor decks had no `documents` row at all; on
 * 2026-10-21 the same hole was measured again for legacy .doc and .eml, with
 * six contract-grade documents behind it — a Steelton PSA assignment, three
 * assignment agreements and the Vistra data-centre base contract.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentKind } from '@/lib/ai/document-pipeline'
import { extractEmlText } from '@/lib/ai/document-text'

test('documentKind reads legacy .doc by mime type and by extension', () => {
  assert.equal(documentKind('application/msword', 'Assignment Agreement .doc'), 'doc')
  assert.equal(documentKind(null, '54724v1 (Assignment and PSA for Steelton).doc'), 'doc')
  assert.equal(documentKind('application/octet-stream', 'contract.DOC'), 'doc')
})

test('documentKind still reads .docx, and never as .doc', () => {
  // ⚠ The ordering guard. `.docx` must be tested first; if the two are ever
  // swapped, mammoth stops being reached and every Word document silently
  // routes to textutil instead.
  assert.equal(documentKind(null, 'BW MNDA (with Non-Circumvention).docx'), 'docx')
  assert.equal(
    documentKind(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'x.docx'
    ),
    'docx'
  )
  assert.notEqual(documentKind(null, 'x.docx'), 'doc')
})

test('documentKind reads a saved email', () => {
  assert.equal(documentKind('message/rfc822', 'thread.eml'), 'eml')
  assert.equal(documentKind(null, 'Re: West Wendover Master Plan.eml'), 'eml')
  assert.equal(documentKind(null, 'note.msg'), 'eml')
})

test('documentKind still answers unsupported for a type with no reader', () => {
  assert.equal(documentKind('application/zip', 'bid-package.zip'), 'unsupported')
})

test('extractEmlText keeps the headers worth citing and the plain-text body', () => {
  const eml = [
    'From: Taylor Englert <englertmining@gmail.com>',
    'To: moose@berwilson.com',
    'Subject: West Wendover Master Plan',
    'Date: Mon, 13 Oct 2026 19:49:00 -0600',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The master plan is complete and ready for council review on 3 November.',
    'Parcel 02-0138-0000 is included at the revised 13.00 acres.',
  ].join('\r\n')
  const out = extractEmlText(new TextEncoder().encode(eml).buffer as ArrayBuffer)
  assert.ok(out, 'expected text')
  assert.match(out, /Subject: West Wendover Master Plan/)
  assert.match(out, /From: Taylor Englert/)
  assert.match(out, /council review on 3 November/)
  assert.match(out, /02-0138-0000/)
})

test('extractEmlText unfolds a wrapped header rather than truncating it', () => {
  const eml = [
    'From: a@b.com',
    'Subject: Ber Wilson / TensorIQ',
    '\tMaster Strategic Partnership Agreement',
    'Content-Type: text/plain',
    '',
    'Signed copy attached for your records, countersigned this morning.',
  ].join('\r\n')
  const out = extractEmlText(new TextEncoder().encode(eml).buffer as ArrayBuffer)
  assert.ok(out)
  assert.match(out, /Subject: Ber Wilson \/ TensorIQ Master Strategic Partnership Agreement/)
})

test('extractEmlText prefers text/plain over text/html in a multipart message', () => {
  const b = 'BOUNDARY123'
  const eml = [
    'From: a@b.com',
    'Subject: Helper appraisal',
    `Content-Type: multipart/alternative; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'The appraised value is $4,200,000 as of 1 October.',
    `--${b}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<html><body><p>The appraised value is $4,200,000 as of 1 October.</p></body></html>',
    `--${b}--`,
  ].join('\r\n')
  const out = extractEmlText(new TextEncoder().encode(eml).buffer as ArrayBuffer)
  assert.ok(out)
  assert.match(out, /appraised value is \$4,200,000/)
  assert.ok(!out.includes('<p>'), 'markup must not reach the index')
})

test('extractEmlText falls back to html, stripped, when there is no plain part', () => {
  const b = 'B2'
  const eml = [
    'From: a@b.com',
    'Subject: Risk analysis',
    `Content-Type: multipart/alternative; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<div>Grid capacity tops out at <b>700&nbsp;MW</b>.</div><div>PPL supports 300 MW today.</div>',
    `--${b}--`,
  ].join('\r\n')
  const out = extractEmlText(new TextEncoder().encode(eml).buffer as ArrayBuffer)
  assert.ok(out)
  assert.match(out, /700 MW/)
  assert.match(out, /PPL supports 300 MW today/)
  assert.ok(!out.includes('<div>'))
})

test('extractEmlText decodes quoted-printable and skips an attachment part', () => {
  const b = 'B3'
  const eml = [
    'From: a@b.com',
    'Subject: Executed terms',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Fee base is =2410.5M per MW, land excluded under Section 8.6.',
    `--${b}`,
    'Content-Type: application/pdf; name="terms.pdf"',
    'Content-Disposition: attachment; filename="terms.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQKJYCAgIAK',
    `--${b}--`,
  ].join('\r\n')
  const out = extractEmlText(new TextEncoder().encode(eml).buffer as ArrayBuffer)
  assert.ok(out)
  assert.match(out, /\$10\.5M per MW/)
  assert.ok(!out.includes('JVBERi0'), 'an attachment is its own documents row, not prose here')
})

test('extractEmlText returns null for something that is not a message', () => {
  assert.equal(extractEmlText(new TextEncoder().encode('not an email').buffer as ArrayBuffer), null)
})

test('extractEmlText recurses into a nested multipart and decodes it', () => {
  // ⚠ THE CASE THAT SHIPPED BROKEN. Real mail is multipart/mixed wrapping a
  // multipart/alternative; a single-level split returned the nested block
  // whole — boundary markers, part headers and raw quoted-printable included —
  // and 342,230 characters of that went into the index looking like success.
  const outer = 'OUTER'
  const inner = 'INNER'
  const eml = [
    'From: Ber Wilson <info@berwilson.com>',
    'Subject: Re: West Wendover Master Plan',
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    '',
    `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    '',
    `--${inner}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    'Here is an executive brief for you and=',
    ' your team, yields =3D impactful returns.',
    `--${inner}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>html twin</p>',
    `--${inner}--`,
    `--${outer}`,
    'Content-Type: application/pdf; name="brief.pdf"',
    'Content-Disposition: attachment; filename="brief.pdf"',
    '',
    'JVBERi0xLjQK',
    `--${outer}--`,
  ].join('\r\n')

  const out = extractEmlText(new TextEncoder().encode(eml).buffer as ArrayBuffer)
  assert.ok(out, 'expected text')
  // Soft line break joined, =3D decoded back to '='.
  assert.match(out, /for you and your team, yields = impactful returns\./)
  assert.ok(!out.includes('=3D'), 'quoted-printable must be decoded')
  assert.ok(!/=\r?\n/.test(out), 'soft line breaks must be joined')
  // The nested structure must not leak into the index as prose.
  assert.ok(!out.includes('Content-Transfer-Encoding'), 'part headers must not leak')
  assert.ok(!out.includes(inner), 'boundary markers must not leak')
  assert.ok(!out.includes('html twin'), 'text/plain wins over its html twin')
  assert.ok(!out.includes('JVBERi0'), 'an attachment is not prose')
})
