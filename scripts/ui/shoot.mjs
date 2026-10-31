#!/usr/bin/env node
/**
 * Screenshot the running app — in BOTH themes — with headless Chrome.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Four consecutive UI sessions shipped palette and layout work that the user
 * could not see. The first three never rendered the result at all. The fourth
 * built a harness, took six screenshots, and still shipped something invisible
 * — because EVERY SHOT WAS TAKEN IN THE THEME BEING REDESIGNED and the user
 * was in the other one. A harness that can only render the happy path confirms
 * what you already believe.
 *
 * ⚠ THE FIRST VERSION OF THIS FILE HAD A `BW_SHOOT_DARK` FLAG THAT DID NOTHING.
 * It "set" the theme by navigating to `/dashboard#set-dark`, which is not a
 * thing — `chrome --headless --screenshot` runs no script of yours, so there
 * is no way to reach `localStorage` before the pre-paint script reads it. The
 * flag existed, read plausibly, and was never once run. A switch that cannot
 * work is worse than no switch.
 *
 * So this drives Chrome over the DevTools Protocol instead: open a tab, seed
 * `localStorage.theme`, reload so the pre-paint script sees it, screenshot.
 *
 * ── HOW IT GETS PAST AUTH ───────────────────────────────────────────────────
 * It does not need to. §12: `next dev` does not load the root `middleware.ts`,
 * so a dev server on another port renders every gated page with no session.
 * Point it at one (the default).
 *
 * ⚠ START THAT DEV SERVER ON ITS OWN DIST, OR IT WRITES INTO PRODUCTION'S:
 *
 *     BW_DIST_DIR=.next-dev npx next dev -p 3001
 *
 * THIS FOLDER IS PRODUCTION (CLAUDE.md, top). A bare `next dev` writes
 * `.next/dev/` into the very `.next` the live `next start` is serving, and the
 * launchd job is `KeepAlive: true` — so a restart during that window boots the
 * platform off a dist a dev server is mutating. Verified 2026-10-29: a bare
 * run put `dev/` inside the production dist; with `BW_DIST_DIR` set, `.next`
 * was untouched. `/.next-*` (with a trailing slash) is already gitignored, and
 * ⚠ THAT PATTERN MUST NOT BE WRITTEN OUT IN FULL IN A BLOCK COMMENT: the `*`
 * followed by `/` CLOSES the comment, so everything below became code and this
 * script stopped parsing the moment this paragraph was added (2026-10-29). The
 * documented way to screenshot the app was broken for a day by its own
 * documentation. Its own
 * comment records the OTHER half of this trap — an un-ignored build dir
 * becomes a Tailwind source and feeds its compiled output back into
 * globals.css.
 *   ⚠ With no middleware there is no viewer, so the role falls back to
 *   `member` and most nav rows are filtered out. Judge the chrome and the
 *   content from these; never the nav.
 *
 * Usage:
 *   node scripts/ui/shoot.mjs                     # default pages, both themes
 *   node scripts/ui/shoot.mjs /projects /tasks    # specific pages
 *   BW_SHOOT_THEMES=dark node scripts/ui/shoot.mjs
 *
 * Output: `.ui-shots/<page>.<theme>.png` (git-ignored).
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP = process.env.BW_SHOOT_APP ?? 'http://localhost:3001'
const OUT = '.ui-shots'
const PORT = Number(process.env.BW_SHOOT_CDP_PORT ?? 9333)
const [W, H] = (process.env.BW_SHOOT_SIZE ?? '1512,950').split(',').map(Number)
const THEMES = (process.env.BW_SHOOT_THEMES ?? 'light,dark').split(',').filter(Boolean)
const DENSITY = process.env.BW_SHOOT_DENSITY ?? 'comfortable'

const DEFAULT_PAGES = ['/dashboard', '/projects', '/contacts', '/tasks']
const pages = process.argv.slice(2).filter((a) => a.startsWith('/'))
const paths = pages.length ? pages : DEFAULT_PAGES

const profile = join(tmpdir(), `bw-shoot-${process.pid}`)
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The debugger socket takes a moment to bind; poll rather than guess. */
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      if (r.ok) return (await r.json()).webSocketDebuggerUrl
    } catch {
      /* not up yet */
    }
    await sleep(250)
  }
  throw new Error('Chrome DevTools endpoint never came up')
}

/** Minimal CDP client: send a command, await the matching id. */
function connect(url) {
  const ws = new WebSocket(url)
  const pending = new Map()
  let id = 0
  const ready = new Promise((res, rej) => {
    ws.onopen = () => res()
    ws.onerror = (e) => rej(e)
  })
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

mkdirSync(OUT, { recursive: true })

async function goto(url) {
  await cdp.send('Page.navigate', { url })
  // Dev builds compile on first hit; give the route room, then settle.
  await sleep(4500)
}

let shot = 0
for (const theme of THEMES) {
  // Seed the key the pre-paint script reads, on the app's own origin.
  await goto(`${APP}/login`)
  /*
    Seed the two preferences the pre-paint script reads. ⚠ DENSITY HAS TO BE
    SEEDED HERE TOO, for the same reason the theme does: Chrome runs on a
    fresh profile every time, so anything set in a previous run is gone, and
    a compact screenshot taken without it is just another comfortable one.
    `BW_SHOOT_DENSITY=compact node scripts/ui/shoot.mjs /decide`
  */
  await cdp.send('Runtime.evaluate', {
    expression:
      `try{localStorage.setItem('theme',${JSON.stringify(theme)});` +
      `localStorage.setItem('density',${JSON.stringify(DENSITY)})}catch(e){}`,
  })
  for (const p of paths) {
    await goto(`${APP}${p}`)
    const applied = await cdp.send('Runtime.evaluate', {
      expression: `document.documentElement.classList.contains('dark')?'dark':'light'`,
      returnByValue: true,
    })
    // ⚠ ASSERT THE THEME ACTUALLY APPLIED. The whole reason this file was
    // rewritten is a flag that claimed to switch themes and did not.
    if (applied.result.value !== theme) {
      console.error(`  ! ${p}: asked for ${theme}, page is ${applied.result.value} — NOT SHOT`)
      continue
    }
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const suffix = DENSITY === 'comfortable' ? '' : `.${DENSITY}`
    const name = `${p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '-')}${suffix}.${theme}.png`
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'))
    console.log(`  ✓ ${OUT}/${name}`)
    shot++
  }
}

cdp.close()
chrome.kill()
console.log(`\n${shot} screenshot(s) across ${THEMES.length} theme(s)`)
// ⚠ AFTER the summary, and swallowed. Chrome has not finished unlinking its
// profile when `kill()` returns, so this races it and throws ENOTEMPTY — which
// reads as a failed run even though every screenshot is already on disk.
await sleep(400)
try {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
} catch {
  /* a temp dir the OS will reap; never fail a successful run over it */
}
