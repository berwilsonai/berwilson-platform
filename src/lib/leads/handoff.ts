/**
 * Handing a lead to the trade that does the work.
 *
 * Ber Intelligence is tailnet-only, deliberately and permanently. So the teams
 * who actually price and perform this work — Dino Plumbing, Dino HVAC, the
 * flooring crew, and whoever the next line of business turns out to be — have
 * no login and never will. Their inbox is the only delivery that reaches them.
 *
 * Was `forward.ts`, addressed to Dino alone and taking its address from the
 * `DINO_LEAD_EMAIL` env var, which was never set: the button 400'd for its
 * entire life (open item since 2026-08-26). The address now lives on the
 * category row, where it is typed into a screen rather than remembered across a
 * rebuild — and where two lanes at the same company can go to two different
 * people, which is the whole reason this was generalised.
 *
 * Chosen over a table per trade for the same reason as before: nothing here is
 * a record they can open. `forwarded_to` / `forwarded_at` on the lead is the
 * record of what was handed over, and `route` says which lane took it.
 */

import { notify } from '@/lib/notify'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MailAttachment } from '@/lib/integrations/google-workspace'
import { leadsDb, parseLeadAttachments, type LeadRow } from './db'
import { getCategory, type LeadCategory } from './categories'
import { publishLeadToCategoryFolder } from './drive'

/** Gmail's own limit is 25MB for the whole message; stay well under it. */
const MAX_FORWARD_BYTES = 15 * 1024 * 1024

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function list(title: string, items: string[]): string {
  if (items.length === 0) return ''
  return `<h3 style="font-size:14px;margin:18px 0 6px">${title}</h3><ul style="margin:0;padding-left:18px">${items
    .map((i) => `<li style="margin-bottom:4px">${escapeHtml(i)}</li>`)
    .join('')}</ul>`
}

export function renderHandoffEmail(
  lead: LeadRow,
  category: LeadCategory | null,
  /** The Drive folder this lead's files were copied into, if any. */
  folderUrl: string | null
): { subject: string; html: string } {
  const rows: [string, string | null][] = [
    ['From', [lead.sender_name, lead.sender_company].filter(Boolean).join(' · ') || null],
    ['Email', lead.sender_email],
    ['Phone', lead.sender_phone],
    ['Location', lead.location],
    ['Received', lead.received_at?.slice(0, 10) ?? null],
    ['Bid due', lead.bid_due_date],
  ]

  const facts = rows
    .filter(([, v]) => !!v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 12px 3px 0;color:#64748b;white-space:nowrap">${k}</td><td style="padding:3px 0">${escapeHtml(
          v as string
        )}</td></tr>`
    )
    .join('')

  // The folder, not just the attachments. Gmail caps a message at 25MB and a
  // bid package routinely exceeds it, so the attachments are a convenience and
  // the folder is the authoritative copy — and unlike the email it keeps
  // receiving files as more arrive on the thread.
  const folderBlock = folderUrl
    ? `<p style="margin:16px 0 0"><a href="${folderUrl}" style="color:#1d4ed8">Open every file for this lead in Drive</a></p>`
    : ''

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:640px">
  <p style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px">${
    category ? escapeHtml(category.label) : 'Lead'
  } — from Ber Wilson</p>
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(lead.title)}</h2>
  <table style="border-collapse:collapse;margin-bottom:14px">${facts}</table>
  ${lead.summary ? `<p>${escapeHtml(lead.summary)}</p>` : ''}
  ${lead.scope ? `<p><strong>Scope:</strong> ${escapeHtml(lead.scope)}</p>` : ''}
  ${list('Key facts', lead.key_facts)}
  ${list('Requirements', lead.requirements)}
  ${folderBlock}
  <p style="margin-top:20px;color:#64748b;font-size:12px">Sent from Ber Wilson's inbound lead queue. Reply directly to the sender above.</p>
</div>`

  // The lane in the subject, so a recipient who receives more than one kind can
  // filter, and so two lanes at the same company are told apart in one inbox.
  return { subject: `${category ? `${category.label}: ` : 'Lead: '}${lead.title}`, html }
}

export interface HandoffResult {
  to: string
  /** The lane's label, for the toast — "Handed off to Dino Plumbing". */
  label: string
  attachmentsSent: number
  skipped: string[]
  /** Where the files were copied, when the lane has a Drive folder. */
  folderUrl: string | null
}

/**
 * Hand a lead to its category's team.
 *
 * `to` is optional and overrides the category's configured address — used by the
 * API when a caller names a one-off recipient. The category is the default, and
 * the normal path.
 */
export async function handOffLead(lead: LeadRow, to?: string): Promise<HandoffResult> {
  const category = await getCategory(lead.route)
  const address = (to?.trim() || category?.handoff_email?.trim() || '').toLowerCase()
  if (!address.includes('@')) {
    throw new Error(
      `${category?.label ?? 'This line of business'} has no handoff address. ` +
        'Add one in Settings → Lead categories.'
    )
  }

  const supabase = createAdminClient()
  const staged = parseLeadAttachments(lead.attachments)
  const attachments: MailAttachment[] = []
  const skipped: string[] = []
  let total = 0

  for (const a of staged) {
    if (total + a.size_bytes > MAX_FORWARD_BYTES) {
      skipped.push(a.name)
      continue
    }
    const { data: blob, error } = await supabase.storage
      .from('documents')
      .download(a.storage_path)
    if (error || !blob) {
      skipped.push(a.name)
      continue
    }
    attachments.push({
      fileName: a.name,
      mimeType: a.mime_type ?? 'application/octet-stream',
      content: Buffer.from(await blob.arrayBuffer()),
    })
    total += a.size_bytes
  }

  // Copied to Drive BEFORE the email is sent, so the link in it is already
  // live when it lands — and so a lead whose files exceeded the 15MB mail cap
  // still reaches the recipient in full. Quiet: a Drive hiccup must not stop the
  // handoff, which is the part that actually reaches a person.
  const folderUrl = await publishLeadToCategoryFolder(lead, category).catch((err: unknown) => {
    console.warn('[leads/handoff] could not publish to Drive:', err)
    return null
  })

  const { subject, html } = renderHandoffEmail(lead, category, folderUrl)
  const noteHtml = skipped.length
    ? html.replace(
        '</div>',
        `<p style="color:#b45309;font-size:12px">${skipped.length} file(s) were too large to attach: ${escapeHtml(
          skipped.join(', ')
        )}</p></div>`
      )
    : html

  const result = await notify({ channel: 'email', to: address, subject, html: noteHtml, attachments })
  if (!result.ok) throw new Error(result.error ?? 'Send failed.')

  const { error: markErr } = await leadsDb()
    .from('leads')
    .update({
      status: 'forwarded',
      forwarded_to: address,
      forwarded_at: new Date().toISOString(),
    })
    .eq('id', lead.id)
  if (markErr) console.error('[leads/handoff] sent but lead not marked:', markErr.message)

  return {
    to: address,
    label: category?.label ?? 'the trade team',
    attachmentsSent: attachments.length,
    skipped,
    folderUrl,
  }
}
