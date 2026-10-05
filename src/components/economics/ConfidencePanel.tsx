/**
 * What is wrong, what is unknown, and how far this model can be trusted.
 *
 * ⚠ THREE LISTS, KEPT APART, BECAUSE THEY MEAN DIFFERENT THINGS. Blocking is
 * "this cannot be believed", a warning is "this looks wrong but is arithmetic
 * anyone can check", and missing is "nobody has said yet". Merging them would
 * put a $0.60/kWh price beside a 10 MW overage, and the reader would learn to
 * ignore both.
 *
 * Server-renderable: pure divs.
 */

import { Panel } from '@/components/ui/card'
import {
  PROVENANCE_LABELS,
  PROVENANCE_NEXT_STEP,
  type DealEconomicsResult,
} from '@/lib/economics'

export default function ConfidencePanel({ result }: { result: DealEconomicsResult }) {
  // Deduplicated: four lines each wanting a term produces four identical
  // sentences, which reads as four problems.
  const missing = Array.from(
    new Map(
      result.missing.map((m) => [`${m.lineLabel ?? ''}|${m.what}`, m])
    ).values()
  )

  const nothingToSay =
    result.errors.length === 0 && result.warnings.length === 0 && missing.length === 0

  return (
    <Panel className="p-4 sm:p-5">
      <h2 className="label-caps text-muted-foreground">Confidence</h2>

      <p className="mt-2 text-sm">
        {result.status == null ? (
          <span className="text-muted-foreground">
            Nothing has been sourced yet, so there is no confidence to report.
          </span>
        ) : (
          <>
            Every headline figure reads as{' '}
            <span className="font-medium">
              {PROVENANCE_LABELS[result.status].toLowerCase()}
            </span>
            , because that is the weakest input anywhere in the model.
            {PROVENANCE_NEXT_STEP[result.status] ? (
              <span className="text-muted-foreground">
                {' '}
                Next step: {PROVENANCE_NEXT_STEP[result.status]?.toLowerCase()}.
              </span>
            ) : null}
          </>
        )}
      </p>

      {result.errors.length > 0 ? (
        <div className="mt-4">
          <h3 className="label-caps text-destructive">Blocking</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {result.errors.map((e, i) => (
              <li key={`${e.code}-${i}`} className="text-destructive">
                {e.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            No deal size is published to the pipeline while anything here is unresolved.
          </p>
        </div>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="mt-4">
          <h3 className="label-caps text-amber-700 dark:text-amber-300">Worth a look</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-muted-foreground">
            {result.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="mt-4">
          <h3 className="label-caps text-muted-foreground">Nobody has said yet</h3>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            {missing.map((m, i) => (
              <li key={`${m.lineLabel}-${m.what}-${i}`}>
                {m.lineLabel ? <span className="text-foreground">{m.lineLabel}: </span> : null}
                {m.what}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Each of these is left empty on purpose. The engine invents no prices, rates or terms.
          </p>
        </div>
      ) : null}

      {nothingToSay ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing is blocked, nothing looks wrong, and every input the lines need has a value.
        </p>
      ) : null}
    </Panel>
  )
}
