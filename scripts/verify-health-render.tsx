/**
 * The health cards the 2026-10-21 hold changed, asserted against live state.
 *
 * ⚠ IT CHECKS THE PROBES, NOT THE PAGE, AND §12 ALREADY SAYS WHY. The page
 * calls `getViewer()`, which calls `cookies()`, which throws outside a request
 * scope — the recorded finding that `next/headers` makes a whole module
 * untestable under `deploy/register.mjs` even when only one function needs a
 * request. So this exercises every probe whose meaning the hold changed and
 * asserts the words the card will print, which is the part that was wrong
 * before: this page has twice carried a card watching a RETIRED channel while
 * the live one went unmonitored.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-health-render.tsx
 */
import {
  OUTBOUND,
  heldKinds,
  heldSummary,
  isHeld,
  liveKinds,
} from '../src/lib/notify/policy'
import {
  probeChat,
  probePepperReply,
  probeTaskReminder,
} from '../src/lib/system-health'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const BAD = /\b(NaN|undefined|Infinity)\b|\[object Object\]/

async function main() {
  // ── The card that makes a held channel visible ────────────────────────────
  const held = heldKinds().filter((k) => k !== 'ad_hoc')
  const live = liveKinds()
  check('something is still allowed to send', live.length > 0, live.join(', '))
  check('the held set is non-empty and named', held.length === 8, `${held.length} held`)
  check('the summary is prose, not a bare count', !/^\d+ channels?/.test(heldSummary()))
  for (const k of held) {
    const pass = OUTBOUND[k]
    check(`${k} says why it is held`, 'held' in pass && pass.held.length > 10)
  }

  // ── The reminder's own card ───────────────────────────────────────────────
  const reminder = await probeTaskReminder()
  check(
    'the task reminder card does not read as broken',
    ['ok', 'quiet', 'held'].includes(reminder.state),
    `state=${reminder.state}`
  )
  check('its detail is readable', !BAD.test(reminder.detail), reminder.detail.slice(0, 120))
  // ⚠ The point of the repoint: it must watch the LIVE kinds, not pepper_text.
  check(
    'it watches the kinds that actually send',
    !isHeld('task_week') && !isHeld('task_due_today')
  )

  // ── The two cards whose silence is now deliberate ─────────────────────────
  const reply = await probePepperReply()
  check('the reply card reports HELD rather than an outage', reply.state === 'held', reply.state)
  check('and says what to do about it', /policy\.ts/.test(reply.detail))

  const chat = probeChat()
  check(
    'the Chat card no longer claims the brief and digests post there',
    !/the weekly brief and lead digests post there/.test(chat.detail),
    chat.detail.slice(0, 90)
  )

  console.log(failures === 0 ? '\n✓ every changed card tells the truth' : `\n✘ ${failures} failure(s)`)
  if (failures > 0) process.exitCode = 1
}

main()
