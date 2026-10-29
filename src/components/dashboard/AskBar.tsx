'use client'

import { useState } from 'react'
import { Sparkles, CornerDownLeft } from 'lucide-react'

import { openDock } from '@/lib/ui/docks'

/**
 * Ask Ber AI, on the front door.
 *
 * ⚠ WHY THIS EXISTS, MEASURED. `agent_conversations` holds 55 rows and 25 of
 * them landed in the last 30 days — roughly one a day, and nearly every one is
 * either *"what do we know about X"* or *"write me a document about X"*:
 *
 *     what are all the metals mentioned around our alaska mine
 *     How many megawatts are in our pipeline
 *     create an offer to purchase GridEdge based on the discussions
 *
 * That is the platform's stated job — query the corpus, and take data entry off
 * a human — and it was reachable two ways: ⌘J, and a sidebar row in the FOURTH
 * group, below two operating companies. Five triage destinations sat above it.
 * The dock is unchanged; this is placement, which is the whole fix.
 *
 * ⚠ IT SEEDS THE DOCK RATHER THAN POSTING. `openDock('open-ber-ai', { query })`
 * is the same contract the command palette has used since the docks registry
 * was typed, and the dock prefills its input (`initialInput`) rather than
 * sending. So the reader presses once more to send — deliberately: an answer is
 * a 30–60s local-model call that cannot be taken back, and a dashboard input
 * that fires one on a stray Enter is worse than one extra keypress.
 */
export default function AskBar() {
  const [value, setValue] = useState('')

  function ask() {
    const query = value.trim()
    // An empty box still opens the dock — the affordance is "ask", not "submit".
    openDock('open-ber-ai', query ? { query } : undefined)
    setValue('')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        ask()
      }}
      className="group relative"
    >
      <Sparkles
        size={15}
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-primary"
      />
      {/*
        ⚠ `h-[2.75rem]`, WRITTEN ABSOLUTELY. `h-11` is
        `calc(var(--spacing) * 11)` and resolves to 38.7px at this project's
        tightened density — §12: a density token moves HEIGHTS, and one of them
        is the 44px touch target.
      */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Ask Ber AI about the portfolio"
        placeholder="Ask Ber AI — what do we know, or what should it write?"
        className="h-[2.75rem] w-full rounded-lg border border-border bg-card pl-10 pr-28 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/80 hover:border-ring/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {/*
        The hint doubles as the submit control. Hidden below `sm:` because a
        phone has no ⌘J and no room for the chrome — §12: a control that only
        appears on hover does not exist on a phone, and the inverse is this one,
        where the keyboard hint is the thing that does not exist on touch.
      */}
      <button
        type="submit"
        className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:inline-flex"
      >
        Ask
        <CornerDownLeft size={12} aria-hidden />
      </button>
    </form>
  )
}
