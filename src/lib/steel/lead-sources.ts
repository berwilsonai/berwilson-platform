/**
 * Lead sources in use across steel deals — backs the deal form's type-ahead
 * suggestions, the list-page filter, and save-time canonicalization. The
 * vocabulary is self-maintaining (values live on the deals themselves).
 */

import type { createAdminClient } from '@/lib/supabase/admin'
import { leadSourceLabel } from '@/lib/utils/steel'

type AdminClient = ReturnType<typeof createAdminClient>

/** Distinct lead-source values in use, sorted by display label. */
export async function leadSourcesInUse(supabase: AdminClient): Promise<string[]> {
  const { data } = await supabase.from('steel_deals').select('lead_source')
  const distinct = new Set((data ?? []).map((r) => r.lead_source).filter(Boolean))
  return [...distinct].sort((a, b) => leadSourceLabel(a).localeCompare(leadSourceLabel(b)))
}
