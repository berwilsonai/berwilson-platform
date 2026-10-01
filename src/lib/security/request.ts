/**
 * The request-scoped half of confidential projects: the same questions as
 * ./confidential.ts, answered for whoever is signed in.
 *
 * Kept apart from ./confidential.ts because this file resolves a viewer, which
 * means cookies, which means it cannot be imported by a cron. The crons are the
 * callers that matter most — an email cannot be un-sent once a locked project
 * is summarised into it — so the data layer stays importable without a request.
 */

import { getViewer, type Viewer } from '@/lib/auth/viewer'
import {
  hasStepUp,
  hiddenProjectIds,
  isConfidentialProject,
} from './confidential'

/**
 * Who may ever hold a step-up.
 *
 * Admin only, deliberately — including over an explicit access_grant. A grant
 * is a project-manager convenience added in a settings screen; the whole point
 * of marking a project confidential is that reaching it takes a second,
 * deliberate act by someone holding an enrolled authenticator. If a PM ever
 * genuinely needs one, that is a decision to make on purpose, not a default to
 * inherit from a grant they were given for something else.
 */
export function mayStepUp(viewer: Viewer | null): boolean {
  return !!viewer?.isAdmin
}

/** Project ids to withhold from this request's reader. */
export async function viewerHiddenProjectIds(): Promise<Set<string>> {
  const viewer = await getViewer()
  if (!mayStepUp(viewer)) {
    // Not eligible to step up at all, so no session could open anything —
    // pass no user and every confidential project is hidden.
    return hiddenProjectIds(null)
  }
  return hiddenProjectIds(viewer!.authUserId)
}

export type ProjectAccess =
  /** Not confidential — nothing special applies. */
  | { state: 'open' }
  /** Confidential, the viewer may step up, and has. */
  | { state: 'unlocked' }
  /** Confidential, the viewer may step up, and has not (or it expired). */
  | { state: 'locked'; hasAuthenticator: boolean }
  /** Confidential and this viewer may never open it. */
  | { state: 'denied' }

/**
 * The one question a project page or a project API route has to ask.
 *
 * Note what this does NOT do: it does not look at the project's grants or the
 * role model. Those are checked where they always were (middleware, canAccessProject).
 * This answers only the confidentiality question, so a reader of either file can
 * see the whole of one rule rather than half of two.
 */
export async function projectAccess(projectId: string): Promise<ProjectAccess> {
  if (!(await isConfidentialProject(projectId))) return { state: 'open' }

  const viewer = await getViewer()
  if (!mayStepUp(viewer)) return { state: 'denied' }

  if (await hasStepUp(viewer!.authUserId, projectId)) return { state: 'unlocked' }

  // Import here rather than at module scope: ./mfa.ts is only needed on the
  // locked path, and it is the only import in this file that touches the auth
  // endpoints.
  const { hasVerifiedTotp } = await import('./mfa')
  return { state: 'locked', hasAuthenticator: await hasVerifiedTotp() }
}

/** True when the viewer may read this project's data right now. */
export async function canReadProject(projectId: string): Promise<boolean> {
  const access = await projectAccess(projectId)
  return access.state === 'open' || access.state === 'unlocked'
}
