/**
 * Vocabulary for the inbound lead queue — labels and badge tones for routes,
 * statuses, and fit recommendations.
 *
 * Plain text in the DB with the app as source of truth, matching the steel and
 * opportunities modules. Badge strings follow the Chip contract: a
 * bg/text/ring triple with dark variants.
 */

import type { LeadRoute } from '@/lib/ai/prompts/lead-triage'
import type { LeadStatus, FitRecommendation } from '@/lib/leads/db'

export const ROUTE_LABELS: Record<LeadRoute, string> = {
  steel: 'Steel',
  dino: 'Dino',
  construction: 'Construction',
  corporate: 'Corporate',
  unknown: 'Unsorted',
}

/** Where a lead of each route is destined to land, in plain words. */
export const ROUTE_DESTINATIONS: Record<LeadRoute, string> = {
  steel: 'Prefab steel — quotes in the Steel CRM',
  dino: 'Plumbing / HVAC — forwarded to Dino Service Pros',
  construction: 'General construction & infrastructure — becomes a project',
  corporate: 'Acquisitions, JVs, equity — becomes an opportunity',
  unknown: 'A real lead the AI could not categorize',
}

export const ROUTE_BADGE: Record<LeadRoute, string> = {
  steel:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  dino:
    'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-300 dark:ring-cyan-500/30',
  construction:
    'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  corporate:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  unknown:
    'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
}

export const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  promoted: 'Promoted',
  forwarded: 'Forwarded',
  ignored: 'Ignored',
  expired: 'Expired',
  spam: 'Filtered',
}

export const STATUS_BADGE: Record<LeadStatus, string> = {
  new: 'bg-primary/10 text-primary ring-primary/20',
  reviewing:
    'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  promoted:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  forwarded:
    'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-500/30',
  ignored:
    'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
  expired:
    'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20',
  spam:
    'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:ring-slate-500/20',
}

export const FIT_BADGE: Record<FitRecommendation, string> = {
  pursue:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  consider:
    'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  pass: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-500/30',
}

export const FIT_LABELS: Record<FitRecommendation, string> = {
  pursue: 'Pursue',
  consider: 'Consider',
  pass: 'Pass',
}

/** Route tab order — the two operating-company lanes first, then the pipeline. */
export const ROUTE_TABS: LeadRoute[] = [
  'construction',
  'steel',
  'dino',
  'corporate',
  'unknown',
]
