#!/usr/bin/env node
/**
 * Measure the running app — run an expression against a route and print what
 * it returns, in either theme.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `shoot.mjs` answers "what does it look like". It cannot answer "is that 44px
 * or 38.7px", "did the layout shift between the skeleton and the page", "how
 * many distinct font sizes does this page render" or "does any element compute
 * the same colour for its text and its background" — and every one of those is
 * a question this repo has already been wrong about while looking right. §12
 * is full of bugs that a screenshot passes: a touch target derived from a
 * spacing token, a fill and an ink of the same lightness, a type scale that is
 * two sizes and an accident.
 *
 * Same plumbing as `shoot.mjs`, same auth story: point it at a `next dev`
 * server, which loads no root middleware, so every gated page renders.
 *
 * Usage:
 *   node scripts/ui/measure.mjs /decide 'document.querySelectorAll("button").length'
 *   node scripts/ui/measure.mjs --probe=type /dashboard
 *   BW_SHOOT_THEMES=dark node scripts/ui/measure.mjs --probe=contrast /decide
 *
 * Built-in probes live in `scripts/ui/probes.mjs` so an assertion and a
 * one-off question read the same page the same way.
 */
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

import { PROBES } from './probes.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP = process.env.BW_SHOOT_APP ?? 'http://localhost:3001'
const PORT = Number(process.env.BW_SHOOT_CDP_PORT ?? 9334)
const [W, H] = (process.env.BW_SHOOT_SIZE ?? '1512,950').split(',').map(Number)
const THEMES = (process.env.BW_SHOOT_THEMES ?? 'light,dark').split(',').filter(Boolean)
const SETTLE = Number(process.env.BW_MEASURE_SETTLE ?? 4500)

const args = process.argv.slice(2)
const probeName = args.find((a) => a.startsWith('--probe='))?.slice('--probe='.length)
const paths = args.filter((a) => a.startsWith('/'))
const inline = args.find((a) => !a.startsWith('-') && !a.startsWith('/'))

if (!paths.length) {
  console.error('usage: measure.mjs [--probe=<name>] /route [...] [expression]')
  console.error(`probes: ${Object.keys(PROBES).join(', ')}`)
  process.exit(2)
}
const expression = probeName ? PROBES[probeName] : inline
if (!expression) {
  console.error(probeName ? `no such probe: ${probeName}` : 'give an expression or --probe=<name>')
  process.exit(2)
}

const profile = join(tmpdir(), `bw-measure-${process.pid}`)
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
   `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'],
  { stdio: 'ignore' }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      if (r.ok) return (await r.json()).webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await sleep(250)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}

function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 0
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = rej })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.rej(new Error(msg.error.message))
    else p.res(msg.result)
  }
  return {
    ready,
    send(method, params = {}) {
      const n = ++id
      ws.send(JSON.stringify({ id: n, method, params }))
      return new Promise((res, rej) => pending.set(n, { res, rej }))
    },
    close: () => ws.close(),
  }
}

const cdp = connect(await target())
await cdp.ready
await cdp.send('Page.enable')

const out = {}
for (const theme of THEMES) {
  await cdp.send('Page.navigate', { url: `${APP}/login` })
  await sleep(SETTLE)
  await cdp.send('Runtime.evaluate', {
    expression: `try{localStorage.setItem('theme',${JSON.stringify(theme)})}catch(e){}`,
  })
  for (const p of paths) {
    await cdp.send('Page.navigate', { url: `${APP}${p}` })
    await sleep(SETTLE)
    // ⚠ ASSERT THE THEME, for the reason written at length in shoot.mjs: a
    // switch that silently does nothing is how six screenshots were taken in
    // the theme nobody was in.
    const applied = await cdp.send('Runtime.evaluate', {
      expression: `document.documentElement.classList.contains('dark')?'dark':'light'`,
      returnByValue: true,
    })
    if (applied.result.value !== theme) {
      console.error(`  ! ${p}: asked for ${theme}, page is ${applied.result.value} — NOT MEASURED`)
      continue
    }
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      console.error(`  ! ${p} [${theme}]: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`)
      continue
    }
    out[`${p} [${theme}]`] = r.result.value
  }
}

cdp.close()
chrome.kill()
console.log(JSON.stringify(out, null, 2))
await sleep(400)
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* reaped by the OS */ }
