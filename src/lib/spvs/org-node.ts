/**
 * The org-chart snapshot kept on a vehicle.
 *
 * In src/lib rather than beside a route because both the create and the patch
 * need it, and a route module is not a library — importing one route handler
 * from another is how a shared helper ends up with two copies.
 */

import { spvDb } from './db'

/**
 * Copy the org node's name onto the vehicle.
 *
 * ⚠ THE SNAPSHOT IS RESOLVED SERVER-SIDE, NEVER ACCEPTED FROM THE BODY, which
 * is why `org_node_name` is absent from the whitelist: a client that could set
 * it could make a vehicle claim to be an entity it is not. The reason it exists
 * at all is the one src/lib/governance/registers.ts gives — the org chart is a
 * board people drag boxes around on, and the FK is `on delete set null`, so
 * without the snapshot the deal loses the NAME of its own vehicle the moment
 * someone tidies the chart.
 *
 * Clearing the link clears the name with it.
 */
export async function resolveOrgNodeName(
  orgNodeId: unknown
): Promise<{ value: Record<string, unknown> } | { error: string }> {
  if (orgNodeId === undefined) return { value: {} }
  if (orgNodeId === null) return { value: { org_node_name: null } }
  if (typeof orgNodeId !== 'string') return { error: 'org_node_id must be an id' }

  const { data, error } = await spvDb()
    .from('org_nodes')
    .select('name')
    .eq('id', orgNodeId)
    .maybeSingle()
  if (error) return { error: `Could not read the org chart: ${error.message}` }
  if (!data) {
    return {
      error:
        'That entity is not in the org chart. Pick another, or leave the link empty until the vehicle is formed.',
    }
  }
  return { value: { org_node_name: (data as { name: string }).name } }
}
