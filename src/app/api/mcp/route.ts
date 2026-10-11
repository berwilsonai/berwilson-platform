/**
 * POST /api/mcp — Model Context Protocol, Streamable HTTP transport.
 *
 * WHAT THIS IS FOR. An external assistant (Grok, Claude, anything speaking MCP)
 * can call a small set of read-only tools over HTTPS with a bearer token,
 * instead of being given a browser session, a mailbox, or the run of the
 * machine. It is the safe shape of "connect my assistant to the CRM": the
 * assistant gets typed answers, never a screen and never a credential to
 * anything else.
 *
 * ⚠ IT IS TAILNET-ONLY AND STAYS THAT WAY UNTIL SOMEBODY DECIDES OTHERWISE.
 * Nothing here opens a public port. Reaching this from a cloud assistant needs
 * a deliberate `tailscale funnel` (or a tunnel terminating on a DIFFERENT host),
 * and that decision has consequences this file cannot contain: a permanently
 * internet-reachable endpoint on the production box, guarded by one bearer
 * token, on a host that also holds the mail refresh tokens and the service-role
 * key. `deploy/tailnet-setup.sh` asserts TWO listeners; a third is outside the
 * only check that watches for them disappearing. See `deploy/mcp-server.md`.
 *
 * ⚠ AND IT IS NOT CLEARED FOR CUI. §8's GovCloud trigger is unchanged. The
 * views behind this are a confidentiality measure for commercial work; CUI
 * requires that the data be unreachable by an external service at all, not
 * filtered on the way out. Do not point this at a project under a DoD contract.
 *
 * WHY NO SDK. `@modelcontextprotocol/sdk` would be a new dependency to carry
 * for what is, over plain HTTP, a few JSON-RPC envelopes. §11: no complexity
 * without demonstrated need.
 */

import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { audit, authenticate, hasScope, isMcpTool, type McpCaller } from '@/lib/mcp/policy'
import { TOOL_SCHEMAS, runTool } from '@/lib/mcp/tools'

export const maxDuration = 60

/** The spec revision these envelopes are written against. */
const PROTOCOL_VERSION = '2025-06-18'

type Id = string | number | null

function result(id: Id, payload: unknown) {
  return Response.json({ jsonrpc: '2.0', id, result: payload })
}

function rpcError(id: Id, code: number, message: string, httpStatus = 200) {
  // JSON-RPC errors ride a 200 by convention so the client parses the envelope
  // rather than reporting a transport failure. Transport-level rejections
  // (no token, server off) use a real HTTP status instead.
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { status: httpStatus })
}

interface RpcRequest {
  jsonrpc?: string
  id?: Id
  method?: string
  params?: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  /**
   * ⚠ AN IP RATE LIMIT FIRST — IT IS THE ONLY THING AHEAD OF THE GUARD.
   *
   * Nothing is READ before authentication; this only counts requests and can
   * refuse. §12: `matchesPrefix` in middleware.ts is not method-aware, so
   * allowlisting `/api/mcp` opens every verb under it, which is why the
   * handler authenticates unconditionally below and there is no GET here.
   *
   * `authenticate()` reads the kill switch before it looks at the token, which
   * is the right order for security and the wrong order for load: an
   * unauthenticated flood would be one database query per request. That is
   * harmless on a tailnet-only endpoint and is a denial-of-service surface the
   * moment this is reachable from the open internet.
   *
   * Keyed on the forwarded client address because `tailscale serve` rewrites
   * Host to localhost — the same reason `publicOrigin()` exists (§12). An
   * absent header falls back to one shared bucket, which is the safe direction:
   * it throttles rather than exempting.
   */
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const ipLimit = checkRateLimit(`mcp-ip:${clientIp}`, 30, 60_000)
  if (!ipLimit.allowed) {
    // Deliberately no audit row: the point is to stop doing work, and an audit
    // write is work. The rate limiter is itself the record.
    return Response.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
    )
  }

  const auth = await authenticate(request.headers.get('authorization'))
  if (!auth.ok) {
    await audit({
      caller: null,
      tool: '(transport)',
      args: {},
      outcome: 'refused',
      detail: auth.message,
    })
    return Response.json({ error: auth.message }, { status: auth.status })
  }
  const caller: McpCaller = auth.caller

  // Per credential, not per IP: the IP belongs to a cloud provider and is
  // shared with everything else it runs.
  const rl = checkRateLimit(`mcp:${caller.tokenId}`, 60, 60_000)
  if (!rl.allowed) {
    await audit({
      caller,
      tool: '(transport)',
      args: {},
      outcome: 'refused',
      detail: 'rate limited',
    })
    return Response.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    )
  }

  let body: RpcRequest
  try {
    body = (await request.json()) as RpcRequest
  } catch {
    return rpcError(null, -32700, 'Parse error: body is not JSON.', 400)
  }

  const id: Id = body.id ?? null
  const method = typeof body.method === 'string' ? body.method : ''
  const params = body.params ?? {}

  switch (method) {
    case 'initialize':
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ber-wilson-crm', version: '1.0.0' },
        instructions:
          'Read-only access to Ber Wilson projects and tasks. Confidential projects are excluded in the database itself and are not visible through any tool here. When a response reports records withheld, do not describe the result as complete.',
      })

    // A notification carries no id and must get no result body.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 })

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, {
        // Only the tools this credential may actually call. A tool the token
        // cannot use has no business appearing in its list — advertising it
        // would have the assistant plan around a call that always fails.
        tools: TOOL_SCHEMAS.filter((t) => hasScope(caller, t.name)),
      })

    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const started = Date.now()

      if (!isMcpTool(name)) {
        await audit({ caller, tool: name || '(none)', args, outcome: 'refused', detail: 'unknown tool' })
        return rpcError(id, -32601, `No such tool: ${name || '(none)'}`)
      }

      if (!hasScope(caller, name)) {
        await audit({ caller, tool: name, args, outcome: 'refused', detail: 'out of scope' })
        // Same wording as an unknown tool would give, so the scope list cannot
        // be mapped by probing.
        return rpcError(id, -32601, `No such tool: ${name}`)
      }

      try {
        const out = await runTool(name, args)
        await audit({
          caller,
          tool: name,
          args,
          outcome: 'ok',
          recordIds: out.recordIds,
          withheld: out.withheld,
          latencyMs: Date.now() - started,
        })
        return result(id, {
          content: [{ type: 'text', text: JSON.stringify(out.payload, null, 2) }],
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await audit({
          caller,
          tool: name,
          args,
          outcome: 'error',
          detail: message,
          latencyMs: Date.now() - started,
        })
        console.error(`[api/mcp] ${name} failed:`, message)
        // `isError` keeps this a tool-level failure the assistant can read and
        // retry, rather than a protocol error that ends the session.
        return result(id, {
          content: [{ type: 'text', text: `That lookup failed: ${message}` }],
          isError: true,
        })
      }
    }

    default:
      return rpcError(id, -32601, `Unsupported method: ${method || '(none)'}`)
  }
}
