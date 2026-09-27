/**
 * Profile photos found on the open web — and verified before they are believed.
 *
 * Measured against the real directory on 2026-09-26 before any of this was
 * written, because three of the four obvious sources turn out to be dead ends:
 *
 *   Google People API (already wired, already consented)   1 of 37 contacts
 *   Gravatar                                               1 of 37 contacts
 *   Clearbit's logo API                                    0 of 27 domains (shut down)
 *   Employer bio page → og:image                           the one that works
 *
 * Both Google hits were Richard himself. Google stopped exposing third-party
 * profile photos years ago, so `searchContacts` returns the person with nothing
 * but `default: true` silhouettes — which is why this file does not ask it.
 *
 * THE MODEL INVENTS URLS, SO NOTHING IT SAYS IS STORED ON ITS WORD. Asked for
 * two lawyers at one firm, grounded search returned `/professionals/michael-w-moyer`
 * (200, a real headshot) and `/people/artie-mcconnell` (404), plus a LinkedIn
 * profile that answers 999. Every candidate here is fetched, and a page only
 * counts as the person's when the page itself carries their name. That check is
 * the whole safety story: a valid page for a DIFFERENT Artie McConnell is the
 * failure that puts a stranger's face on a live deal (§12 — one match is not a
 * unique match).
 *
 * Images are normalised through `sips`, which ships with macOS and is already
 * how this platform does local media work (whisper.cpp, bw-ocr). It reads webp,
 * reports dimensions, and re-encodes under the avatars bucket's 2 MB ceiling —
 * no dependency added, nothing resident in RAM.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createAdminClient } from '@/lib/supabase/admin'
import { researchQuery } from '@/lib/ai/research'

const execFileAsync = promisify(execFile)

/**
 * A desktop user agent. Several sites — LinkedIn among them — serve an auth
 * wall or an empty shell to anything that identifies as a bot, and the photo is
 * in the `og:image` of the ordinary page.
 */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

/** The avatars bucket caps uploads at 2 MB; 512px keeps us far under it. */
const MAX_STORED_PX = 512
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
/** Anything smaller than this is a tracking pixel or a spacer, not a photo. */
const MIN_IMAGE_BYTES = 1024
const MIN_IMAGE_PX = 64
const PAGE_TIMEOUT_MS = 15_000

/**
 * A personal mailbox tells us nothing about where someone works, so it can
 * never seed a company domain. `xmission.com` is a Utah ISP and behaves the
 * same way — it is in this list because a contact here actually uses it.
 */
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net',
  'verizon.net', 'att.net', 'sbcglobal.net', 'cox.net', 'protonmail.com', 'proton.me',
  'gmx.com', 'mail.com', 'zoho.com', 'xmission.com', 'qq.com', 'yandex.com',
])

/**
 * Image paths that mean "this is the site's share card", not "this is a person".
 * A bio page whose og:image is the company logo is a logo, and saying so is what
 * stops a law firm's wordmark being filed as a partner's face.
 */
const NON_PORTRAIT_HINTS = [
  'logo', 'share', 'social', 'default', 'placeholder', 'banner', 'header',
  'og-image', 'ogimage', 'opengraph', 'card', 'favicon', 'sprite', 'no-photo',
  'noimage', 'avatar-default', 'silhouette',
]

export type PhotoKind = 'headshot' | 'logo'
export type PhotoSource = 'bio_page' | 'linkedin' | 'site_logo' | 'favicon'

export interface PhotoCandidate {
  /** Whether this is a person's face or a company mark. */
  kind: PhotoKind
  source: PhotoSource
  /** The direct image URL, already fetched and decoded once. */
  imageUrl: string
  /** The page it was found on — the provenance a human needs to judge it. */
  pageUrl: string | null
  width: number
  height: number
  /** Why we believe this is the right image. Shown to the reviewer verbatim. */
  note: string
}

export interface PhotoSearchResult {
  candidate: PhotoCandidate | null
  /** Every URL considered and what became of it — the debugging record. */
  tried: { url: string; outcome: string }[]
  /** Set when the search could not run at all (web research disabled, etc.). */
  error: string | null
}

// ── URL and name helpers ─────────────────────────────────────────────────────

/** `www.bakerlaw.com` → `bakerlaw.com`. Not a public-suffix parser; it does not need to be. */
function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

/** Do two hosts belong to the same organisation? `admin.bakerlaw.com` matches `bakerlaw.com`. */
function sameSite(a: string, b: string): boolean {
  const x = bareHost(a)
  const y = bareHost(b)
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`)
}

/** The company domain behind a work address, or null for a personal mailbox. */
export function companyDomainFromEmail(email: string | null | undefined): string | null {
  const domain = email?.split('@')[1]?.trim().toLowerCase()
  if (!domain || !domain.includes('.')) return null
  // Strip the bulk-mail subdomains senders use (`mg.homedepot.com`, `e.quill.com`).
  const bare = domain.replace(/^(mg|e|em|mail|email|pro|news|info|smtp|mailer)\./, '')
  return FREE_MAIL.has(bare) ? null : bare
}

/**
 * Does this page actually name the person? Both the first and last name must
 * appear, which is what separates "their bio page" from "a page at their firm".
 */
function pageNamesPerson(text: string, fullName: string): boolean {
  const parts = fullName
    .replace(/\b(mr|mrs|ms|dr|jr|sr|iii|ii|phd|esq)\.?\b/gi, ' ')
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z'-]/gi, ''))
    .filter((p) => p.length > 1)
  if (parts.length < 2) return false
  const haystack = text.toLowerCase()
  const first = parts[0].toLowerCase()
  const last = parts[parts.length - 1].toLowerCase()
  return haystack.includes(first) && haystack.includes(last)
}

/** Tags stripped, entities loosened, whitespace collapsed — enough to search for a name. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/\s+/g, ' ')
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return m[1].replace(/&amp;/g, '&').trim()
  }
  return null
}

/** The largest `apple-touch-icon` or `icon` a page declares — a site's best square mark. */
function linkIcon(html: string, base: string): string | null {
  const links = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/gi) ?? []
  let best: { url: string; size: number } | null = null
  for (const tag of links) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    const sizes = tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1]
    // An apple-touch-icon is 180px and square by convention even when unsized.
    const size = sizes ? Number(sizes) : /apple-touch-icon/i.test(tag) ? 180 : 32
    if (!best || size > best.size) {
      try {
        best = { url: new URL(href.replace(/&amp;/g, '&'), base).href, size }
      } catch {
        continue
      }
    }
  }
  return best?.url ?? null
}

function looksNonPortrait(url: string): boolean {
  const lower = url.toLowerCase()
  return NON_PORTRAIT_HINTS.some((hint) => lower.includes(hint))
}

// ── Fetching ─────────────────────────────────────────────────────────────────

interface FetchedPage {
  html: string
  text: string
  finalUrl: string
}

/**
 * Fetch a page as a browser would. Returns null on any non-200, which is the
 * single most important line in this file: LinkedIn answers **999** for a
 * profile that is not fully public and the CMS answers 404 for a path the model
 * invented, and both must end the candidate rather than be worked around.
 */
async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const html = await res.text()
    return { html, text: htmlToText(html), finalUrl: res.url || url }
  } catch {
    return null
  }
}

interface DecodedImage {
  bytes: Buffer
  width: number
  height: number
  /** The extension sips reported, e.g. `jpeg`, `png`, `webp`. */
  format: string
}

/**
 * Download an image and decode it far enough to know its real dimensions.
 *
 * Dimensions are the cheap guard against a share card: a 1200×630 banner is not
 * a face, and no amount of model confidence makes it one.
 */
async function fetchImage(url: string): Promise<DecodedImage | null> {
  let buf: Buffer
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (type && !type.startsWith('image/')) return null
    buf = Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
  if (buf.byteLength < MIN_IMAGE_BYTES) return null

  const dir = await mkdtemp(join(tmpdir(), 'bw-photo-'))
  const src = join(dir, `${randomUUID()}.img`)
  try {
    await writeFile(src, buf)
    const { stdout } = await execFileAsync(
      'sips',
      ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', src],
      { timeout: 20_000 }
    )
    const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0)
    const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1] ?? 0)
    const format = stdout.match(/format:\s*(\w+)/)?.[1] ?? ''
    if (!width || !height) return null
    return { bytes: buf, width, height, format }
  } catch {
    // sips refuses anything it cannot decode — an SVG, an HTML error page
    // served as an image. Undecodable is the same as unusable here.
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Re-encode to something the avatars bucket accepts and a browser renders:
 * a headshot becomes JPEG, a logo stays PNG so transparency survives on a
 * dark background. Never upscaled — a 200px favicon blown up to 512 just
 * looks broken at the size the directory renders it.
 */
async function normalizeImage(img: DecodedImage, kind: PhotoKind): Promise<{ bytes: Buffer; contentType: string }> {
  const targetFormat = kind === 'logo' ? 'png' : 'jpeg'
  const contentType = kind === 'logo' ? 'image/png' : 'image/jpeg'
  const longest = Math.max(img.width, img.height)
  const alreadyFine =
    img.format === targetFormat && longest <= MAX_STORED_PX && img.bytes.byteLength <= MAX_UPLOAD_BYTES
  if (alreadyFine) return { bytes: img.bytes, contentType }

  const dir = await mkdtemp(join(tmpdir(), 'bw-photo-'))
  const src = join(dir, 'in.img')
  const out = join(dir, `out.${targetFormat}`)
  try {
    await writeFile(src, img.bytes)
    const args = ['-s', 'format', targetFormat]
    if (longest > MAX_STORED_PX) args.push('-Z', String(MAX_STORED_PX))
    args.push(src, '--out', out)
    await execFileAsync('sips', args, { timeout: 30_000 })
    const bytes = await readFile(out)
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`still ${Math.round(bytes.byteLength / 1024)} KB after normalising`)
    }
    return { bytes, contentType }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// ── Candidate evaluation ─────────────────────────────────────────────────────

/**
 * Is this image plausibly a face? Portraits are square-ish or taller; a wide
 * strip is a banner. Generous bounds — some firms crop to 4:3 landscape, which
 * the BakerHostetler headshot this was measured against does (385×325).
 */
function plausibleHeadshot(img: DecodedImage): boolean {
  if (img.width < MIN_IMAGE_PX || img.height < MIN_IMAGE_PX) return false
  const aspect = img.width / img.height
  return aspect >= 0.45 && aspect <= 1.8
}

/**
 * Is this a mark rather than a marketing banner?
 *
 * A declared icon link is square by construction and trusted on sight. An
 * `og:image` is not: bloomenergy.com publishes `company-social.jpg` at
 * 1200×630, which is a share card with a strapline across it and reads as
 * nothing at all cropped into a 56px circle. So an og:image has to be roughly
 * square before it counts as a logo.
 */
function plausibleLogo(img: DecodedImage, fromIconLink: boolean): boolean {
  if (img.width < 32 || img.height < 32) return false
  const aspect = img.width / img.height
  if (fromIconLink) return aspect >= 0.5 && aspect <= 2
  return aspect >= 0.6 && aspect <= 1.7
}

/** Pull the best portrait candidate a page offers. */
function pageImageFor(page: FetchedPage, kind: PhotoKind): string | null {
  const raw =
    metaContent(page.html, 'og:image') ??
    metaContent(page.html, 'og:image:secure_url') ??
    metaContent(page.html, 'twitter:image') ??
    metaContent(page.html, 'twitter:image:src') ??
    (kind === 'logo' ? linkIcon(page.html, page.finalUrl) : null)
  if (!raw) return null
  try {
    return new URL(raw, page.finalUrl).href
  } catch {
    return null
  }
}

// ── The searches ─────────────────────────────────────────────────────────────

interface LeadUrls {
  bioPage: string | null
  linkedin: string | null
  website: string | null
}

function parseLeads(text: string): LeadUrls {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return { bioPage: null, linkedin: null, website: null }
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1))
    const obj = (parsed ?? {}) as Record<string, unknown>
    const str = (k: string): string | null => {
      const v = obj[k]
      return typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null
    }
    return { bioPage: str('bio_page_url'), linkedin: str('linkedin_url'), website: str('website_url') }
  } catch {
    return { bioPage: null, linkedin: null, website: null }
  }
}

/**
 * `gemini-2.5-flash` answers **503 — currently experiencing high demand** when a
 * backfill puts eighty searches through it back to back, and a 503 swallowed as
 * "nothing found" is the worst possible outcome here: the contact is marked as
 * having no web presence and never looked at again. Retry it, and let a genuine
 * refusal through unchanged.
 */
const RETRYABLE = /\b(429|500|502|503|504|high demand|overloaded|rate limit|unavailable|timeout|ETIMEDOUT|ECONNRESET)\b/i

/**
 * A DAILY quota is not a spike, and backing off six seconds against it just
 * burns the clock. The key in use is on Gemini's free tier, which allows **20
 * `gemini-2.5-flash` requests per day** — enough for a handful of contacts, not
 * a directory. Callers use this to stop rather than grind.
 */
const QUOTA_EXHAUSTED = /PerDay|free_tier|exceeded your current quota/i

export function isQuotaExhausted(message: string | null | undefined): boolean {
  return !!message && QUOTA_EXHAUSTED.test(message)
}

/**
 * The SDK has no timeout of its own and will sit on a stalled request for
 * minutes — measured at roughly two per attempt during a 503 spell, which made
 * ONE contact take seven minutes. A search that has not answered in 45s is not
 * going to, and the fallbacks below do not need it.
 */
const SEARCH_TIMEOUT_MS = 45_000

async function findLeads(prompt: string, attempts = 3): Promise<{ leads: LeadUrls; error: string | null }> {
  let lastError = 'web research failed'
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await Promise.race([
        researchQuery(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('web research timeout')), SEARCH_TIMEOUT_MS)
        ),
      ])
      return { leads: parseLeads(res.text), error: null }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'web research failed'
      if (attempt === attempts || isQuotaExhausted(lastError) || !RETRYABLE.test(lastError)) break
      // 2s, then 6s. Long enough for a demand spike to clear, short enough that
      // a full directory pass still finishes in one sitting.
      await new Promise((resolve) => setTimeout(resolve, attempt * attempt * 2000))
    }
  }
  return { leads: { bioPage: null, linkedin: null, website: null }, error: lastError }
}

/**
 * The company domain the directory already knows for an organisation.
 *
 * `Barnraisers Group LLC` has no email of its own, but Rick writes from
 * `rick@barnraisersgroup.com` and his contact record names the company. That is
 * evidence out of our own mail rather than a guess, so it is consulted BEFORE
 * the model — and it keeps working when Gemini is answering 503, which is how
 * this came to be written.
 *
 * MATCHING ON A SUBSTRING OF THE DOMAIN IS NOT ENOUGH, and the first version of
 * this filed `bfaenergy.com`'s logo on **Bloom Energy** — because `bfaenergy`
 * contains `energy`. A shared industry word is the one thing a company
 * identifier must not be (§12). So the domain must START with the organisation's
 * leading distinctive word, and a match on the contact's `company` field must
 * account for every word of the name, not one of them.
 */
const ORG_STOPWORDS = new Set([
  'the', 'and', 'of', 'llc', 'l.l.c', 'inc', 'inc.', 'corp', 'corp.', 'corporation',
  'company', 'co', 'co.', 'group', 'holdings', 'partners', 'services', 'service',
  'solutions', 'systems', 'ltd', 'limited', 'lp', 'llp', 'pllc', 'pc', 'associates',
  'international', 'enterprises', 'industries', 'construction', 'development', 'town',
  'city', 'county', 'state', 'department', 'office', 'usa', 'us', 'american', 'america',
  // Industry words. Every one of these is shared by several firms here, which
  // is precisely what made `energy` match Bloom Energy to BFA Energy.
  'energy', 'utility', 'utilities', 'mining', 'minerals', 'gold', 'steel', 'capital',
  'realty', 'properties', 'property', 'consulting', 'consultants', 'engineering',
  'builders', 'building', 'contracting', 'contractors', 'management', 'ventures',
  'investments', 'equity', 'technologies', 'technology', 'global', 'national',
])

function orgKeywords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !ORG_STOPWORDS.has(w))
}

export async function domainFromDirectory(orgName: string): Promise<string | null> {
  const keywords = orgKeywords(orgName)
  if (keywords.length === 0) return null
  const lead = keywords[0]

  const admin = createAdminClient()
  const { data } = await admin
    .from('parties')
    .select('company, email')
    .not('email', 'is', null)
    .limit(1000)

  for (const row of data ?? []) {
    const domain = companyDomainFromEmail(row.email)
    if (!domain) continue

    // The domain's own name must BEGIN with the organisation's leading word:
    // `barnraisersgroup` for Barnraisers, `caseut` for Case Utility — but never
    // `bfaenergy` for Bloom Energy.
    const domainWord = domain.split('.')[0].replace(/[^a-z0-9]/g, '')
    if (domainWord.startsWith(lead)) return domain

    // Or the contact says outright who they work for, and every distinguishing
    // word of the organisation's name is present.
    const companyText = (row.company ?? '').toLowerCase()
    if (companyText && keywords.every((kw) => new RegExp(`\\b${kw}`).test(companyText))) {
      return domain
    }
  }
  return null
}

// ── The pass ─────────────────────────────────────────────────────────────────

export interface FindPhotoOptions {
  fullName: string
  company?: string | null
  email?: string | null
  isOrganization?: boolean | null
  /** Skip the logo fallback when only a real face will do. */
  allowLogoFallback?: boolean
}

/**
 * Find one verified image for a contact, or nothing.
 *
 * Nothing is the normal answer for a great many people: measured over four real
 * contacts, two resolved and two have no public headshot anywhere. Returning
 * null is the correct result there, not a failure to work around.
 */
export async function findProfilePhoto(opts: FindPhotoOptions): Promise<PhotoSearchResult> {
  const tried: { url: string; outcome: string }[] = []
  const fullName = opts.fullName.trim()
  if (!fullName) return { candidate: null, tried, error: 'no name' }

  const allowLogo = opts.allowLogoFallback !== false
  const emailDomain = companyDomainFromEmail(opts.email)
  const company = opts.company?.trim() || null
  const isOrg = opts.isOrganization === true

  // ── Organisations: one mark, from their own site ──────────────────────────
  if (isOrg) {
    // Our own mail first — free, instant, and right more often than a search.
    const knownDomain = await domainFromDirectory(company ?? fullName)
    if (knownDomain) {
      const fromKnown = await logoFromSite(`https://${knownDomain}`, fullName, tried)
      if (fromKnown) return { candidate: fromKnown, tried, error: null }
    }

    const { leads, error } = await findLeads(
      `What is the official website of the organization "${fullName}"${company && company !== fullName ? ` (also known as ${company})` : ''}? ` +
        `This is a real company or government body that does business in construction, development, mining or utilities in the United States. ` +
        `Reply with ONLY strict JSON: {"website_url": string|null}. Use the organization's own homepage, never a directory, LinkedIn, Facebook, Bloomberg or news page. ` +
        `If you are not confident it is this exact organization, use null.`
    )
    const homepage = leads.website ?? (emailDomain ? `https://${emailDomain}` : null)
    if (!homepage) return { candidate: null, tried, error: error ?? null }

    const logo = await logoFromSite(homepage, fullName, tried)
    return { candidate: logo, tried, error: logo ? null : error }
  }

  // ── People: bio page, then LinkedIn, then their employer's mark ───────────
  const domainHint = emailDomain ? ` Their work email is on the domain ${emailDomain}, so their employer's website is almost certainly ${emailDomain}.` : ''
  const { leads, error } = await findLeads(
    `Find the professional web presence of ${fullName}${company ? `, who works at ${company}` : ''}.${domainHint} ` +
      `Reply with ONLY strict JSON: {"bio_page_url": string|null, "linkedin_url": string|null, "website_url": string|null}. ` +
      `bio_page_url = the page about THIS PERSON on their own employer's website (a team, staff, attorney, leadership or "our people" bio page). ` +
      `linkedin_url = their personal LinkedIn profile, of the form https://www.linkedin.com/in/... ` +
      `website_url = their employer's homepage. ` +
      `Do not guess a URL pattern. If you have not actually seen the page in search results, or cannot confirm it is this exact person at this exact company, use null.`
  )

  // 1. The employer's own bio page. The strongest evidence available: the page
  //    names the person, and its host matches the domain their mail comes from.
  for (const url of [leads.bioPage].filter((u): u is string => !!u)) {
    const page = await fetchPage(url)
    if (!page) {
      tried.push({ url, outcome: 'page did not load (404 or blocked)' })
      continue
    }
    if (!pageNamesPerson(page.text, fullName)) {
      tried.push({ url, outcome: 'page loaded but does not name this person' })
      continue
    }
    const imageUrl = pageImageFor(page, 'headshot')
    if (!imageUrl) {
      tried.push({ url, outcome: 'page names them but publishes no image' })
      continue
    }
    if (looksNonPortrait(imageUrl)) {
      tried.push({ url, outcome: 'page image is the site share card, not a portrait' })
      continue
    }
    const img = await fetchImage(imageUrl)
    if (!img) {
      tried.push({ url: imageUrl, outcome: 'image could not be downloaded or decoded' })
      continue
    }
    if (!plausibleHeadshot(img)) {
      tried.push({ url: imageUrl, outcome: `${img.width}×${img.height} is not portrait-shaped` })
      continue
    }
    let host = ''
    try {
      host = new URL(page.finalUrl).hostname
    } catch { /* keep the note generic */ }
    const corroborated = emailDomain && host && sameSite(host, emailDomain)
    return {
      candidate: {
        kind: 'headshot',
        source: 'bio_page',
        imageUrl,
        pageUrl: page.finalUrl,
        width: img.width,
        height: img.height,
        note: corroborated
          ? `Bio page on ${bareHost(host)}, which matches their email domain, and the page names them.`
          : `Bio page names them${host ? ` on ${bareHost(host)}` : ''}.`,
      },
      tried,
      error: null,
    }
  }

  // 2. LinkedIn. Works only for fully public profiles — anything else answers
  //    999, which fetchPage turns into a miss rather than a retry.
  if (leads.linkedin && /linkedin\.com\/in\//i.test(leads.linkedin)) {
    const url = leads.linkedin.split('?')[0]
    const page = await fetchPage(url)
    if (!page) {
      tried.push({ url, outcome: 'LinkedIn returned 999 or 404 — profile is not public' })
    } else {
      const title = metaContent(page.html, 'og:title') ?? ''
      if (!pageNamesPerson(title || page.text, fullName)) {
        tried.push({ url, outcome: `LinkedIn profile is someone else (${title.slice(0, 60)})` })
      } else {
        const imageUrl = pageImageFor(page, 'headshot')
        const img = imageUrl ? await fetchImage(imageUrl) : null
        if (img && plausibleHeadshot(img) && imageUrl) {
          return {
            candidate: {
              kind: 'headshot',
              source: 'linkedin',
              imageUrl,
              pageUrl: url,
              width: img.width,
              height: img.height,
              note: `Public LinkedIn profile, whose title reads "${title.slice(0, 70)}".`,
            },
            tried,
            error: null,
          }
        }
        tried.push({ url, outcome: 'LinkedIn profile has no usable photo' })
      }
    }
  }

  // 3. Their employer's mark. Not a face, and labelled as such wherever it is
  //    shown — but a known company beats a grey silhouette in a directory.
  // A LOGO IS A CONCLUSION, AND IT CAN ONLY BE DRAWN FROM A SEARCH THAT RAN.
  // Settling for one after a 429 would record "this person has no headshot",
  // skip them on every future pass, and quietly cap the directory at logos —
  // the free-tier key allows 20 searches a day, so that is not hypothetical.
  if (allowLogo && error === null) {
    // Their own work domain outranks anything the model proposed: mail they
    // actually send from cannot be the wrong company.
    const known = emailDomain ?? (company ? await domainFromDirectory(company) : null)
    const site = known ? `https://${known}` : leads.website
    if (site) {
      const logo = await logoFromSite(site, company ?? fullName, tried)
      if (logo) return { candidate: logo, tried, error: null }
    }
  }

  return { candidate: null, tried, error }
}

/**
 * A site's own mark: the largest icon it declares, then its share image, then
 * Google's favicon service as the floor. Clearbit is deliberately absent —
 * measured at 0 of 27 domains on 2026-09-26, because HubSpot retired it.
 */
async function logoFromSite(
  siteUrl: string,
  label: string,
  tried: { url: string; outcome: string }[]
): Promise<PhotoCandidate | null> {
  let host: string
  try {
    host = new URL(siteUrl).hostname
  } catch {
    tried.push({ url: siteUrl, outcome: 'not a usable URL' })
    return null
  }

  const page = await fetchPage(siteUrl)
  const candidates: { url: string; fromIconLink: boolean }[] = []
  if (page) {
    const icon = linkIcon(page.html, page.finalUrl)
    if (icon) candidates.push({ url: icon, fromIconLink: true })
    const og = pageImageFor(page, 'logo')
    if (og && og !== icon && !looksNonPortrait(og)) candidates.push({ url: og, fromIconLink: false })
  } else {
    tried.push({ url: siteUrl, outcome: 'homepage did not load' })
  }
  // Google's icon service is the floor, not the first choice: it answers for
  // almost every domain (25 of 27, measured) but often with a 16px original.
  candidates.push({
    url: `https://www.google.com/s2/favicons?domain=${bareHost(host)}&sz=128`,
    fromIconLink: true,
  })

  for (const { url: imageUrl, fromIconLink } of candidates) {
    const img = await fetchImage(imageUrl)
    if (!img) {
      tried.push({ url: imageUrl, outcome: 'image could not be downloaded or decoded' })
      continue
    }
    if (!plausibleLogo(img, fromIconLink)) {
      tried.push({ url: imageUrl, outcome: `${img.width}×${img.height} is a banner or too small for a mark` })
      continue
    }
    const viaFavicon = imageUrl.includes('s2/favicons')
    return {
      kind: 'logo',
      source: viaFavicon ? 'favicon' : 'site_logo',
      imageUrl,
      pageUrl: page?.finalUrl ?? siteUrl,
      width: img.width,
      height: img.height,
      note: viaFavicon
        ? `Site icon for ${bareHost(host)} — a company mark for ${label}, not a photograph.`
        : `Logo published by ${bareHost(host)} — a company mark for ${label}, not a photograph.`,
    }
  }
  return null
}

// ── Storage ──────────────────────────────────────────────────────────────────

/**
 * Download, normalise and file the candidate in the public `avatars` bucket,
 * keyed by the record's id exactly as the manual uploader does, and return the
 * cache-busted public URL to store on the row.
 */
export async function storeProfilePhoto(recordId: string, candidate: PhotoCandidate): Promise<string> {
  const img = await fetchImage(candidate.imageUrl)
  if (!img) throw new Error('the image was reachable during the search but not on download')

  const { bytes, contentType } = await normalizeImage(img, candidate.kind)
  const admin = createAdminClient()
  const { error } = await admin.storage
    .from('avatars')
    .upload(recordId, bytes, { upsert: true, contentType })
  if (error) throw new Error(`avatars upload failed: ${error.message}`)

  const { data } = admin.storage.from('avatars').getPublicUrl(recordId)
  return `${data.publicUrl}?t=${Date.now()}`
}

/** Provenance kept on the row so a wrong face can always be traced back. */
export interface PhotoProvenance {
  kind: PhotoKind
  source: PhotoSource
  image_url: string
  page_url: string | null
  note: string
  found_at: string
}

export function photoProvenance(candidate: PhotoCandidate): PhotoProvenance {
  return {
    kind: candidate.kind,
    source: candidate.source,
    image_url: candidate.imageUrl,
    page_url: candidate.pageUrl,
    note: candidate.note,
    found_at: new Date().toISOString(),
  }
}
