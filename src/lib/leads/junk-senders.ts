/**
 * What counts as junk in the lead mailbox.
 *
 * ⚠ THIS IS NOT `leads.status = 'spam'`, AND THE DIFFERENCE MATTERS.
 *
 * That column is a BID-FIT verdict — "not a job we want" — and 886 rows carry
 * it. Among them: 137 threads from bidnet.com and 36 from mybidmatch.com, which
 * are PLAN ROOMS and therefore a live lead source, plus ~35 real people
 * including a counterparty who appears in the Stockton correspondence. Treating
 * that column as a junk list would unsubscribe the company from its own bid
 * feed and mark a colleague's mail as spam.
 *
 * Junk here means BULK MARKETING: mail sent to a list, by a sender that has
 * never produced a real lead, that is not a bid source and not a person.
 *
 * THE LIST MAINTAINED BY HAND IS THE PROTECTION LIST, deliberately. An entry
 * wrongly added there costs a little clutter; an entry wrongly missing from a
 * junk list costs a bid invitation. The junk side is derived from evidence
 * instead — chiefly "has this sender ever produced a real lead", which lets a
 * plan room protect itself by having worked even once.
 */

export type SenderVerdict = 'protected' | 'junk' | 'unknown'

export interface SenderFacts {
  /** Lowercased envelope address. */
  address: string
  /** True when the mail carries List-Unsubscribe, i.e. it was sent to a list. */
  bulk: boolean
  /** True when any message from this sender became a non-spam lead. */
  everProducedLead: boolean
  /** How many threads from this sender are in the mailbox. */
  threads: number
}

/**
 * Bid boards, plan rooms and procurement portals.
 *
 * Matched against the whole domain, so subdomains and country variants are
 * covered. Most of these also send list-shaped mail with an unsubscribe header,
 * which is exactly why the bulk signal alone cannot decide this.
 */
const BID_SOURCE = new RegExp(
  [
    'bidnet', 'bidmatch', 'buildingconnected', 'planhub', 'isqft', 'questcdn',
    'bidexpress', 'dodge(construction|data)?', 'constructconnect', 'procore',
    'smartbid', 'pipelinesuite', 'ebidboard', 'govwin', 'demandstar', 'bonfirehub',
    'periscopeholdings', 'bidsync', 'publicpurchase', 'vendorregistry', 'opengov',
    'unison(marketplace)?', 'fbo\\.gov', 'sam\\.gov', 'grants\\.gov', 'bidclerk',
    'constructionjournal', 'buildingradar', 'nplanroom', 'planroom',
  ].join('|'),
  'i'
)

/** Our own addresses — internal mail is never junk. */
const INTERNAL = /(^|\.)berwilson\.com$/i

/**
 * Public-sector senders. An .mil or .gov address is an owner or an agency, and
 * an RFP from one is the single most valuable thing that can land here.
 */
const PUBLIC_SECTOR = /\.(gov|mil)(\.[a-z]{2})?$/i

function domainOf(address: string): string {
  return (address.split('@')[1] ?? address).toLowerCase().trim()
}

/**
 * Classify one sender.
 *
 * Order is load-bearing: every protection is checked before anything can be
 * called junk, so a sender that is both bulk AND a bid source stays protected.
 */
export function classifySender(facts: SenderFacts): { verdict: SenderVerdict; reason: string } {
  const domain = domainOf(facts.address)

  if (INTERNAL.test(domain)) return { verdict: 'protected', reason: 'our own domain' }
  if (PUBLIC_SECTOR.test(domain)) return { verdict: 'protected', reason: 'government sender' }
  if (BID_SOURCE.test(domain)) return { verdict: 'protected', reason: 'bid board or plan room' }
  if (facts.everProducedLead) return { verdict: 'protected', reason: 'has produced a real lead' }

  // Not bulk mail means a person, or a transactional notice addressed to us.
  // Unsubscribing is impossible and marking it spam is the worst error available,
  // so it is never junk however unwelcome it is.
  if (!facts.bulk) return { verdict: 'unknown', reason: 'not list mail — person or transactional' }

  // One promotional email is not a pattern. Three from the same sender, none of
  // which ever became a lead, is.
  if (facts.threads < JUNK_MIN_THREADS) {
    return { verdict: 'unknown', reason: `only ${facts.threads} thread(s) — not yet a pattern` }
  }

  return { verdict: 'junk', reason: 'bulk marketing, never produced a lead' }
}

/** Below this, a bulk sender is left alone rather than judged. */
export const JUNK_MIN_THREADS = 3

/**
 * Collapse a sender to the company behind it.
 *
 * `mail.zillow.com`, `email.zillow.com` and `recommendations@mail.zillow.com`
 * are one company making one decision, and unsubscribing from one of its lists
 * while leaving three others is not a clean inbox.
 */
export function senderFamily(address: string): string {
  const parts = domainOf(address).split('.')
  return parts.slice(-2).join('.')
}
