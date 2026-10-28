'use client'

import UrlFacets from '@/components/ui/url-facets'
import {
  INVESTOR_TYPES,
  INVESTOR_TYPE_LABELS,
  INVESTOR_STAGES,
  INVESTOR_STAGE_LABELS,
  INTEREST_LEVELS,
  INTEREST_LEVEL_LABELS,
  INVESTMENT_TARGET_KINDS,
  INVESTMENT_TARGET_LABELS,
} from '@/lib/utils/investors'

/**
 * The investor pipeline's facets. The row itself lives in `UrlFacets`; this
 * file is the list of facets and nothing else.
 */
export default function InvestorFilters({
  stage,
  type,
  interest,
  target,
}: {
  stage: string
  type: string
  interest: string
  target: string
}) {
  return (
    <UrlFacets
      facets={[
        {
          param: 'stage',
          allLabel: 'All Stages',
          value: stage,
          options: INVESTOR_STAGES.map((s) => [s, INVESTOR_STAGE_LABELS[s]] as const),
        },
        {
          param: 'type',
          allLabel: 'All Types',
          value: type,
          options: INVESTOR_TYPES.map((t) => [t, INVESTOR_TYPE_LABELS[t]] as const),
        },
        {
          param: 'interest',
          allLabel: 'All Interest',
          value: interest,
          options: INTEREST_LEVELS.map((i) => [i, INTEREST_LEVEL_LABELS[i]] as const),
        },
        {
          param: 'target',
          allLabel: 'All Targets',
          value: target,
          options: INVESTMENT_TARGET_KINDS.map((k) => [k, INVESTMENT_TARGET_LABELS[k]] as const),
        },
      ]}
    />
  )
}
