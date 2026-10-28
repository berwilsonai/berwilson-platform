import Link from 'next/link'
import { Mic, Sparkles, ArrowUpRight, CircleDashed } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { formatDate } from '@/lib/utils/constants'
import type { JustInItem } from '@/lib/records/just-in'

/**
 * "Just in" — the band at the top of the dashboard.
 *
 * ⚠ IT RENDERS NOTHING WHEN EMPTY, which is the one thing a count-gated panel
 * always gets wrong in the other direction. The whole reason this exists is
 * that six recorded meetings were invisible behind a queue, so the band is
 * absent when nothing arrived (the page should not carry a shrug) and loud the
 * moment something has.
 *
 * Two kinds in one list on purpose: the recording that came in, and the record
 * created off it. They are the same piece of news at two stages, and splitting
 * them into two panels would be the "three needs-attention numbers on one
 * screen" failure in miniature.
 *
 * ⚠ CHIPS COME FROM `Chip`, NOT FROM A LOCAL `text-[11px]` SPAN. The first
 * draft of this file hand-rolled both of them and the conventions ratchet
 * caught it at 258 against a baseline of 256 — §12, the ratchet catching its
 * own author again.
 */
export default function JustIn({ items }: { items: JustInItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-4 elev-1">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5 label-caps text-muted-foreground">
          <Mic size={13} /> Just in
        </div>
        <Link
          href="/decide"
          className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Everything waiting <ArrowUpRight size={12} />
        </Link>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-2.5 min-w-0">
            <span className="shrink-0 mt-0.5 inline-flex items-center justify-center size-5 rounded-full bg-muted text-muted-foreground">
              {item.kind === 'record' ? <Sparkles size={12} /> : <Mic size={12} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <Link
                  href={item.action.href}
                  className="text-sm font-medium text-foreground hover:underline underline-offset-2 truncate max-w-full"
                >
                  {item.title}
                </Link>
                {/*
                    ⚠ FORMATTED AT THE READER, NOT AT THE THREE PRODUCERS.
                    `on` arrives as a bare `YYYY-MM-DD` from all three of
                    them (a project's `created_at`, an opportunity's, and a
                    meeting's `meeting_date`), so this band — the most
                    prominent thing on the dashboard — printed "2026-10-27"
                    at a reader. Formatting here means the fourth producer
                    is right for free. The year is dropped because the whole
                    band is `JUST_IN_WINDOW_DAYS` old at most. */}
                {item.on && (
                  <span className="text-xs text-muted-foreground tnum">
                    {formatDate(item.on, { year: false })}
                  </span>
                )}
                {item.kind === 'record' ? (
                  /*
                   * ⚠ THE CHIP SAYS WHO MADE IT. A record created with no human
                   * in the loop is the row on this page most likely to be
                   * wrong, and a reader who cannot tell it from one they typed
                   * has no reason to check it. `info` rather than a status
                   * colour: it is a provenance note, not an alarm.
                   */
                  <Chip tone="info" className="shrink-0">
                    Pepper created this
                  </Chip>
                ) : item.placement ? (
                  <Link href={item.placement.href} className="shrink-0">
                    <Chip className="hover:text-foreground transition-colors">
                      {item.placement.label}
                    </Chip>
                  </Link>
                ) : (
                  <Chip tone="caution" className="shrink-0">
                    <CircleDashed size={10} /> on no deal yet
                  </Chip>
                )}
              </div>
              {item.detail && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.detail}</p>
              )}
              <Link
                href={item.action.href}
                className="mt-1 inline-flex items-center gap-0.5 text-xs text-accent-foreground hover:underline underline-offset-2"
              >
                {item.action.label} <ArrowUpRight size={11} />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
