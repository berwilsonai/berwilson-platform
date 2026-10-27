/**
 * The commitment ledger's skeleton, shaped like the ledger.
 *
 * ⚠ IT WAS ELEVEN IDENTICAL GREY BARS, AND THE PAGE IT STOOD IN FOR LOOKS
 * NOTHING LIKE THAT. A title, one full-width bar and ten 64px blocks, held for
 * three to four seconds, then replaced by a header with a two-line
 * description, a row of five count chips, two toggle groups, a sort select, a
 * search field and two separately-headed card sections — so the whole page
 * jumped the moment the data landed. A skeleton that does not mirror its page
 * is not a loading state, it is a second layout the reader has to watch
 * collapse.
 *
 * Every measurement below is taken from `CommitmentsLedger`, not guessed:
 * the `space-y-4 p-4 sm:p-6` wrapper, `min-h-9` toggle buttons inside a
 * `p-1` bordered group, `px-4 py-3` section headers and rows. Changing the
 * ledger's shape means changing this file in the same commit.
 *
 * `animate-pulse` is already 2s in Tailwind v4 — the slow default is the
 * default, and no custom duration is needed.
 */
import { Panel } from '@/components/ui/card'

export default function CommitmentsLoading() {
  return (
    <div className="space-y-4 p-4 sm:p-6 animate-pulse" aria-busy aria-label="Loading the commitment ledger">
      {/* header — h1 at text-xl, then a two-line max-w-2xl description */}
      <header className="space-y-1">
        <div className="h-7 w-44 rounded bg-muted" />
        <div className="max-w-2xl space-y-1">
          <div className="h-4 w-full rounded bg-muted/70" />
          <div className="h-4 w-3/5 rounded bg-muted/70" />
        </div>
      </header>

      {/* the five count chips — one quantity each, never summed */}
      <div className="flex flex-wrap gap-2">
        {['5rem', '10rem', '6rem', '9rem'].map((w) => (
          <div key={w} className="h-[1.375rem] rounded bg-muted" style={{ width: w }} />
        ))}
      </div>

      {/* two toggle groups, the sort select, then the search field */}
      <div className="flex flex-wrap items-center gap-2">
        {[3, 3].map((n, g) => (
          <div key={g} className="flex gap-1 rounded-lg border border-border p-1">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="h-9 w-20 rounded-md bg-muted" />
            ))}
          </div>
        ))}
        <div className="h-9 w-32 rounded-lg bg-muted" />
        <div className="h-9 min-w-[12rem] flex-1 rounded-lg bg-muted" />
      </div>

      {/* "We owe" and "Waiting on" — two headed cards, not one flat run */}
      <div className="space-y-4">
        {[5, 4].map((rows, s) => (
          <Panel key={s}>
            <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
              <div className="space-y-0.5">
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-4 w-40 rounded bg-muted/70" />
              </div>
              <div className="h-4 w-6 rounded bg-muted" />
            </div>
            <ul className="divide-y divide-border">
              {Array.from({ length: rows }).map((_, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="h-5 w-4/5 rounded bg-muted" />
                    <div className="flex gap-2">
                      <div className="h-4 w-24 rounded bg-muted/70" />
                      <div className="h-4 w-20 rounded bg-muted/70" />
                      <div className="h-4 w-16 rounded bg-muted/70" />
                    </div>
                  </div>
                  {/* the three verdict buttons: settle, quiet, never-a-commitment */}
                  <div className="flex shrink-0 items-center gap-1">
                    {[0, 1, 2].map((b) => (
                      <div key={b} className="size-7 rounded-md bg-muted" />
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  )
}
