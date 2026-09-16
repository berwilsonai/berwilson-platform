import { NextRequest } from 'next/server'
import { getViewer, canWorkSteel, forbiddenJson } from '@/lib/auth/viewer'
import { generateQuote, QuoteGenerationError } from '@/lib/steel/quote-generate'
import { notifyTeam } from '@/lib/notifications'
import { quoteLabel } from '@/lib/utils/steel-quotes'
import { createAdminClient } from '@/lib/supabase/admin'

// Copying a Doc, replacing ~29 tokens, exporting a PDF and uploading it takes
// about 8-10 seconds against the real API. 300 leaves room for a slow day.
export const maxDuration = 300

/**
 * Generate a quote for a steel deal.
 *
 * Open to every steel worker, not just management. A rep iterating on a price
 * needs to see the document, and generation commits nothing — issuing does.
 * A deal priced below the $30/SF floor still generates, but the PDF is marked
 * DRAFT on every page and cannot be issued without an executive.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  let body: { deal_id?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const dealId = body.deal_id
  if (!dealId) return Response.json({ error: 'deal_id is required' }, { status: 400 })

  try {
    const result = await generateQuote({ dealId, generatedBy: viewer?.teamMemberId ?? null })

    // A sub-floor quote is exactly the thing management would want to know
    // about before a customer sees it. Non-fatal: the quote exists either way.
    if (result.belowFloor) {
      const supabase = createAdminClient()
      const { data: deal } = await supabase
        .from('steel_deals')
        .select('name')
        .eq('id', dealId)
        .maybeSingle()
      await notifyTeam([
        {
          kind: 'quote_below_floor',
          title: `Below-floor quote needs approval — ${deal?.name ?? 'steel deal'}`,
          body:
            `${quoteLabel(result.quoteNumber, result.revision)} was generated below the $30/SF floor. ` +
            `It is marked DRAFT and cannot be issued until an executive approves it.`,
          href: `/steel/${dealId}/quote`,
          actorName: viewer?.teamMemberName ?? null,
          // Deliberately NOT excluding the generator: a rep who quotes below
          // the floor still needs the record that they did.
        },
      ])
    }

    return Response.json({ quote: result })
  } catch (err) {
    if (err instanceof QuoteGenerationError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    console.error('[steel/quotes] generate failed:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'Quote generation failed' },
      { status: 500 }
    )
  }
}
