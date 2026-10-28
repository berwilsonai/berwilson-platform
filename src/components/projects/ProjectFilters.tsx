'use client'

import UrlFacets from '@/components/ui/url-facets'
import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGES } from '@/lib/utils/stages'
import type { ProjectSector, ProjectStatus } from '@/lib/supabase/types'

const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'won', 'lost', 'closed']
const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}
const SECTORS: ProjectSector[] = ['government', 'infrastructure', 'real_estate', 'prefab', 'institutional']

/**
 * The project list's facets. The row itself — the shell, `setParam`, the
 * select styling and the clear affordance — lives in `UrlFacets`.
 *
 * ⚠ THE `localStorage` REPLAY IS GONE AND MUST NOT COME BACK, and the reason
 * is carried on `UrlFacets` now so it covers all three pages rather than only
 * this one. In short: it mirrored these filters into storage and replayed
 * them on arrival, so a bare `/projects` rendered DIFFERENTLY for each
 * executive with no way for the sender of a link to tell, and the list
 * re-rendered under the reader after hydration. The URL is the view; a bare
 * link must mean a bare view. Anyone wanting their own default bookmarks the
 * filtered URL, which has the property a saved view in storage would not:
 * it is shareable.
 */
export default function ProjectFilters({
  sector,
  status,
  stage,
}: {
  sector: string
  status: string
  stage: string
}) {
  return (
    <UrlFacets
      facets={[
        {
          param: 'sector',
          allLabel: 'All Sectors',
          value: sector,
          options: SECTORS.map((s) => [s, SECTOR_LABELS[s]] as const),
        },
        {
          param: 'status',
          allLabel: 'All Statuses',
          value: status,
          options: STATUSES.map((s) => [s, STATUS_LABELS[s]] as const),
        },
        {
          param: 'stage',
          allLabel: 'All Stages',
          value: stage,
          options: STAGES.map((s) => [s, STAGE_LABELS[s]] as const),
        },
      ]}
    />
  )
}
