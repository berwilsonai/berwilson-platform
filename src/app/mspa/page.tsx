import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import MspaAssessment from '@/components/mspa/MspaAssessment'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import {
  assessOpportunity,
  MSPA_REGISTER,
  recordFromParams,
  specFromParams,
  summarizeRegister,
  type MspaScope,
} from '@/lib/mspa'

export const metadata = { title: 'TensorIQ MSPA — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The TensorIQ Master Strategic Partnership Agreement calculation layer.
 *
 * ⚠ ADMIN-ONLY BY DEFAULT-DENY, like /calc and /decide. This page prints
 * Ber Wilson's fee position and what it would be owed if it were cut out of a
 * deal — commercially sensitive on both sides of the partnership.
 *
 * State lives in the query string, so a fee figure quoted on a call is a link
 * that reproduces it exactly.
 */

const SCOPE_TONE: Record<MspaScope, string> = {
  in: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  unsized:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
  out: 'bg-muted text-muted-foreground ring-border',
}

const SCOPE_LABEL: Record<MspaScope, string> = {
  in: 'In scope',
  unsized: 'Unsized',
  out: 'Not an MSPA deal',
}

export default async function MspaPage({ searchParams }: PageProps) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const raw = await searchParams
  const flat: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value
  }

  const record = recordFromParams(flat)
  const summary = summarizeRegister()

  // ── A named record: assess it. ────────────────────────────────────────────
  if (record) {
    const assessment = assessOpportunity(specFromParams(flat))
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-0">
        <header className="mb-5">
          <Link
            href="/mspa"
            className="label-caps text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            ← TensorIQ MSPA
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{record.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{record.rationale}</p>
        </header>

        {(record.conflictingFigures.length > 0 || record.mwSource) && (
          <Panel className="mb-4 overflow-hidden">
            <PanelHeader
              label="Capacity figures on this record"
              count={record.conflictingFigures.length + (record.mwSource ? 1 : 0)}
            />
            <ul className="divide-y divide-border">
              {record.mwSource && (
                <li className="px-4 py-2 text-sm">
                  <span className="label-caps mr-2 text-muted-foreground">Taken</span>
                  {record.mwSource}
                </li>
              )}
              {record.conflictingFigures.map((f, i) => (
                <li key={i} className="px-4 py-2 text-sm text-muted-foreground">
                  {f}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <MspaAssessment assessment={assessment} />

        {record.notes.length > 0 && (
          <Panel className="mt-4 overflow-hidden">
            <PanelHeader label="On the record" count={record.notes.length} />
            <ul className="divide-y divide-border">
              {record.notes.map((n, i) => (
                <li key={i} className="px-4 py-2.5 text-sm leading-relaxed">
                  {n}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    )
  }

  // ── No record named: the register. ───────────────────────────────────────
  const groups: MspaScope[] = ['in', 'unsized', 'out']

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">TensorIQ MSPA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What a deal is worth to Ber Wilson under the Master Strategic Partnership Agreement, and a
          sanity check on the project economics TensorIQ presents. Fees and protection are
          contractual and computed exactly; project returns are modelled and shown as scenarios.
        </p>
      </header>

      <Panel className="mb-4 overflow-hidden">
        <PanelHeader label="The register" count={summary.total} />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
          {([
            ['In scope', summary.inScope],
            ['Unsized', summary.unsized],
            ['Not MSPA deals', summary.outOfScope],
            ['Stated MW', summary.withStatedMw],
            ['Confirmed basis', summary.withConfirmedBasis],
            ['Signed PCA', summary.withSignedPca],
            ['Site control', summary.withSiteControl],
            ['Cost estimate', summary.withCostEstimate],
          ] as const).map(([label, value]) => (
            <div key={label}>
              <div className="tnum text-lg font-semibold">{value}</div>
              <div className="label-caps text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <p className="border-t border-border bg-muted/20 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
          ⚠ No record has a per-phase cost estimate, so every fee figure here rests on the TensorIQ
          facility model rather than on a project estimate. Five of the eight sized records do not
          say whether their megawatt figure is IT load or utility load, which is a factor of about
          1.4 in every number downstream.
        </p>
      </Panel>

      {groups.map((group) => {
        const rows = MSPA_REGISTER.filter((r) => r.mspaScope === group)
        if (rows.length === 0) return null
        return (
          <Panel key={group} className="mb-4 overflow-hidden">
            <PanelHeader label={SCOPE_LABEL[group]} count={rows.length} />
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.name}>
                  <Link
                    href={`/mspa?record=${encodeURIComponent(r.name)}`}
                    className="block px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{r.name}</div>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {r.rationale}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {r.statedMw != null ? (
                          <span className="tnum text-sm font-medium">
                            {r.statedMw} MW
                            {r.mwBasis ? (
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {r.mwBasis === 'it' ? 'IT' : 'utility'}
                              </span>
                            ) : (
                              <span className="ml-1 text-xs font-normal text-amber-700 dark:text-amber-300">
                                basis?
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No capacity</span>
                        )}
                        {r.pcaSigned && <Chip tone={SCOPE_TONE.in}>PCA signed</Chip>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )
      })}
    </div>
  )
}
