/**
 * The contact-role registry.
 *
 * One row per role. This is the ONLY place a role is defined — the directory
 * filter, the contact editor, the project Players picker, the extraction prompt
 * and the settings screen all read from here. Adding "Insurance Broker" is an
 * INSERT, not a deploy, exactly as adding a line of business is at
 * /settings/lead-categories.
 *
 * ⚠ IT REPLACES `PROJECT_PLAYER_ROLES` in src/lib/utils/constants.ts, which was
 * a hand-written array of 33 values that two components read and nothing else
 * did — 1 of 104 live project_players rows conformed to it (measured
 * 2026-10-21). That is §12's "a taxonomy written into a prompt is a second
 * schema and it drifts silently", in its worst form: the taxonomy was not even
 * in the prompt, so the model was never told the list existed.
 *
 * Server-only — it holds the service-role client, so it must never be imported
 * from a `'use client'` file (§12). Client components take roles as props; the
 * pure label/tone/grouping helpers they need live in
 * `src/lib/utils/contact-roles.ts`.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { ContactRoleView } from '@/lib/utils/contact-roles'
import { mapRoleText } from './role-mapping'

export interface ContactRole extends ContactRoleView {
  id: string
  /** Read to the extraction model verbatim as this role's definition. */
  extraction_hint: string | null
}

const COLUMNS = 'id, key, label, role_group, extraction_hint, sort_order, active, system'

/**
 * Process-lifetime cache, 60s.
 *
 * Same reasoning as the lead registry: roles are read on every directory
 * render, every player picker and every extraction, and change roughly never —
 * but `next start` loads the build at boot and holds it for days (§12), so a
 * permanent cache would mean an edit in settings did not take effect until the
 * next deploy. Writers call `invalidateContactRoleCache()` so their own change
 * is visible immediately.
 */
let cache: { rows: ContactRole[]; at: number } | null = null
const TTL_MS = 60_000

export function invalidateContactRoleCache(): void {
  cache = null
}

function normalize(raw: Record<string, unknown>): ContactRole {
  return {
    id: String(raw.id),
    key: String(raw.key),
    label: String(raw.label),
    role_group: String(raw.role_group),
    extraction_hint: (raw.extraction_hint as string | null) ?? null,
    sort_order: typeof raw.sort_order === 'number' ? raw.sort_order : 100,
    active: raw.active !== false,
    system: raw.system === true,
  }
}

/**
 * Every role, active and retired, in display order.
 *
 * Retired ones are included because they still LABEL contacts who hold them —
 * a role cannot be deleted while anybody has it (the FK has no delete rule), so
 * retiring is the only way to take one out of circulation, and the holders must
 * still render as something better than a bare key. Filter to `active` when
 * offering a CHOICE.
 */
export async function listContactRoles(): Promise<ContactRole[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows

  const { data, error } = await createAdminClient()
    .from('contact_roles')
    .select(COLUMNS)
    .order('sort_order', { ascending: true })

  // Checked rather than destructured past: a 42703 from a renamed column comes
  // back on `error` with `data` null, and silently returning an empty taxonomy
  // would make every contact roleless while reporting nothing (§12, 10-14).
  if (error) throw new Error(`Could not load contact roles: ${error.message}`)

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map(normalize)
  if (rows.length === 0) {
    throw new Error(
      'No contact roles are configured. The registry is seeded by migration ' +
        '20261021000004_contact_roles_seed.sql — apply it before using the directory.'
    )
  }

  cache = { rows, at: Date.now() }
  return rows
}

export async function listActiveContactRoles(): Promise<ContactRole[]> {
  return (await listContactRoles()).filter((r) => r.active)
}

export async function contactRolesByKey(): Promise<Map<string, ContactRole>> {
  return new Map((await listContactRoles()).map((r) => [r.key, r]))
}

/** The whole registry as a client component wants it — no extraction hints. */
export async function contactRoleViews(): Promise<ContactRoleView[]> {
  return (await listContactRoles()).map(({ key, label, role_group, sort_order, active, system }) => ({
    key,
    label,
    role_group,
    sort_order,
    active,
    system,
  }))
}

/**
 * Coerce whatever a model or a form said into a real role key, or null.
 *
 * Null rather than a fallback key on purpose. A lead with no recognised route
 * still has to go SOMEWHERE, which is why `resolveRoute` coerces to `unknown`;
 * a role is an assertion about a person, and "we could not categorise this one"
 * must stay distinguishable from "this one is a Vendor". The prose the model
 * wrote survives in `project_players.role` either way.
 *
 * Accepts the key, the label, or either with spaces/hyphens for underscores —
 * the three spellings a model actually produces when shown this vocabulary.
 */
export async function resolveRoleKey(value: unknown): Promise<string | null> {
  if (typeof value !== 'string') return null
  const needle = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!needle) return null

  const roles = await listContactRoles()
  const byKey = roles.find((r) => r.key === needle)
  if (byKey) return byKey.active ? byKey.key : null

  const byLabel = roles.find(
    (r) => r.label.toLowerCase().replace(/[\s-]+/g, '_') === needle
  )
  return byLabel?.active ? byLabel.key : null
}

/**
 * The vocabulary as the extraction prompt sees it.
 *
 * GENERATED FROM THE SAME ROWS THE COLUMN REFERENCES (§12) — the one thing that
 * stops the prompt becoming a second schema. A role added in settings is in the
 * next extraction; a role retired there disappears from it.
 */
export async function roleVocabularyForPrompt(): Promise<string> {
  const roles = await listActiveContactRoles()
  const lines: string[] = []
  let group = ''
  for (const r of roles) {
    if (r.role_group !== group) {
      group = r.role_group
      lines.push(`\n${group}:`)
    }
    lines.push(`- ${r.key} (${r.label})${r.extraction_hint ? ` — ${r.extraction_hint}` : ''}`)
  }
  return lines.join('\n').trim()
}

/**
 * The ONE place a free-text role becomes a registry key.
 *
 * Every writer of `project_players` goes through this — the mail sweep, the
 * proposal confirm, the meeting confirm, the profile intake. §12: "A shared
 * renderer wired to one surface is worse than no shared renderer"; the reason
 * the old 33-value vocabulary reached 1 row in 104 is that each writer decided
 * for itself and none of them knew the list existed.
 *
 * Two passes, in order:
 *   1. `resolveRoleKey` — the model answered with a key or an exact label,
 *      which is what the prompt now asks for.
 *   2. `mapRoleText`    — the prose rules measured against the real corpus,
 *      which catch "Broker — 4% fee" and "Target endorser / Geospatial
 *      Engineer".
 * Null when neither is sure. The prose is stored on `role` regardless.
 */
export async function categorizePlayerRole(text: string | null | undefined): Promise<string | null> {
  const direct = await resolveRoleKey(text)
  if (direct) return direct
  const guessed = mapRoleText(text)
  if (!guessed) return null
  // A rule may name a role a human has since retired or renamed; the registry
  // is the authority, not the rule table.
  const role = (await contactRolesByKey()).get(guessed)
  return role?.active ? role.key : null
}

// ─── Reading and writing what somebody is to US ──────────────────────────────

/** Role keys held by one contact. */
export async function getPartyRoles(partyId: string): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from('party_roles')
    .select('role_key')
    .eq('party_id', partyId)
  if (error) throw new Error(`Could not load roles for contact: ${error.message}`)
  return (data ?? []).map((r) => r.role_key)
}

/**
 * Role keys for MANY contacts at once, as a map.
 *
 * ⚠ Paginated. PostgREST truncates at 1000 rows silently (§12), and this table
 * is one row per contact per role — 180 contacts averaging two roles is already
 * a third of the cap, and nothing would report the loss.
 */
export async function partyRoleMap(partyIds?: string[]): Promise<Map<string, string[]>> {
  const db = createAdminClient()
  const out = new Map<string, string[]>()
  const PAGE = 1000

  // Chunked separately from the page size: a filter rides in the query string,
  // so `.in()` with 1000 uuids is a 37KB GET that Kong refuses (§12).
  const idChunks: (string[] | null)[] = partyIds
    ? Array.from({ length: Math.ceil(partyIds.length / 200) }, (_, i) =>
        partyIds.slice(i * 200, i * 200 + 200)
      )
    : [null]

  for (const chunk of idChunks) {
    if (chunk && chunk.length === 0) continue
    for (let from = 0; ; from += PAGE) {
      let q = db.from('party_roles').select('party_id, role_key').range(from, from + PAGE - 1)
      if (chunk) q = q.in('party_id', chunk)
      const { data, error } = await q
      if (error) throw new Error(`Could not load contact roles: ${error.message}`)
      for (const row of data ?? []) {
        const list = out.get(row.party_id)
        if (list) list.push(row.role_key)
        else out.set(row.party_id, [row.role_key])
      }
      if ((data?.length ?? 0) < PAGE) break
    }
  }
  return out
}

/**
 * Set a contact's roles to exactly this list.
 *
 * Diffed rather than delete-then-insert: the table is audited, and wiping six
 * rows to rewrite five of them would put five spurious deletes and five
 * spurious inserts in the append-only log every time somebody added one role.
 *
 * The caller passes an ACTOR client. §12: "User-initiated mutations on tracked
 * tables use actorAdminClient(), or the activity log says 'system'" — and
 * making a table tracked means auditing every write path to it in the same
 * change.
 */
export async function setPartyRoles(
  db: ReturnType<typeof createAdminClient>,
  partyId: string,
  keys: string[]
): Promise<{ added: string[]; removed: string[] }> {
  const valid = new Set((await listContactRoles()).map((r) => r.key))
  const wanted = [...new Set(keys.filter((k) => valid.has(k)))]
  const current = await getPartyRoles(partyId)

  const added = wanted.filter((k) => !current.includes(k))
  const removed = current.filter((k) => !wanted.includes(k))

  if (added.length > 0) {
    const { error } = await db
      .from('party_roles')
      .insert(added.map((role_key) => ({ party_id: partyId, role_key })))
    if (error) throw new Error(`Could not add roles: ${error.message}`)
  }
  if (removed.length > 0) {
    const { error } = await db
      .from('party_roles')
      .delete()
      .eq('party_id', partyId)
      .in('role_key', removed)
    if (error) throw new Error(`Could not remove roles: ${error.message}`)
  }
  return { added, removed }
}
