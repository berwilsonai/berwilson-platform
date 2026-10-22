/**
 * Markdown → HTML for Drive's converter.
 *
 * The escaping is the reason this is tested rather than eyeballed: the input is
 * model output, which is untrusted text, and it goes into a document shared
 * with people outside the tailnet.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  bodyWithoutTitle,
  markdownToHtml,
  markdownToPlainText,
  titleFromMarkdown,
} from './markdown'

test('the title comes off the first heading', () => {
  assert.equal(
    titleFromMarkdown('# Offer to Purchase — GridEdge\n\nSome body.'),
    'Offer to Purchase — GridEdge'
  )
})

test('no heading means no title, so the caller builds one', () => {
  assert.equal(titleFromMarkdown('Just prose, no heading.'), null)
})

test('the title line is removed from the body it titles', () => {
  const body = bodyWithoutTitle('# A Title\n\n## Section\n\ntext')
  assert.ok(!body.includes('# A Title'))
  assert.match(body, /## Section/)
})

test('MODEL OUTPUT IS ESCAPED BEFORE ANY TAG IS INTRODUCED', () => {
  // The whole security property. A document whose prose contains markup must
  // render those characters as text, not inject them into the Doc.
  const html = markdownToHtml('A clause about <script>alert(1)</script> and A & B.', 'T')
  assert.ok(!html.includes('<script>'), 'a script tag survived escaping')
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /A &amp; B/)
})

test('a title containing markup is escaped too', () => {
  const html = markdownToHtml('body', 'Offer <b>GridEdge</b> & Co')
  assert.ok(!html.includes('<b>GridEdge</b>'))
  assert.match(html, /&lt;b&gt;GridEdge/)
  assert.match(html, /&amp; Co/)
})

test('headings, lists and rules become real HTML', () => {
  const html = markdownToHtml(
    ['## Consideration', '', '- $4.2M at closing', '- Balance deferred', '', '---', '', '1. First', '2. Second'].join('\n'),
    'T'
  )
  // A body `##` steps down to h3: the title is already the document's h1, and
  // two competing h1s read as a failed render.
  assert.match(html, /<h3>Consideration<\/h3>/)
  assert.match(html, /<ul>\n<li>\$4\.2M at closing<\/li>/)
  assert.match(html, /<ol>\n<li>First<\/li>/)
  assert.match(html, /<hr \/>/)
  // Every list that opens must close, or Drive's converter swallows the rest.
  assert.equal((html.match(/<ul>/g) ?? []).length, (html.match(/<\/ul>/g) ?? []).length)
  assert.equal((html.match(/<ol>/g) ?? []).length, (html.match(/<\/ol>/g) ?? []).length)
})

test('bold and italic survive, and a lone asterisk does not become markup', () => {
  const html = markdownToHtml('**Seller** is *Cleveland-Cliffs*, fee 4% * 2 years', 'T')
  assert.match(html, /<strong>Seller<\/strong>/)
  assert.match(html, /<em>Cleveland-Cliffs<\/em>/)
  // The multiplication asterisk must not open an emphasis run that then eats
  // the rest of the paragraph.
  assert.ok(!/<em>[^<]*2 years/.test(html))
})

test('[TO BE AGREED] passes through untouched', () => {
  // The marker the prompt asks for when the corpus does not settle a term. If
  // the renderer mangled it, a gap would stop being visible.
  const html = markdownToHtml('Purchase price: [TO BE AGREED]', 'T')
  assert.match(html, /\[TO BE AGREED\]/)
})

test('the html is a complete document Drive can convert', () => {
  const html = markdownToHtml('body', 'My Title')
  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /<title>My Title<\/title>/)
  assert.match(html, /<h1>My Title<\/h1>/)
  assert.match(html, /<\/body><\/html>$/)
})

test('plain text keeps the words and drops the syntax', () => {
  // This is what lands in `extracted_text`, i.e. what Ber AI would later read.
  // A retrieval hit on `**` helps nobody.
  const text = markdownToPlainText('# Title\n\n## Terms\n\n- **$4.2M** at closing\n\n---\n')
  assert.match(text, /Title/)
  assert.match(text, /• \$4\.2M at closing/)
  assert.ok(!text.includes('**'))
  assert.ok(!text.includes('##'))
})

test('no render leaks undefined, NaN or Infinity into the markup', () => {
  // §12: exercise the render for every input shape and assert no placeholder
  // reaches the output.
  for (const input of ['', '# Only a title', '- a\n- b', '###### deep', '**', '*', '---']) {
    const html = markdownToHtml(input, 'T')
    for (const bad of ['undefined', 'NaN', 'Infinity', '[object Object]']) {
      assert.ok(!html.includes(bad), `${bad} reached the markup for input ${JSON.stringify(input)}`)
    }
  }
})
