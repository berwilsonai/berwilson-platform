// Access control for meeting records. Board (company) meetings are governance
// records — admin-only. Project meetings follow the project's access grants, so
// an admin (always) or a project_manager with a grant on the meeting's project
// can read/edit them. Deleting any meeting record stays admin-only (see the
// route) because it destroys a compliance record.

import type { Viewer } from '@/lib/auth/viewer'
import { canAccessProject, canAccessOpportunity } from '@/lib/auth/viewer'

export interface MeetingScopeRef {
  scope: string
  project_id: string | null
  opportunity_id?: string | null
}

/** Can this viewer read/edit the meeting? Admin always; project/opportunity
 *  meetings via the record grant; company (board) meetings never for non-admins. */
export async function canAccessMeeting(viewer: Viewer, meeting: MeetingScopeRef): Promise<boolean> {
  if (viewer.isAdmin) return true
  if (meeting.scope === 'project' && meeting.project_id) return canAccessProject(viewer, meeting.project_id)
  if (meeting.scope === 'opportunity' && meeting.opportunity_id) return canAccessOpportunity(viewer, meeting.opportunity_id)
  return false
}
