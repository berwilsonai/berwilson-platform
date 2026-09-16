import { NextRequest } from 'next/server'
import {
  getViewer,
  canWorkSteel,
  canSeeSteelFinancials,
  forbiddenJson,
  actorAdminClient,
} from '@/lib/auth/viewer'
import { DEFAULT_VALID_DAYS } from '@/lib/steel/quote-tokens'
import { quoteStatus } from '@/lib/utils/steel-quotes'

/**
 * Issue a quote — the moment it stops being a working draft and becomes a
 * document somebody is holding.
 *
 * Separating this from generation is what makes "an issued quote never silently
 * changes" true: regeneration replaces a draft in place, but once issued, the
 * next generation becomes a new revision and this row is never rewritten.
 *
 * ⚠ A BELOW-FLOOR QUOTE CAN ONLY BE ISSUED BY AN ADMIN OR EXECUTIVE. That is
 * the whole approval gate, and it needs no separate machinery: reps generate
 * and iterate freely, but turning a sub-floor price into a sent document is a
 * management decision.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) return forbiddenJson()

  const supabase = await actorAdminClient()
  const { data: quote } = await supabase
    .from('steel_quotes')
    .select('id, deal_id, quote_number, revision, status, below_floor')
    .eq('id', id)
    .maybeSingle()

  if (!quote) return Response.json({ error: 'Quote not found' }, { status: 404 })

  const status = quoteStatus(quote.status)
  if (status === 'generating') {
    return Response.json({ error: 'This quote is still being generated.' }, { status: 409 })
  }
  if (status !== 'draft') {
    return Response.json(
      { error: `This quote is already ${status} and cannot be issued again.` },
      { status: 409 }
    )
  }

  if (quote.below_floor && !canSeeSteelFinancials(viewer)) {
    return Response.json(
      {
        error:
          'This quote is priced below the $30/SF floor. An admin or executive has to approve it before it can be issued.',
      },
      { status: 403 }
    )
  }

  const issuedAt = new Date()
  const validUntil = new Date(issuedAt)
  validUntil.setDate(validUntil.getDate() + DEFAULT_VALID_DAYS)

  const { error } = await supabase
    .from('steel_quotes')
    .update({
      status: 'issued',
      issued_at: issuedAt.toISOString(),
      valid_until: validUntil.toISOString().slice(0, 10),
    })
    .eq('id', id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Every earlier revision on this deal is now history. Scoped to 'draft' and
  // 'issued' so an accepted or declined quote keeps the outcome it recorded.
  await supabase
    .from('steel_quotes')
    .update({ status: 'superseded' })
    .eq('deal_id', quote.deal_id)
    .neq('id', id)
    .in('status', ['draft', 'issued'])

  return Response.json({ ok: true, issued_at: issuedAt.toISOString() })
}
