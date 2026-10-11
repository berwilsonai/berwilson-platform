/**
 * Manage MCP credentials and the kill switch.
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/mcp-token.mts <command> [args]
 *
 * Commands:
 *   list                              every credential and its state
 *   mint "<label>" [days] [tools…]    create one, printed ONCE
 *   revoke <id>                       stop it immediately
 *   on | off ["reason"]                the global kill switch
 *   audit [n]                         the last n tool calls (default 20)
 *
 * ⚠ THE SECRET IS PRINTED ONCE AND NEVER STORED. Only its sha256 goes into the
 * database, the same discipline as `commitment_action_tokens`. A lost token is
 * revoked and reissued, never recovered — if this script could print it again,
 * so could anything else with database access.
 *
 * Default life is 30 days, deliberately short: a bearer token lives in a cloud
 * assistant's configuration, the one place in this system holding a credential
 * nobody here can see or rotate.
 */

import { createUntypedAdminClient } from '@/lib/supabase/admin'
import { MCP_TOOLS, mintToken, type McpTool } from '@/lib/mcp/policy'

const db = createUntypedAdminClient()
const [command, ...rest] = process.argv.slice(2)

function usage(): never {
  console.log(`
Commands:
  list
  mint "<label>" [days] [tool …]     tools default to all of: ${MCP_TOOLS.join(', ')}
  revoke <id>
  on
  off ["reason"]
  audit [n]
`)
  process.exit(1)
}

switch (command) {
  case 'list': {
    const { data, error } = await db
      .from('mcp_tokens')
      .select('id, label, scopes, expires_at, revoked_at, last_used_at, created_at')
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as {
      id: string
      label: string
      scopes: string[] | null
      expires_at: string
      revoked_at: string | null
      last_used_at: string | null
    }[]

    if (rows.length === 0) {
      console.log('No MCP credentials exist.')
      break
    }
    for (const r of rows) {
      const expired = new Date(r.expires_at).getTime() <= Date.now()
      const state = r.revoked_at ? 'REVOKED' : expired ? 'EXPIRED' : 'live'
      console.log(
        `${state.padEnd(8)} ${r.id}  ${r.label}\n` +
          `         scopes: ${(r.scopes ?? []).join(', ') || '(none — cannot call anything)'}\n` +
          `         expires: ${r.expires_at}   last used: ${r.last_used_at ?? 'never'}`
      )
    }
    break
  }

  case 'mint': {
    const label = rest[0]
    if (!label) usage()
    const days = rest[1] && /^\d+$/.test(rest[1]) ? Number(rest[1]) : 30
    const named = (rest[1] && /^\d+$/.test(rest[1]) ? rest.slice(2) : rest.slice(1)) as string[]

    // An unknown tool name must fail here rather than quietly minting a token
    // that cannot call it — a scope typo would otherwise surface as a tool the
    // assistant can see but never use.
    const bad = named.filter((t) => !(MCP_TOOLS as readonly string[]).includes(t))
    if (bad.length) {
      console.error(`Unknown tool(s): ${bad.join(', ')}\nValid: ${MCP_TOOLS.join(', ')}`)
      process.exit(1)
    }
    const scopes = (named.length ? named : [...MCP_TOOLS]) as McpTool[]

    const { token, id, expiresAt } = await mintToken({ label, scopes, days })
    console.log(`
Credential created.

  id       ${id}
  label    ${label}
  scopes   ${scopes.join(', ')}
  expires  ${expiresAt}  (${days} days)

  Authorization: Bearer ${token}

⚠ That is the only time the token is shown. Store it in the assistant's config
  now; it cannot be printed again.
`)
    break
  }

  case 'revoke': {
    const id = rest[0]
    if (!id) usage()
    const { error, count } = await db
      .from('mcp_tokens')
      .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
      .eq('id', id)
      .is('revoked_at', null)
    if (error) throw new Error(error.message)
    console.log(count ? `Revoked ${id}. It stops working on the next request.` : 'No live credential with that id.')
    break
  }

  case 'on':
  case 'off': {
    const enabled = command === 'on'
    const { error } = await db
      .from('mcp_runtime')
      .update({
        enabled,
        disabled_reason: enabled ? null : (rest[0] ?? 'Switched off by hand.'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', true)
    if (error) throw new Error(error.message)
    console.log(
      enabled
        ? 'MCP server ON. Live credentials can now call tools.'
        : `MCP server OFF${rest[0] ? ` — ${rest[0]}` : ''}. Every request is refused, valid token or not.`
    )
    break
  }

  case 'audit': {
    const n = rest[0] && /^\d+$/.test(rest[0]) ? Number(rest[0]) : 20
    const { data, error } = await db
      .from('mcp_audit')
      .select('created_at, token_label, tool, outcome, records_returned, records_withheld, detail, latency_ms')
      .order('created_at', { ascending: false })
      .limit(n)
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as {
      created_at: string
      token_label: string | null
      tool: string
      outcome: string
      records_returned: number
      records_withheld: number
      detail: string | null
      latency_ms: number | null
    }[]

    if (rows.length === 0) {
      console.log('Nothing has called the MCP server yet.')
      break
    }
    for (const r of rows) {
      console.log(
        `${r.created_at}  ${r.outcome.padEnd(7)} ${r.tool.padEnd(14)} ` +
          `${r.records_returned} returned, ${r.records_withheld} withheld  ` +
          `[${r.token_label ?? 'no token'}]${r.latency_ms ? ` ${r.latency_ms}ms` : ''}` +
          (r.detail ? `\n    ${r.detail}` : '')
      )
    }
    break
  }

  default:
    usage()
}
