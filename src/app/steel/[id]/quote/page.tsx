import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel, canSeeSteelFinancials } from '@/lib/auth/viewer'
import { quoteReadiness } from '@/lib/steel/quote-readiness'
import { findQuoteTemplate } from '@/lib/steel/quote-template'
import { SteelQuoteList, type QuoteRow } from '@/components/steel/SteelQuoteList'

/**
 * The deal's Quotes surface.
 *
 * This route used to render a printable HTML quote. It was replaced rather than
 * kept alongside the generator: two renderers of one document is two sources of
 * truth, and the HTML one was already wrong — it abbreviated money ("$1.8M" on
 * a page a customer signs) and computed the quote date in the BROWSER, so a
 * quote made at 11pm MST printed tomorrow's date for a reader elsewhere.
 *
 * The URL is unchanged so the Quote button on the deal page and anyone's
 * muscle memory still land somewhere sensible.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data } = await supabase.from('steel_deals').select('name').eq('id', id).maybeSingle()
  return { title: data?.name ? `Quotes — ${data.name}` : 'Quotes' }
}

export default async function SteelQuotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')

  const supabase = createAdminClient()

  const { data: deal } = await supabase
    .from('steel_deals')
    // Same narrow column list as the generator: this page computes readiness
    // with the very same function, so it must see the very same fields.
    .select('id, name, customer, site_address, scope_summary, square_feet, floors, salesperson_id, pricing_below_floor, value')
    .eq('id', id)
    .maybeSingle()
  if (!deal) notFound()

  const [{ data: lines }, { data: company }, { data: quotes }, { data: estimator }] = await Promise.all([
    supabase
      .from('steel_deal_services')
      .select('service_type, description, price, sort_order')
      .eq('deal_id', id)
      .order('sort_order'),
    supabase.from('company_profile').select('email, phone').maybeSingle(),
    supabase
      .from('steel_quotes')
      .select('id, quote_number, revision, status, issued_at, valid_until, total, square_feet, below_floor, drive_file_url, document_id, created_at')
      .eq('deal_id', id)
      .neq('status', 'generating')
      .order('revision', { ascending: false }),
    deal.salesperson_id
      ? supabase.from('team_members').select('name, email').eq('id', deal.salesperson_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const readiness = quoteReadiness(deal, lines ?? [], estimator ?? null, company ?? null)

  // A missing template is a configuration problem, not a deal problem, so it is
  // reported separately from the readiness blockers. Never fatal to the page.
  let templateMissing = false
  try {
    templateMissing = (await findQuoteTemplate()) === null
  } catch {
    templateMissing = true
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link
        href={`/steel/${id}`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-3.5" /> {deal.name}
      </Link>
      <h1 className="mt-2 mb-5 text-2xl">Quotes</h1>

      <SteelQuoteList
        dealId={id}
        quotes={(quotes ?? []) as QuoteRow[]}
        blockers={readiness.blockers}
        warnings={readiness.warnings}
        canApprove={canSeeSteelFinancials(viewer)}
        templateMissing={templateMissing}
      />
    </div>
  )
}
