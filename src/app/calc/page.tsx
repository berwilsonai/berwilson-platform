import { getViewer } from '@/lib/auth/viewer'
import { redirect } from 'next/navigation'
import QuickCalc from '@/components/economics/QuickCalc'
import { scratchFromParams } from '@/lib/economics/scratch'

export const metadata = { title: 'Quick calc — Ber Wilson Intelligence' }

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * The scratchpad as a real page, not only a dock.
 *
 * ⚠ A PAGE BECAUSE A CALCULATION KEPT IN COMPONENT STATE CANNOT BE LINKED,
 * BOOKMARKED OR SENT TO ANYONE, which reads as the thing having no page
 * (CLAUDE.md §12, 10-03). The inputs are in the query string, so a figure
 * quoted on a call is a URL that reproduces it exactly.
 *
 * Admin-only by default-deny: `/calc` is in no ROLE_PAGE_PREFIXES list, so
 * middleware already turns every other role away. The redirect here is belt and
 * braces, matching /decide and /settings/lead-categories.
 */
export default async function CalcPage({ searchParams }: PageProps) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const raw = await searchParams
  const flat: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-0">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">Quick calc</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Megawatts and one price. The same engine the Economics tab uses, so the answer here and
          the answer on a deal cannot disagree.
        </p>
      </header>
      <QuickCalc initial={scratchFromParams(flat)} />
    </div>
  )
}
