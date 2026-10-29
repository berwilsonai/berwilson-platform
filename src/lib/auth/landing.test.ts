import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_LANDING, ROLES, canAccessPage, landingFor } from './permissions'

/**
 * A landing page the role cannot open is an infinite redirect.
 *
 * ⚠ THE SHAPE THIS GUARDS. The middleware's role gate sends an unauthorized
 * page hit to `landingFor(role)`; if that destination is itself outside the
 * role's allowlist, the gate fires again on arrival and the reader never gets a
 * page. It is invisible to `tsc` (both sides are strings), invisible to the
 * build, and it only shows up as a browser that spins — for a role the two
 * admins never sign in as.
 *
 * It became a live risk on 2026-10-29, when the admin landing moved from
 * `/tasks` (reachable by four of five roles) to `/dashboard` (reachable by
 * exactly one, since every non-admin page prefix list is default-deny).
 */

test('every role lands somewhere it is actually allowed to be', () => {
  for (const role of ROLES) {
    const landing = landingFor(role)
    assert.ok(
      canAccessPage(role, landing),
      `${role} lands on ${landing} and cannot open it — the middleware would ` +
        'redirect on arrival and loop forever'
    )
  }
})

test('every role has a landing, and it is a real in-app path', () => {
  for (const role of ROLES) {
    const landing = landingFor(role)
    assert.ok(landing.startsWith('/'), `${role}'s landing must be an app path, got ${landing}`)
    assert.ok(!landing.startsWith('//'), `${role}'s landing must not be protocol-relative`)
    assert.notEqual(landing, '/', `${role} landing on / would redirect to itself`)
  }
})

test('the admin landing is the exported one, so `/` and the gate agree', () => {
  // src/app/page.tsx redirects to DEFAULT_LANDING directly rather than
  // resolving a role, because a non-admin is bounced before it renders. If
  // these two ever disagree, an admin's `/` and an admin's unauthorized hit go
  // to different pages.
  assert.equal(landingFor('admin'), DEFAULT_LANDING)
})

test('steel_sales lands inside its own single-destination world', () => {
  // The one role whose landing is NOT the shared default, named explicitly so
  // a future edit to the registry cannot quietly fold it back in: /steel is the
  // only prefix it can reach at all.
  assert.equal(landingFor('steel_sales'), '/steel')
  assert.equal(canAccessPage('steel_sales', '/tasks'), false)
})
