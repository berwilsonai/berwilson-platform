'use client'

import UrlFacets from '@/components/ui/url-facets'
import {
  OPPORTUNITY_TYPES,
  OPPORTUNITY_TYPE_LABELS,
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_LABELS,
} from '@/lib/utils/opportunities'

/**
 * The opportunity board's facets. The row itself — the shell, `setParam`, the
 * select styling and the clear affordance — lives in `UrlFacets`, which is
 * also what /projects and /investors render. This file is the list of facets
 * and nothing else.
 *
 * ⚠ IT USED TO BE ITS OWN 74-LINE COPY, hand-rolling the select class rather
 * than reading `FIELD_CONTROL_SM_CLASS`, so its controls were a different
 * height from the identical row two pages over.
 */
export default function OpportunityFilters({ type, stage }: { type: string; stage: string }) {
  return (
    <UrlFacets
      facets={[
        {
          param: 'type',
          allLabel: 'All Types',
          value: type,
          options: OPPORTUNITY_TYPES.map((t) => [t, OPPORTUNITY_TYPE_LABELS[t]] as const),
        },
        {
          param: 'stage',
          allLabel: 'All Stages',
          value: stage,
          options: OPPORTUNITY_STAGES.map((s) => [s, OPPORTUNITY_STAGE_LABELS[s]] as const),
        },
      ]}
    />
  )
}
