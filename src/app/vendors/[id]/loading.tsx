import { PanelsTabSkeleton } from '@/components/shared/tab-skeletons'

/**
 * Vendor profile: 7 queries, none of them parallel.
 *
 * Shapes come from `shared/tab-skeletons.tsx` rather than being hand-drawn: a
 * skeleton is only useful while it matches, and a shared shape follows the
 * primitive when the primitive changes.
 */
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div>
        <div className="h-6 w-48 rounded bg-muted" />
        <div className="mt-2 h-4 w-72 rounded bg-muted/70" />
      </div>
      <PanelsTabSkeleton panels={3} lines={6} />
    </div>
  )
}
