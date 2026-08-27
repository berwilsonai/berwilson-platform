/**
 * Publish the lead queue to Drive as one read-only Google Sheet per route.
 *
 * The audience is the people who will never have a platform login: the steel
 * reps, and Dino — who are a separate company entirely and will never be given
 * one. A sheet is the right shape for them in a way a folder of files is not.
 * Bid invitations almost never arrive as attachments; they arrive as a message
 * with a bid date, a contact, and a link to a plan room. What a rep needs is the
 * LIST — sortable, filterable, and importable into whatever they already use.
 *
 * Read-only is structural, not a setting anyone has to remember: the sheets sit
 * under the Ber Intelligence root, which is shared with the domain as reader,
 * so everyone at berwilson.com can open them and only the platform can write.
 * Nothing here is ever read back — an edit made in the sheet is overwritten on
 * the next run, and that is the intended behaviour, not a limitation.
 *
 * Rebuilt whole each run. The platform owns every row, so there is no merge to
 * get wrong; and because the underlying Drive file is updated rather than
 * replaced, a bookmarked link and any access granted to an outside collaborator
 * both survive the rebuild.
 */

import type { LeadRoute } from '@/lib/ai/prompts/lead-triage'
import { GMAIL_THREAD_EMBED, embeddedGmailThreadId, leadsDb, type LeadRow } from './db'
import {
  DriveScopeError,
  ensureDomainShared,
  ensureFolder,
  ensureRootFolder,
  upsertSheetFromCsv,
} from '@/lib/integrations/google-drive-write'
import { PRIMARY_MAILBOX, isGoogleConfigured } from '@/lib/integrations/google-workspace'

/** Shelf the route sheets live on, under the Ber Intelligence root. */
const SECTION = 'Lead Lists'

/**
 * Which routes get a sheet, and what it is called.
 *
 * Only the two routes whose audience cannot reach the platform. Construction
 * and corporate leads are worked by people who have logins, so a sheet for them
 * would be a second place to look at the same queue — which is how a projection
 * stops being trusted.
 */
export const SHEET_ROUTES: { route: LeadRoute; name: string }[] = [
  { route: 'steel', name: 'Steel Leads' },
  { route: 'dino', name: 'Dino Leads' },
]

/**
 * Statuses kept off the sheet.
 *
 * Filtered marketing and leads somebody explicitly dismissed are noise to a rep
 * working the list. Everything else stays, including promoted and forwarded
 * ones, because "this was already picked up" is exactly the thing a second
 * person needs to see before chasing it.
 */
const HIDDEN_STATUSES = new Set(['spam', 'ignored'])

const COLUMNS = [
  'Received',
  'Lead',
  'From',
  'Contact',
  'Email',
  'Phone',
  'Location',
  'Est. value',
  'Bid due',
  'Site visit',
  'Fit',
  'Recommendation',
  'Status',
  'Summary',
  'Open in Gmail',
] as const

export interface LeadSheetResult {
  route: LeadRoute
  name: string
  rows: number
  url: string
  created: boolean
}

export interface PublishSheetsResult {
  sheets: LeadSheetResult[]
  folderUrl: string | null
  errors: string[]
}

/** RFC 4180 quoting. A bid title with a comma in it must not shift every column. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value).replace(/\r?\n/g, ' ').trim()
  if (!text) return ''
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

function isoDate(value: string | null): string {
  if (!value) return ''
  // Kept as YYYY-MM-DD so the column sorts correctly as text in Sheets, which
  // a locale-formatted date would not.
  return value.slice(0, 10)
}

function money(value: number | null): string {
  if (value === null || value === undefined) return ''
  return `$${Math.round(value).toLocaleString('en-US')}`
}

type SheetLead = LeadRow & { email_threads?: { gmail_thread_id?: string | null } | null }

export function buildLeadCsv(leads: SheetLead[]): string {
  const lines = [csvRow([...COLUMNS])]

  for (const lead of leads) {
    const gmailId = embeddedGmailThreadId(lead)
    lines.push(
      csvRow([
        isoDate(lead.received_at),
        lead.title,
        lead.sender_company,
        lead.sender_name,
        lead.sender_email,
        lead.sender_phone,
        lead.location,
        money(lead.estimated_value),
        isoDate(lead.bid_due_date),
        isoDate(lead.site_visit_date),
        lead.fit_score ?? '',
        lead.fit_recommendation,
        lead.status,
        lead.summary,
        gmailId ? `https://mail.google.com/mail/u/0/#all/${gmailId}` : '',
      ])
    )
  }

  // A sheet with a header and nothing under it reads as broken. Say which it is.
  if (leads.length === 0) {
    lines.push(csvRow(['', 'No leads on this route yet.']))
  }

  return lines.join('\n')
}

/**
 * Order the list the way it gets worked: soonest deadline first.
 *
 * Leads with no bid date sort last rather than first — an undated lead is not
 * urgent, and letting a null float to the top would push the one thing that
 * actually expires below the fold.
 */
function byUrgency(a: SheetLead, b: SheetLead): number {
  const aDue = a.bid_due_date ?? '9999-12-31'
  const bDue = b.bid_due_date ?? '9999-12-31'
  if (aDue !== bDue) return aDue < bDue ? -1 : 1
  return (b.received_at ?? '').localeCompare(a.received_at ?? '')
}

export async function publishLeadSheets(): Promise<PublishSheetsResult> {
  const result: PublishSheetsResult = { sheets: [], folderUrl: null, errors: [] }

  if (!isGoogleConfigured()) {
    throw new Error('Google Workspace is not configured, so lead sheets cannot be published.')
  }

  // leadsDb() rather than the typed admin client: `leads` post-dates the last
  // type generation, which is blocked while the DB is self-hosted under Colima.
  const { data, error } = await leadsDb()
    .from('leads')
    .select(`*, ${GMAIL_THREAD_EMBED}`)
    .in(
      'route',
      SHEET_ROUTES.map((r) => r.route)
    )
  if (error) throw new Error(error.message)

  const all = (data ?? []) as unknown as SheetLead[]

  const root = await ensureRootFolder()
  await ensureDomainShared(root.id, PRIMARY_MAILBOX)
  const folder = await ensureFolder(SECTION, root.id)
  result.folderUrl = `https://drive.google.com/drive/folders/${folder.id}`

  for (const { route, name } of SHEET_ROUTES) {
    const rows = all
      .filter((l) => l.route === route && !HIDDEN_STATUSES.has(l.status))
      .sort(byUrgency)

    try {
      const { ref, created } = await upsertSheetFromCsv({
        folderId: folder.id,
        name,
        csv: buildLeadCsv(rows),
      })
      result.sheets.push({
        route,
        name,
        rows: rows.length,
        url: ref.webViewLink ?? `https://docs.google.com/spreadsheets/d/${ref.id}`,
        created,
      })
    } catch (err) {
      // A missing scope fails identically for the other sheet, so stop.
      if (err instanceof DriveScopeError) throw err
      result.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

/** Publish without ever failing the caller — for the sweep's final phase. */
export async function publishLeadSheetsQuietly(): Promise<PublishSheetsResult | null> {
  try {
    return await publishLeadSheets()
  } catch (err) {
    console.warn('[leads/sheet] skipped:', err instanceof Error ? err.message : err)
    return null
  }
}
