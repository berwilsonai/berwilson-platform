import { PanelsTabSkeleton } from '@/components/shared/tab-skeletons'

/**
 * The Overview tab's own boundary.
 *
 * `[id]/loading.tsx` one level up covers the FIRST load of the record; this is
 * what shows when the reader clicks back to Overview from another tab, because
 * a boundary only re-fires for the segment that changed (see tab-skeletons).
 */
export default function OverviewLoading() {
  return <PanelsTabSkeleton panels={3} lines={5} />
}
