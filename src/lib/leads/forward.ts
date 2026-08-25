/**
 * Forwarding a lead to Dino Service Pros.
 *
 * Dino is one of Ber Wilson's operating companies, but its team has neither
 * platform logins nor Tailscale access — the platform is tailnet-only. So a
 * plumbing/HVAC lead reaches them the only way that actually works: in their
 * inbox, with the brief and the original files attached.
 *
 * Chosen over a dino_leads table for exactly that reason. `forwarded_to` /
 * `forwarded_at` on the lead is the record of what was handed over.
 */

import { notify } from '@/lib/notify'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MailAttachment } from '@/lib/integrations/google-workspace'
import { leadsDb, parseLeadAttachments, type LeadRow } from './db'

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

export function renderForwardEmail(lead: LeadRow): { subject: string; html: string } {
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

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;max-width:640px">
  <p style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px">Lead from Ber Wilson</p>
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(lead.title)}</h2>
  <table style="border-collapse:collapse;margin-bottom:14px">${facts}</table>
  ${lead.summary ? `<p>${escapeHtml(lead.summary)}</p>` : ''}
  ${lead.scope ? `<p><strong>Scope:</strong> ${escapeHtml(lead.scope)}</p>` : ''}
  ${list('Key facts', lead.key_facts)}
  ${list('Requirements', lead.requirements)}
  <p style="margin-top:20px;color:#64748b;font-size:12px">Forwarded automatically from Ber Wilson's inbound lead queue. Reply directly to the sender above.</p>
</div>`

  return { subject: `Lead: ${lead.title}`, html }
}

export interface ForwardResult {
  to: string
  attachmentsSent: number
  skipped: string[]
}

export async function forwardLeadToDino(lead: LeadRow, to: string): Promise<ForwardResult> {
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

  const { subject, html } = renderForwardEmail(lead)
  const noteHtml = skipped.length
    ? html.replace(
        '</div>',
        `<p style="color:#b45309;font-size:12px">${skipped.length} file(s) were too large to attach: ${escapeHtml(
          skipped.join(', ')
        )}</p></div>`
      )
    : html

  const result = await notify({ channel: 'email', to, subject, html: noteHtml, attachments })
  if (!result.ok) throw new Error(result.error ?? 'Send failed.')

  const { error: markErr } = await leadsDb()
    .from('leads')
    .update({
      status: 'forwarded',
      forwarded_to: to,
      forwarded_at: new Date().toISOString(),
    })
    .eq('id', lead.id)
  if (markErr) console.error('[leads/forward] sent but lead not marked:', markErr.message)

  return { to, attachmentsSent: attachments.length, skipped }
}
