/**
 * Render every MSPA record and assert nothing breaks.
 *
 * ⚠ A BUILD THAT EXITS 0 HAVING LISTED A ROUTE IS NOT EVIDENCE IT ANSWERS
 * (CLAUDE.md §12). `/mspa` is behind auth, so a curl gets a 307 and proves only
 * that middleware works. This renders the component tree directly, for every
 * record, in both the sized and GPU-sized branches — which is where an
 * undefined access or a NaN would actually surface.
 *
 * It also asserts no `NaN` or `undefined` reaches the markup. A bare em dash at
 * a value's own weight reads as a failed render; `NaN` reads as a number.
 *
 * Run: npx tsx scripts/verify-mspa-render.tsx
 *
 * ⚠ IT IS A `.tsx`, NOT A `.mts`, AND RUNS UNDER tsx RATHER THAN
 * `deploy/register.mjs`. Node's own TypeScript handling does not do JSX, so a
 * `.tsx` import dies with ERR_UNKNOWN_FILE_EXTENSION under the repo loader; and
 * as a `.mts` it is treated as native ESM, which then cannot require() the
 * component without ERR_REQUIRE_CYCLE_MODULE. Neither failure is visible to
 * `tsc` or to `next build`.
 */

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import MspaAssessment from '../src/components/mspa/MspaAssessment'
import assessModule from '../src/lib/mspa/assess'
import paramsModule from '../src/lib/mspa/params'
import registerModule from '../src/lib/mspa/register'

const { MSPA_REGISTER } = registerModule
const { assessOpportunity } = assessModule
const { specFromParams } = paramsModule

const MODES: { label: string; params: Record<string, string> }[] = [
  { label: 'from the record alone', params: {} },
  { label: 'with a GPU count', params: { gpu: 'gb300', gpus: '27072' } },
  { label: 'with phases', params: { phases: '100,200' } },
]

let failures = 0
let rendered = 0

for (const record of MSPA_REGISTER) {
  for (const mode of MODES) {
    try {
      const assessment = assessOpportunity(
        specFromParams({ record: record.name, ...mode.params })
      )
      const html = renderToStaticMarkup(
        React.createElement(MspaAssessment, { assessment })
      )
      if (!html.includes('Capacity')) throw new Error('no Capacity panel in the output')
      if (html.includes('NaN')) throw new Error('NaN reached the rendered output')
      if (html.includes('>undefined<')) throw new Error('undefined reached the rendered output')
      if (html.includes('$Infinity')) throw new Error('Infinity reached the rendered output')
      rendered++
    } catch (error) {
      failures++
      console.log(`✖ ${record.name} — ${mode.label}: ${(error as Error).message}`)
    }
  }
}

console.log(
  failures === 0
    ? `✓ ${rendered} renders across ${MSPA_REGISTER.length} records and ${MODES.length} modes, with no NaN, undefined or Infinity in the markup`
    : `✖ ${failures} of ${rendered + failures} renders failed`
)
process.exitCode = failures ? 1 : 0
