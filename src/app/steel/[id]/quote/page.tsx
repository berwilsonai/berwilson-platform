import Image from 'next/image'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getViewer, canWorkSteel } from '@/lib/auth/viewer'
import { formatValue } from '@/lib/utils/constants'
import { isInstallCategory, lineItemLabel, formatSqft, servicesRevenue } from '@/lib/utils/steel'
import { SteelQuoteToolbar, QuoteDate, ForceLightTheme } from '@/components/steel/SteelQuoteToolbar'

interface PageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params
  const { data } = await createAdminClient().from('steel_deals').select('name').eq('id', id).single()
  // Tab title = suggested PDF filename.
  return { title: `Quote — ${data?.name ?? 'Steel Deal'}` }
}

export default async function SteelQuotePage({ params }: PageProps) {
  const { id } = await params
  const viewer = await getViewer()
  if (!canWorkSteel(viewer)) redirect('/steel')

  const supabase = createAdminClient()
  const { data: deal } = await supabase.from('steel_deals').select('*').eq('id', id).single()
  if (!deal) notFound()

  const [{ data: services }, { data: company }] = await Promise.all([
    supabase.from('steel_deal_services').select('*').eq('deal_id', id).order('sort_order'),
    supabase.from('company_profile').select('legal_name, dba_name, hq_address, phone, email').maybeSingle(),
  ])

  const lines = services ?? []
  // Customer-facing: PRICES ONLY (never cost / margin / commission).
  const kit = lines.filter((l) => !isInstallCategory(l.service_type) && (l.price ?? 0) !== 0)
  const install = lines.filter((l) => isInstallCategory(l.service_type) && (l.price ?? 0) !== 0)
  const kitSubtotal = servicesRevenue(kit)
  const installSubtotal = servicesRevenue(install)
  const total = kitSubtotal + installSubtotal

  const companyName = company?.dba_name || company?.legal_name || 'Ber Wilson'
  const quoteRef = `Q-${id.slice(0, 8).toUpperCase()}`

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <ForceLightTheme />
      <style>{`@page { size: letter; margin: 0.6in; } @media print { html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <SteelQuoteToolbar dealId={id} />

      <div className="mx-auto max-w-3xl px-8 py-10 print:max-w-none print:px-0 print:py-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-6 pb-6 border-b-2 border-slate-900">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">{companyName}</p>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">Quotation</h1>
            <p className="text-sm text-slate-500 mt-1">Cold-Formed Steel Building Kit</p>
          </div>
          <div className="text-right text-xs text-slate-500 leading-relaxed">
            <Image src="/logo.png" alt={companyName} width={120} height={65} className="object-contain h-9 w-auto ml-auto mb-2" />
            {company?.hq_address && <p>{company.hq_address}</p>}
            {company?.phone && <p>{company.phone}</p>}
            {company?.email && <p>{company.email}</p>}
          </div>
        </header>

        {/* Quote meta */}
        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Prepared for</p>
            <p className="mt-1 font-medium">{deal.customer || '—'}</p>
            <p className="text-slate-600">{deal.name}</p>
            {deal.building_type && <p className="text-slate-500">{deal.building_type}</p>}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Quote</p>
            <p className="mt-1 font-medium tnum">{quoteRef}</p>
            <p className="text-slate-500">
              <QuoteDate />
            </p>
            {deal.square_feet != null && deal.square_feet > 0 && (
              <p className="text-slate-500 tnum">{formatSqft(deal.square_feet)}</p>
            )}
          </div>
        </div>

        {/* Line items */}
        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="pb-2 pr-3 font-medium">Description</th>
              <th className="pb-2 pl-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {kit.length > 0 && (
              <tr>
                <td colSpan={2} className="pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Steel Building Kit
                </td>
              </tr>
            )}
            {kit.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{lineItemLabel(l.description, l.service_type)}</td>
                <td className="py-2 pl-3 text-right">{formatValue(l.price)}</td>
              </tr>
            ))}
            {kit.length > 0 && (
              <tr className="border-b border-slate-200">
                <td className="py-1.5 pr-3 text-right text-slate-500">Kit subtotal</td>
                <td className="py-1.5 pl-3 text-right font-medium">{formatValue(kitSubtotal)}</td>
              </tr>
            )}

            {install.length > 0 && (
              <>
                <tr>
                  <td colSpan={2} className="pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Installation (billed separately)
                  </td>
                </tr>
                {install.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{lineItemLabel(l.description, l.service_type)}</td>
                    <td className="py-2 pl-3 text-right">{formatValue(l.price)}</td>
                  </tr>
                ))}
                <tr className="border-b border-slate-200">
                  <td className="py-1.5 pr-3 text-right text-slate-500">Installation subtotal</td>
                  <td className="py-1.5 pl-3 text-right font-medium">{formatValue(installSubtotal)}</td>
                </tr>
              </>
            )}

            {lines.length === 0 && (
              <tr>
                <td colSpan={2} className="py-6 text-center text-slate-400">
                  No line items on this deal yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-900">
              <td className="pt-3 pr-3 text-right text-base font-semibold">Total</td>
              <td className="pt-3 pl-3 text-right text-base font-semibold tnum">{formatValue(total)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Terms */}
        <section className="mt-10 text-xs text-slate-500 leading-relaxed">
          <p className="font-semibold text-slate-700 mb-1">Terms</p>
          <p>
            This quotation is valid for 30 days from the date above. Pricing is for the American-made cold-formed steel
            building kit as specified; engineering, freight, and applicable taxes are as itemized. Installation, where
            shown, is billed separately from the kit. Final pricing is confirmed on a signed order.
          </p>
        </section>

        <footer className="mt-10 pt-4 border-t border-slate-200 text-[11px] text-slate-400">
          {companyName} · Cold-Formed Steel · Quote {quoteRef}
        </footer>
      </div>
    </div>
  )
}
