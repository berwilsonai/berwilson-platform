-- Remove the MCP server. The platform works exclusively off the local LLM.
--
-- WHY IT IS BEING REMOVED RATHER THAN LEFT DORMANT. It was built on 2026-10-11
-- to give an external assistant (Grok Bot) a narrow, audited door instead of the
-- run of the machine. The day it was finished, Grok Bot reported that its
-- connectors execute in Anysphere's cloud and therefore cannot reach a
-- tailnet-only URL — which reduced the options to opening a public port on the
-- production box or handing the client a local process. Richard's decision was
-- neither: work exclusively off the local LLM.
--
-- That leaves the whole surface with no consumer, and §11 is explicit that
-- features are not pre-built for future phases while the golden rule forbids
-- complexity without demonstrated need. A dormant MCP server is worse than no
-- MCP server: it carries a credential table, a public-route exception in
-- middleware, and a standing invitation to be switched on by someone who has
-- not read why it was switched off. The same reasoning retired the Equity and
-- Portfolio modules (§9), and that entry's standing instruction applies here
-- too: if an external assistant is ever wanted again, build it fresh against
-- the requirements of that day rather than resurrecting this.
--
-- ⚠ NOTHING EXTERNAL EVER CONNECTED. The 14 rows in `mcp_audit` are this
-- session's own verification traffic over localhost and the tailnet; both
-- tokens were issued to test the thing and one was already revoked. The data
-- is backed up to ~/Backups/berwilson/mcp-tables-removed-<stamp>.sql, read
-- back, and verified at 14 audit rows and 2 token rows before this ran.
--
-- WHAT IS DELIBERATELY KEPT, because none of it was ever about Grok Bot:
--   * the egress guard on outbound web-research queries (src/lib/security/egress.ts)
--   * the five containment fixes to the digest, Pepper's note, Drive publish,
--     proposals intake and research.ts
--   * local voice (whisper + browser WAV + on-device speech)
--   * the local iMessage reading layer
-- Those are platform security and local capability; they stand on their own.

-- The views first: they depend on `projects` and `tasks`, nothing depends on
-- them, and dropping them is what actually closes the exposed surface.
drop view if exists mcp_tasks;
drop view if exists mcp_projects;

-- `mcp_audit.token_id` references `mcp_tokens`, so order matters here.
drop table if exists mcp_audit;
drop table if exists mcp_tokens;
drop table if exists mcp_runtime;
