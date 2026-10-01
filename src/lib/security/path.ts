/**
 * Pulling a project id out of a request path, for the middleware gate.
 *
 * Pure and dependency-free on purpose: middleware cannot import anything that
 * reaches for cookies or the service-role client, and this has to be cheap
 * enough to run on every request.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The project id a path addresses, or null.
 *
 * Matches `/projects/<uuid>…` and `/api/projects/<uuid>…` only. `/projects`,
 * `/projects/new` and `/api/projects/parents` all answer null because their
 * second segment is not a uuid — which is also why this tests the SHAPE rather
 * than excluding known words: a new non-uuid route added under /projects next
 * year must not accidentally become a project id.
 */
export function projectIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] === 'projects' && segments[1] && UUID.test(segments[1])) return segments[1]
  if (
    segments[0] === 'api' &&
    segments[1] === 'projects' &&
    segments[2] &&
    UUID.test(segments[2])
  ) {
    return segments[2]
  }
  return null
}

/**
 * The rewrite target that serves the unlock prompt in place of a project.
 *
 * A SIBLING of /projects/[id], never a child of it. The project layout fetches
 * the name, the client, the stage and ten row counts before rendering its tabs —
 * so a locked page nested under [id] would print most of what the lock exists to
 * withhold, and run ten queries to do it. The id travels as a search param; the
 * browser's address bar is untouched, because a rewrite is server-side.
 */
export const LOCKED_PATH = '/projects/locked'

export function lockedPathFor(): string {
  return LOCKED_PATH
}

export function isLockedPath(pathname: string): boolean {
  return pathname === LOCKED_PATH
}

/**
 * API paths under a locked project that must stay reachable.
 *
 * `/confidential` is the one that matters: blocking it would make protection a
 * one-way door, because the route that removes the flag lives underneath the
 * project it protects. It carries its own step-up check, which is stricter than
 * this gate (it demands a LIVE step-up, not merely an eligible viewer).
 */
export function isLockExemptApiPath(pathname: string): boolean {
  return pathname.endsWith('/confidential')
}
