/**
 * Contact aliases — the other names one person is known by.
 *
 * Real correspondence spells people inconsistently. "Jerren Davis" in a
 * conversation is `jarenldavis@gmail.com` in the mail; a card says "Bob", the
 * contract says "Robert". Every one of those has to resolve to one contact, or
 * the directory grows a duplicate per spelling.
 *
 * Uniqueness is on lower(alias). Until 2026-09-24 that lived only in an
 * EXPRESSION index (`uq_contact_alias`), which PostgREST's
 * `onConflict: 'alias'` could not name — so every write through
 * /api/parties/associate failed with "there is no unique or exclusion
 * constraint matching the ON CONFLICT specification". The generated
 * `alias_key` column now carries a real constraint, and this is the one
 * function that writes the table.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Aliases not worth storing: they identify nobody. */
function isUseless(alias: string, canonicalName: string): boolean {
  const a = alias.trim().toLowerCase()
  if (a.length < 3) return true
  if (a === canonicalName.trim().toLowerCase()) return true
  // An email address is already matched directly on parties.email.
  if (a.includes('@')) return true
  // A single given name is too ambiguous to map globally — two Erics resolve
  // to whichever was written last, which is worse than no alias at all.
  if (!/\s/.test(a)) return true
  return false
}

/**
 * Point an alias at a contact, replacing any existing mapping for that spelling.
 *
 * Returns the aliases actually written. Never throws: an alias is a convenience
 * and must not fail the contact it was going to help.
 */
export async function upsertAliases(
  // Deliberately loose: callers hold both the generated-types client and the
  // untyped sweep client, and `contact_aliases` predates the generated types.
  db: SupabaseClient,
  partyId: string,
  canonicalName: string,
  aliases: readonly string[]
): Promise<string[]> {
  const wanted = [...new Set(
    aliases
      .map((a) => (a ?? '').trim())
      .filter((a) => a && !isUseless(a, canonicalName))
      .map((a) => a.slice(0, 200))
  )]
  if (wanted.length === 0) return []

  const written: string[] = []
  for (const alias of wanted) {
    const { error } = await db
      .from('contact_aliases')
      .upsert({ alias, party_id: partyId }, { onConflict: 'alias_key' })
    if (error) {
      console.error(`[aliases] could not map "${alias}" → ${partyId}:`, error.message)
      continue
    }
    written.push(alias)
  }
  return written
}
