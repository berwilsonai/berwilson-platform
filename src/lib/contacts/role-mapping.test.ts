import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { ROLE_RULES, mapRoleText, travelsToContact, DEAL_SCOPED_ROLES } from './role-mapping'

/**
 * ⚠ THE ORDERING IS THE DESIGN, so these are the cases that prove it.
 *
 * Each one is a real string from `project_players` on 2026-10-21, and each
 * would reach the WRONG role under a different ordering of ROLE_RULES. A test
 * that only checked "Lender" → lender would pass under any ordering and so
 * would prove nothing (§12 — a worked example whose figures coincide cannot
 * distinguish two readings of the rule it illustrates).
 */
test('a more specific rule wins over the general one it contains', () => {
  // Would be `owner` if the anchored owner rule ran first.
  assert.equal(mapRoleText('Owner of the 5,000-acre Myton site; partner on Antelope campus'), 'land_owner')
  assert.equal(mapRoleText('External Partner / Land Owner'), 'land_owner')
  // Would be `land_owner` or `owner`; the seller is the operative fact.
  assert.equal(mapRoleText('Seller / Portfolio Owner'), 'seller')
  // Would be `endorser` if endorser ran first.
  assert.equal(mapRoleText('Academic partner / Endorser organization'), 'academic_partner')
  // Would be `agency_staff` on the word "Liaison".
  assert.equal(mapRoleText('GridEdge Introducer/Liaison'), 'referral_source')
  // …but a liaison with no introducer in it still reaches the agency.
  assert.equal(mapRoleText('Yukon AG Liaison'), 'agency_staff')
  // Would be `general_contractor` on the word "Contractor".
  assert.equal(mapRoleText('Contractor / Prefab steel manufacturer'), 'steel_fabricator')
})

test('AMBIGUITY MEANS NO MATCH', () => {
  // §12. Every one of these was read and deliberately left uncategorised: the
  // prose stays on `role`, and an uncategorised row is visibly uncategorised
  // where a mis-categorised one answers for the person until somebody notices.
  for (const text of [
    'Transaction lead (Zenthium) / data room owner',
    'Participant Royalty Owner',
    'Investment Target Company',
    'Proposing Company',
    'Commercial underwriting and risk analysis for development sites',
    'Coordinating customized letters of support from VIPs',
    'Stockton Public Safety Provider',
    'Project lead / CEO driving development, capital formation, and federal submissions',
  ]) {
    assert.equal(mapRoleText(text), null, `"${text}" should not have been categorised`)
  }
})

test('`owner` is anchored, and `fundraiser` is a whole word', () => {
  assert.equal(mapRoleText('Owner'), 'owner')
  assert.equal(mapRoleText('owner'), 'owner')
  // Both of these contain "owner" and neither is the deal's owner.
  assert.equal(mapRoleText('data room owner'), null)
  assert.equal(mapRoleText('Participant Royalty Owner'), null)

  assert.equal(mapRoleText('GridEdge Managing Director/Fundraiser'), 'investment_bank')
  // Describes a job nobody can name from the string — must NOT become a bank.
  assert.equal(mapRoleText('Fundraising, treasury ops, and rail sector strategy'), null)
})

test('empty input is null, never a category', () => {
  assert.equal(mapRoleText(null), null)
  assert.equal(mapRoleText(undefined), null)
  assert.equal(mapRoleText('   '), null)
})

/**
 * ⚠ A RULE NAMING A ROLE THE REGISTRY DOES NOT HAVE SIMPLY NEVER FIRES, and
 * nothing reports it — §12's "a category the model was never told about never
 * fires", in the other direction. Read against the seed migration, which is
 * the real artifact: a literal list pasted in here would be a duplicate, not a
 * fixture (§12).
 */
test('every rule names a role the seed actually creates', () => {
  const sql = readFileSync('supabase/migrations/20261021000004_contact_roles_seed.sql', 'utf8')
  const seeded = new Set([...sql.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]))
  assert.ok(seeded.size > 40, `expected the seed to hold the registry, found ${seeded.size}`)

  for (const { key } of ROLE_RULES) {
    assert.ok(seeded.has(key), `ROLE_RULES maps to "${key}", which the seed does not create`)
  }
  for (const key of DEAL_SCOPED_ROLES) {
    assert.ok(seeded.has(key), `DEAL_SCOPED_ROLES names "${key}", which the seed does not create`)
  }
})

test('a position in one transaction does not travel onto the contact', () => {
  // §12: filling a blank and overwriting a value are different acts, and which
  // is safe turns on whether the source DESCRIBES its subject or only MENTIONS
  // it. A law firm is a law firm on every deal; the seller on Steelton is not
  // "a seller" in general.
  assert.equal(travelsToContact('legal_counsel'), true)
  assert.equal(travelsToContact('advisor'), true)
  assert.equal(travelsToContact('general_contractor'), true)
  assert.equal(travelsToContact('seller'), false)
  assert.equal(travelsToContact('buyer'), false)
  assert.equal(travelsToContact('owner'), false)
})
