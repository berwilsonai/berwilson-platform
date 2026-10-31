import { NextResponse, type NextRequest } from 'next/server'

import { readDealRegister } from '@/lib/reports/deals'
import { reportDef } from '@/lib/reports/registry'
import { applyAudience, isAudience, type ReportAudience } from '@/lib/reports/types'
import { buildWorkbook, workbookFilename } from '@/lib/reports/xlsx'

/**
 * A report as a real `.xlsx`.
 *
 * ⚠ IT BUILDS THE SAME `ReportData` THE PAGE DOES, FROM THE SAME BUILDER, AND
 * APPLIES THE SAME AUDIENCE FILTER. That is the whole point of the shape: the
 * spreadsheet cannot drift from the screen, because there is nothing for it to
 * drift from. §12's fork rule, and the §12 corollary that a destination which
 * does not carry what the first one carries reads as losing the work.
 *
 * ⚠ ADMIN-ONLY BY DEFAULT-DENY. `/api/reports` is in no `ROLE_API_PREFIXES`
 * list, so the middleware turns away every non-admin before this runs — and
 * ⚠ IT MUST NOT BE ADDED TO ONE WITHOUT RE-READING THIS FILE, because
 * `matchesPrefix` is not method-aware and the register it reads is the whole
 * portfolio. The containment that matters (confidential projects) is enforced
 * inside `readDealRegister` rather than here, so it holds for every caller.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ key: string }> }
) {
  const { key } = await context.params
  const report = reportDef(key)
  if (!report) {
    return NextResponse.json({ error: `Unknown report: ${key}` }, { status: 404 })
  }

  const raw = request.nextUrl.searchParams.get('audience')
  const audience: ReportAudience = isAudience(raw) ? raw : 'internal'

  try {
    const register = await readDealRegister()
    const data = applyAudience(await report.build(register), audience)
    const bytes = buildWorkbook(data)
    const day = new Date().toISOString().slice(0, 10)
    const filename = workbookFilename(data.title, day, audience)

    /*
     * ⚠ A FRESH `Uint8Array` COPY. `zipSync` may hand back a view onto a
     * larger pooled buffer, and handing that straight to `Response` sends the
     * whole buffer — a workbook that opens with trailing garbage, or does not
     * open at all. Copying is a few hundred KB and removes the question.
     */
    const body = new Uint8Array(bytes)

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // Quoted, because the filename carries spaces in no case today and
        // might tomorrow; an unquoted one truncates at the first space.
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(body.byteLength),
        // A report is a snapshot of live data. Caching it is how somebody
        // mails last week's pipeline believing it is this week's.
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[api/reports/${key}/xlsx] failed:`, error)
    return NextResponse.json({ error: `Could not build the report: ${message}` }, { status: 500 })
  }
}
