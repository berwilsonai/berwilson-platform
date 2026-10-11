/**
 * The one gate every MCP tool call passes through.
 *
 * ⚠ READ THIS BEFORE ADDING A TOOL. The assistant on the other end of this
 * server is OUTSIDE the box. §12: anything that leaves can never be unlocked
 * after the fact, so there is no step-up, no viewer, and no opt-out here — the
 * answer is always the absolute one.
 *
 * THE DIVISION OF LABOUR, which is the whole design:
 *   - SQL decides what EXISTS. `mcp_projects` and `mcp_tasks` carry the
 *     exclusion in their own WHERE clauses, so a protected project is not
 *     filtered out of a result — it was never in one. New code cannot widen
 *     that, because the predicate is not in the code.
 *   - This file decides WHO MAY ASK, and writes down what they got.
 *
 * That split exists because the platform's internal containment is applied
 * per-call-site by convention and three call sites had already been found
 * missing it. Convention is survivable inside the tailnet; it is not
 * survivable on a surface something external can reach.
 *
 * ⚠ AND IT IS STILL NOT A CUI CONTROL. A view is a confidentiality measure for
 * commercial work. CUI requires the data be unreachable by an external service
 * at all (§8, the GovCloud trigger) — not merely filtered on the way out.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createUntypedAdminClient } from '@/lib/supabase/admin'

/** Every tool that exists. A token's scopes are checked against this list. */
export const MCP_TOOLS = ['list_projects', 'get_project', 'list_tasks', 'search'] as const
export type McpTool = (typeof MCP_TOOLS)[number]

export function isMcpTool(name: string): name is McpTool {
  return (MCP_TOOLS as readonly string[]).includes(name)
}

export interface McpCaller {
  tokenId: string
  label: string
  scopes: string[]
}

export type AuthResult =
  | { ok: true; caller: McpCaller }
  | { ok: false; status: number; message: string }

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/**
 * Mint a credential. Returns the secret ONCE — only its hash is stored, so a
 * lost token is reissued rather than recovered.
 *
 * Deliberately short-lived by default. A bearer token lives in a cloud
 * assistant's configuration, which is the one place in this system holding a
 * credential we cannot see; the shorter its life the smaller that window.
 */
export async function mintToken(input: {
  label: string
  scopes: McpTool[]
  days?: number
  createdBy?: string
}): Promise<{ token: string; id: string; expiresAt: string }> {
  const raw = `bw_mcp_${randomBytes(32).toString('base64url')}`
  const expires = new Date(Date.now() + (input.days ?? 30) * 86_400_000).toISOString()

  const { data, error } = await createUntypedAdminClient()
    .from('mcp_tokens')
    .insert({
      token_sha256: hashToken(raw),
      label: input.label,
      scopes: input.scopes,
      expires_at: expires,
      created_by: input.createdBy ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Could not mint a token: ${error.message}`)
  return { token: raw, id: (data as { id: string }).id, expiresAt: expires }
}

/** Is the server answering at all? The kill switch, read per request. */
async function serverEnabled(): Promise<{ enabled: boolean; reason: string | null }> {
  const { data, error } = await createUntypedAdminClient()
    .from('mcp_runtime')
    .select('enabled, disabled_reason')
    .eq('id', true)
    .maybeSingle()

  // ⚠ FAILS CLOSED. An unreadable kill switch is not an open one.
  if (error || !data) {
    return { enabled: false, reason: 'the MCP runtime flag could not be read' }
  }
  const row = data as { enabled: boolean; disabled_reason: string | null }
  return { enabled: row.enabled, reason: row.disabled_reason }
}

/**
 * Authenticate a request.
 *
 * ⚠ NO EARLY RETURN BEFORE THE KILL SWITCH. The switch is checked first and
 * unconditionally, so turning the server off stops even a perfectly valid
 * token — which is what "instantly disable" has to mean.
 */
export async function authenticate(authHeader: string | null): Promise<AuthResult> {
  const live = await serverEnabled()
  if (!live.enabled) {
    return {
      ok: false,
      status: 503,
      // The stored reason is a sentence of its own, so no trailing period here.
      message: `The MCP server is switched off${live.reason ? ` — ${live.reason}` : '.'}`,
    }
  }

  const prefix = 'Bearer '
  if (!authHeader || !authHeader.startsWith(prefix)) {
    return { ok: false, status: 401, message: 'Send Authorization: Bearer <token>.' }
  }

  const presented = authHeader.slice(prefix.length).trim()
  if (!presented) return { ok: false, status: 401, message: 'Empty bearer token.' }

  const supabase = createUntypedAdminClient()
  const { data, error } = await supabase
    .from('mcp_tokens')
    .select('id, label, scopes, expires_at, revoked_at, token_sha256')
    .eq('token_sha256', hashToken(presented))
    .maybeSingle()

  // One message for every rejection. A token that is unknown, revoked and
  // expired must be indistinguishable from the outside, or the error text
  // becomes an oracle for probing which tokens once existed.
  const reject: AuthResult = { ok: false, status: 401, message: 'Invalid token.' }

  if (error || !data) return reject
  const row = data as {
    id: string
    label: string
    scopes: string[] | null
    expires_at: string
    revoked_at: string | null
    token_sha256: string
  }

  // The lookup already matched on the hash; this compares it again in constant
  // time so the code does not depend on the database's comparison for a
  // secret-dependent branch.
  const a = Buffer.from(row.token_sha256, 'utf8')
  const b = Buffer.from(hashToken(presented), 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return reject

  if (row.revoked_at) return reject
  if (new Date(row.expires_at).getTime() <= Date.now()) return reject

  // Fire-and-forget: a "last used" stamp must never fail a real call.
  void supabase
    .from('mcp_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id)
    .then(() => {})

  return { ok: true, caller: { tokenId: row.id, label: row.label, scopes: row.scopes ?? [] } }
}

export function hasScope(caller: McpCaller, tool: McpTool): boolean {
  return caller.scopes.includes(tool)
}

export interface AuditInput {
  caller: McpCaller | null
  tool: string
  args: unknown
  outcome: 'ok' | 'refused' | 'error'
  recordIds?: string[]
  withheld?: number
  detail?: string
  latencyMs?: number
}

/**
 * Write down what left the box.
 *
 * ⚠ EVERY CALL, INCLUDING REFUSALS — a blocked attempt is the more interesting
 * row. And the IDS, not the content: "what has this credential seen?" has to be
 * answerable later without this table becoming a second copy of the data.
 *
 * Grokbot's plan proposed skipping the content for the most sensitive tier,
 * which is backwards; the resolution here is to log identifiers for everything
 * rather than content for anything.
 *
 * Awaited, not fire-and-forget. An audit row that loses a race with the process
 * exiting is not an audit trail.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await createUntypedAdminClient()
      .from('mcp_audit')
      .insert({
        token_id: input.caller?.tokenId ?? null,
        token_label: input.caller?.label ?? null,
        tool: input.tool,
        arguments: (input.args ?? {}) as Record<string, unknown>,
        records_returned: input.recordIds?.length ?? 0,
        record_ids: input.recordIds ?? [],
        records_withheld: input.withheld ?? 0,
        outcome: input.outcome,
        detail: input.detail ?? null,
        latency_ms: input.latencyMs ?? null,
      })
  } catch (err) {
    // Never fail the caller on an audit write, but say so loudly in the log —
    // an audit trail with silent holes is worse than one that is known broken.
    console.error('[mcp/audit] COULD NOT WRITE AUDIT ROW:', err)
  }
}
