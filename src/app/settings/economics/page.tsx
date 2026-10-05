import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { listBenchmarks } from '@/lib/economics/benchmarks'
import BenchmarkManager from '@/components/economics/BenchmarkManager'

export const metadata = { title: 'Benchmarks — Ber Wilson Intelligence' }

export default async function EconomicsSettingsPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const benchmarks = await listBenchmarks()

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Benchmark library</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Market figures a deal model can cite instead of a guess. Picking one sets that input to
          Benchmark with this row&apos;s source and date, so what is written here is what a deal
          will claim.
        </p>
      </header>
      <BenchmarkManager benchmarks={benchmarks} />
    </div>
  )
}
