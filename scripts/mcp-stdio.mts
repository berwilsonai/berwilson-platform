/**
 * The same MCP tools, over stdio instead of HTTP. No listener, no open port.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/mcp-stdio.mts
 *
 * WHY THIS EXISTS. Grok Bot's connectors run in its cloud, so they cannot
 * reach a tailnet-only URL — which leaves two options: expose the HTTP endpoint
 * publicly, or hand the client a LOCAL PROCESS to talk to. A stdio server is
 * strictly the safer half of that choice: the transport is a pipe, so there is
 * nothing on the network to find, nothing to rate-limit, and no bearer token
 * living in somebody else's configuration.
 *
 * It is also immediately useful to the MCP clients already on this machine —
 * Cursor, LM Studio and Claude Desktop all read an `mcp.json` and all run stdio
 * servers locally.
 *
 * ⚠ IT IS STILL AN EGRESS PATH. A local pipe does not make the data local: if
 * the client reasons in a cloud, the tool RESULTS go up exactly as they would
 * over HTTP. So this honours the same two controls as the route — the global
 * kill switch and the append-only audit — and reads the same two views, which
 * are where containment actually lives.
 *
 * ⚠ THERE IS DELIBERATELY NO TOKEN. The credential is the ability to run this
 * process at all: anything that can launch it can already read `.env.local` and
 * query the database directly. A token here would be security theatre, and
 * worse, it would imply a boundary that is not there.
 */

import { createInterface } from 'node:readline'
import { audit, isMcpTool, type McpCaller } from '@/lib/mcp/policy'
import { TOOL_SCHEMAS, runTool } from '@/lib/mcp/tools'
import { createUntypedAdminClient } from '@/lib/supabase/admin'

const PROTOCOL_VERSION = '2025-06-18'

/**
 * Who the audit records. Not a real credential — see the header — but the
 * label has to say which transport it was, or the audit cannot tell a cloud
 * connector's call from a local editor's.
 */
const CALLER: McpCaller = {
  tokenId: '00000000-0000-0000-0000-000000000000',
  label: 'stdio (local process)',
  scopes: TOOL_SCHEMAS.map((t) => t.name),
}

/** The kill switch governs every transport, not just the HTTP one. */
async function enabled(): Promise<{ ok: boolean; reason: string | null }> {
  const { data, error } = await createUntypedAdminClient()
    .from('mcp_runtime')
    .select('enabled, disabled_reason')
    .eq('id', true)
    .maybeSingle()
  if (error || !data) return { ok: false, reason: 'the MCP runtime flag could not be read' }
  const row = data as { enabled: boolean; disabled_reason: string | null }
  return { ok: row.enabled, reason: row.disabled_reason }
}

type Id = string | number | null

function send(payload: Record<string, unknown>): void {
  // One JSON object per line, which is what every stdio MCP client expects.
  // ⚠ NOTHING ELSE MAY EVER BE WRITTEN TO STDOUT — a stray console.log is
  // indistinguishable from a malformed frame and kills the session. Diagnostics
  // go to stderr, which the client shows in its own log.
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function ok(id: Id, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id: Id, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

process.stderr.write('[mcp-stdio] ready\n')

const rl = createInterface({ input: process.stdin })

for await (const line of rl) {
  const raw = line.trim()
  if (!raw) continue

  let msg: { id?: Id; method?: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(raw)
  } catch {
    fail(null, -32700, 'Parse error.')
    continue
  }

  const id: Id = msg.id ?? null
  const method = msg.method ?? ''
  const params = msg.params ?? {}

  // A notification has no id and must receive no reply at all — answering one
  // is a protocol error that some clients treat as fatal.
  const isNotification = msg.id === undefined

  try {
    switch (method) {
      case 'initialize': {
        const live = await enabled()
        ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'ber-wilson-crm', version: '1.0.0' },
          instructions:
            'Read-only access to Ber Wilson projects and tasks. Confidential projects are excluded in the database itself and cannot be reached through any tool here. When a response reports records withheld, do not describe the result as complete.' +
            (live.ok ? '' : ` ⚠ The server is currently switched off${live.reason ? ` — ${live.reason}` : ''}, so every tool call will refuse.`),
        })
        break
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
        break

      case 'ping':
        if (!isNotification) ok(id, {})
        break

      case 'tools/list':
        ok(id, { tools: TOOL_SCHEMAS })
        break

      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : ''
        const args = (params.arguments ?? {}) as Record<string, unknown>
        const started = Date.now()

        const live = await enabled()
        if (!live.ok) {
          await audit({
            caller: CALLER,
            tool: name || '(none)',
            args,
            outcome: 'refused',
            detail: `switched off: ${live.reason ?? 'no reason given'}`,
          })
          ok(id, {
            content: [
              {
                type: 'text',
                text: `The Ber Wilson MCP server is switched off${live.reason ? ` — ${live.reason}` : ''}. Nothing can be read until it is turned back on.`,
              },
            ],
            isError: true,
          })
          break
        }

        if (!isMcpTool(name)) {
          await audit({ caller: CALLER, tool: name || '(none)', args, outcome: 'refused', detail: 'unknown tool' })
          fail(id, -32601, `No such tool: ${name || '(none)'}`)
          break
        }

        const out = await runTool(name, args)
        await audit({
          caller: CALLER,
          tool: name,
          args,
          outcome: 'ok',
          recordIds: out.recordIds,
          withheld: out.withheld,
          latencyMs: Date.now() - started,
        })
        ok(id, { content: [{ type: 'text', text: JSON.stringify(out.payload, null, 2) }] })
        break
      }

      default:
        if (!isNotification) fail(id, -32601, `Unsupported method: ${method || '(none)'}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[mcp-stdio] ${method} failed: ${message}\n`)
    await audit({ caller: CALLER, tool: method, args: params, outcome: 'error', detail: message })
    if (!isNotification) {
      // A tool-level error, so the client can retry rather than ending the
      // session over one bad lookup.
      ok(id, { content: [{ type: 'text', text: `That lookup failed: ${message}` }], isError: true })
    }
  }
}
