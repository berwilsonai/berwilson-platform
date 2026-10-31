'use client'

import UrlFacets from '@/components/ui/url-facets'
import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGES } from '@/lib/utils/stages'
/*
  ⚠ IMPORTED, NOT RETYPED. This file kept its own `STATUSES` and
  `STATUS_LABELS` — a verbatim copy of the pair in `constants.ts`, three files
  apart — so narrowing the enum on 10-30 had to be done twice and the build
  only found the second copy because `Record<ProjectStatus, …>` refused the
  dead keys. A label written inline is a label with no owner (§12).
*/
import { STATUSES, STATUS_LABELS } from '@/lib/utils/constants'
import type { ProjectSector } from '@/lib/supabase/types'


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
 * link must mean a bare view.
 *
 * ⚠ SAVED VIEWS EXIST NOW (2026-10-28) AND DO NOT REOPEN THAT DECISION. The
 * refusal was about STORAGE, not about naming a filter set: `saved_views` is a
 * shared table, and choosing a view NAVIGATES to a URL carrying the whole
 * query. So the address bar still describes the screen, a pasted link still
 * means one thing to everybody, and a bare `/projects` is still the unfiltered
 * list. What remains forbidden is the thing that was removed — per-reader
 * filter state replayed on arrival.
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
