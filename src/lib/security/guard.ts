/**
 * The guard for API routes that take a project id in the BODY or the QUERY.
 *
 * The middleware gate can only see a project id in the PATH (/projects/<id>,
 * /api/projects/<id>). Plenty of routes here take one as `project_id` in a JSON
 * body or `?projectId=` instead — `/api/ai/brief`, `/api/ai/draft`,
 * `/api/documents`, `/api/updates` — and the gate is blind to every one of them.
 * This closes that, one route at a time, with the same answer the gate gives.
 *
 * Usage, as the first thing a handler does once it knows the id:
 *
 *   const denied = await requireProjectAccess(projectId)
 *   if (denied) return denied
 *
 * `null` means carry on. Anything else is the response to return as-is.
 */

import { NextResponse } from 'next/server'
import { projectAccess } from './request'

export async function requireProjectAccess(
  projectId: string | null | undefined
): Promise<NextResponse | null> {
  if (!projectId) return null

  const access = await projectAccess(projectId)
  switch (access.state) {
    case 'open':
    case 'unlocked':
      return null
    case 'locked':
      return NextResponse.json(
        {
          error: 'This project is protected. Unlock it with your authenticator first.',
          needsStepUp: true,
          needsEnrollment: !access.hasAuthenticator,
        },
        { status: 403 }
      )
    case 'denied':
      // Deliberately the same wording the role gate uses, and deliberately not
      // "protected" — someone who can never open it has no business learning
      // that the project exists, let alone that it is interesting.
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }
}

/**
 * The same check for a list of ids, for a route that can act on several at once.
 * Returns the first refusal; a request that names one protected project is
 * refused whole rather than quietly serving the rest, because a partial result
 * with no explanation is how a caller concludes the data is not there.
 */
export async function requireProjectAccessAll(
  projectIds: readonly (string | null | undefined)[]
): Promise<NextResponse | null> {
  for (const id of new Set(projectIds.filter(Boolean))) {
    const denied = await requireProjectAccess(id)
    if (denied) return denied
  }
  return null
}
