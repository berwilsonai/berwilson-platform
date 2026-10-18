/**
 * What the brief/agent renderer accepts, and what it refuses.
 *
 * ⚠ THE NEGATIVE CASES ARE THE POINT. An `href` in an agent answer is a string
 * a model composed, so it is untrusted input: an external link rendered as an
 * anchor turns an answer into a route off the box, and a brief is a document
 * that gets emailed. Anything not starting with a single `/` must render as
 * plain text.
 *
 * Also asserts the brief vocabulary is unchanged, because this component exists
 * so the printed brief and the on-screen brief are the SAME document — the new
 * syntax had to be purely additive.
 *
 * Run: npx tsx scripts/verify-brief-markdown.tsx
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BriefMarkdown } from '../src/components/briefs/BriefMarkdown'

let failures = 0
function check(label: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const render = (text: string) =>
  renderToStaticMarkup(React.createElement(BriefMarkdown, { text }))

console.log('\nBriefMarkdown — what it renders\n')

// ── the thing that did not work ──
const link = render('See [Steelton](/projects/abc) for the close date.')
check('an internal link becomes an anchor', link.includes('href="/projects/abc"'))
check('the anchor carries the label, not the raw markdown', link.includes('>Steelton</a>') && !link.includes('[Steelton]'))

// ── the refusals ──
for (const bad of [
  '[Phish](https://evil.example/login)',
  '[Proto](javascript:alert(1))',
  '[Scheme](//evil.example)',
  '[Mail](mailto:a@b.c)',
  '[Rel](../../etc/passwd)',
]) {
  const out = render(`Read ${bad} now.`)
  check(`refuses ${bad.slice(0, 34)}`, !out.includes('<a '), out.slice(0, 90))
}
check('a refused link still shows its label as text', render('[Phish](https://evil.example)').includes('Phish'))

// ── the other additions ──
const ol = render('1. First\n2. Second\n3. Third')
check('an ordered list is an <ol>', ol.includes('<ol') && (ol.match(/<li/g) ?? []).length === 3)
check('an ordered list keeps the number it started at', render('3. Third\n4. Fourth').includes('start="3"'))
check('inline code renders as <code>', render('Set `AI_PROVIDER` to local.').includes('<code'))
const fence = render('Before\n```\nlms ps\n```\nAfter')
check('a fenced block renders as <pre>', fence.includes('<pre') && fence.includes('lms ps'))
check('an UNCLOSED fence still renders rather than leaving backticks', (() => {
  const out = render('Here:\n```\nlms ps')
  return out.includes('<pre') && !out.includes('```')
})())

// ── additive: the brief vocabulary must be untouched ──
const brief = render('# Title\n\n## Section\n\n[CRITICAL] A blocker.\n\n- One\n- Two\n\n**Bold** text.')
check('headings still render', brief.includes('<h1') && brief.includes('<h2'))
check('bullets still render as <ul>', brief.includes('<ul') && !brief.includes('<ol'))
check('bold still renders', brief.includes('<strong>Bold</strong>'))
check('a severity tag still becomes a chip, not a link', brief.includes('Critical') && !brief.includes('[CRITICAL]'))

// ── a link must not swallow a tag, and vice versa ──
const both = render('[WATCH] See [Myton](/projects/m).')
check('a tag and a link in one line both render', both.includes('href="/projects/m"') && both.includes('Watch'))
check('no loose parenthesis left behind', !both.includes('(/projects/m)'))

for (const bad of ['NaN', 'undefined', '[object Object]']) {
  check(`no ${bad} in the markup`, !link.includes(bad) && !brief.includes(bad))
}

console.log(failures === 0 ? '\n✓ renders what it should and refuses what it must\n' : `\n✗ ${failures} failed\n`)
process.exitCode = failures === 0 ? 0 : 1
