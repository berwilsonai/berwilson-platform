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
  /**
   * What share of this sender's threads carry List-Unsubscribe.
   *
   * ⚠ A SHARE, NOT A BOOLEAN, AND THAT IS THE WHOLE POINT. "Any thread is bulk"
   * condemns a domain that sends marketing AND something else — google.com
   * sends Google Ads promotions (bulk) and "Folder shared with you" notices
   * from real people (not bulk); microsoft.com sends Microsoft Learn promos and
   * account security codes. Judged by the marketing alone, both families were
   * classified junk and 56 threads of real notices would have gone to spam.
   */
  bulkShare: number
  /** True when any message from this sender became a non-spam lead. */
  everProducedLead: boolean
  /** How many threads from this sender are in the mailbox. */
  threads: number
}

/**
 * Below this share of list mail, a family is MIXED and left alone.
 *
 * ⚠ THIS IS NOT WHAT PROTECTS TRANSACTIONAL MAIL — the per-thread check is.
 * Only threads that individually carry List-Unsubscribe are ever acted on, so a
 * Home Depot order receipt or a Google Drive share survives even when its
 * domain is condemned. That is what lets this bar be a judgement about the
 * SENDER rather than a safety margin.
 *
 * Measured against the real inbox, the distribution is clearly bimodal: the
 * mixed platforms sit at 13-50% (google.com 13%, microsoft.com 13%,
 * verizonwireless 25%, eventbrite 38%, alignable 50%) and the marketing
 * senders at 63-100% (zillow 63%, adobe 75%, houzz 88%, and 25 families at
 * 100%). 0.6 sits in the gap. An earlier 0.95 spared Houzz, Home Depot and
 * Total Wine on a single non-bulk message each.
 */
export const BULK_SHARE_REQUIRED = 0.6

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

/**
 * Bulk-mail relays. Many unrelated organisations send through one of these, so
 * the domain identifies the PLUMBING, not the sender.
 *
 * Found the hard way: 14 inbox threads on ccsend.com (Constant Contact) turned
 * out to be four different organisations — a contractor lead service, the Utah
 * Valley Chamber of Commerce, and an Arizona licensing school. Condemning
 * "ccsend.com" as a family would have spammed all of them on one decision.
 */
const RELAY =
  /(^|\.)(ccsend|sendgrid|mailgun|rsgsv|mcsv|mcdlv|sparkpostmail|mktdns|createsend|icptrack|cmail\d*|mailchimpapp|hubspotemail|pardot|exacttarget|mandrillapp|amazonses|postmarkapp|mailjet|braze|customeriomail|outreachsystems)\./i

/**
 * VERP / sender-rewriting envelopes, where the REAL sender is encoded into the
 * local part: `sender+sortiz=utah.gov@outreachsystems.net`.
 *
 * ⚠ THIS ONE NEARLY COST 94 THREADS OF GOVERNMENT CONTRACTING MAIL. Those are
 * Utah APEX Accelerator bulletins and Hill AFB Industry Partner Exchange
 * invitations — squarely "leads and RFPs" — sent by utah.gov through a bulk
 * relay. Read as `outreachsystems.net` they looked like marketing; read as
 * `utah.gov` they are protected by the public-sector rule.
 */
function encodedSenderDomain(address: string): string | null {
  const local = address.split('@')[0] ?? ''
  const m = local.match(/=([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/)
  return m ? m[1].toLowerCase() : null
}

/**
 * The domain a sender should be JUDGED by — the encoded original where there is
 * one, otherwise the envelope domain.
 */
function domainOf(address: string): string {
  const envelope = (address.split('@')[1] ?? address).toLowerCase().trim()
  return encodedSenderDomain(address) ?? envelope
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

  // A shared relay identifies the plumbing, not the sender: several unrelated
  // organisations arrive under one domain and must not share one verdict.
  if (RELAY.test(domain) || RELAY.test((facts.address.split('@')[1] ?? ''))) {
    return { verdict: 'unknown', reason: 'shared bulk relay — several senders behind one domain' }
  }

  // Not bulk mail means a person, or a transactional notice addressed to us.
  // Unsubscribing is impossible and marking it spam is the worst error available,
  // so it is never junk however unwelcome it is.
  if (facts.bulkShare <= 0) {
    return { verdict: 'unknown', reason: 'not list mail — person or transactional' }
  }
  if (facts.bulkShare < BULK_SHARE_REQUIRED) {
    return {
      verdict: 'unknown',
      reason: `mixed sender — only ${Math.round(facts.bulkShare * 100)}% of its mail is a list`,
    }
  }

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
