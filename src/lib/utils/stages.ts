import type { ProjectStage } from '@/lib/supabase/types'

export const STAGES: ProjectStage[] = [
  'pursuit',
  'capture',
  'bid',
  'award',
  'mobilization',
  'execution',
  'closeout',
]

export const STAGE_LABELS: Record<ProjectStage, string> = {
  pursuit: 'Pursuit',
  capture: 'Capture',
  bid: 'Bid',
  award: 'Award',
  mobilization: 'Mobilization',
  execution: 'Execution',
  closeout: 'Closeout',
}

export const STAGE_INDEX: Record<ProjectStage, number> = {
  pursuit: 0,
  capture: 1,
  bid: 2,
  award: 3,
  mobilization: 4,
  execution: 5,
  closeout: 6,
}
