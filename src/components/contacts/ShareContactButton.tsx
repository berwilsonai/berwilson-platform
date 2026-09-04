'use client'

import { useState } from 'react'
import { Share2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  fullName: string
  email: string | null
  phone: string | null
  title?: string | null
  company?: string | null
}

/** vCard escaping: backslash, comma, semicolon, newline (RFC 6350 §3.4). */
function esc(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function buildVCard({ fullName, email, phone, title, company }: Props): string {
  const parts = fullName.trim().split(/\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : fullName

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${esc(last)};${esc(first)};;;`,
    `FN:${esc(fullName)}`,
  ]
  if (company) lines.push(`ORG:${esc(company)}`)
  if (title) lines.push(`TITLE:${esc(title)}`)
  if (phone) lines.push(`TEL;TYPE=CELL:${esc(phone)}`)
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${esc(email)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

function buildText({ fullName, email, phone, title, company }: Props): string {
  const lines = [fullName]
  const sub = [title, company].filter(Boolean).join(' · ')
  if (sub) lines.push(sub)
  if (phone) lines.push(phone)
  if (email) lines.push(email)
  return lines.join('\n')
}

function fileName(fullName: string): string {
  const slug = fullName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return `${slug || 'contact'}.vcf`
}

/**
 * Shares a contact through the device's native share sheet (iOS/Android),
 * so it can be sent straight into iMessage. Prefers a .vcf file — the
 * recipient gets a real contact card they can save — and falls back to
 * plain text, then to the clipboard on desktop browsers with no share sheet.
 */
export default function ShareContactButton(props: Props) {
  const [busy, setBusy] = useState(false)

  async function handleShare() {
    if (busy) return
    setBusy(true)
    const text = buildText(props)

    try {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined

      // 1 — native share sheet with a contact card attached.
      if (nav?.share) {
        try {
          const file = new File([buildVCard(props)], fileName(props.fullName), {
            type: 'text/vcard',
          })
          if (nav.canShare?.({ files: [file] })) {
            await nav.share({ files: [file], title: props.fullName })
            return
          }
        } catch (err) {
          // A cancelled share is a decision, not a failure — don't retry as text.
          if (err instanceof DOMException && err.name === 'AbortError') return
        }

        // 2 — native share sheet, plain text.
        try {
          await nav.share({ title: props.fullName, text })
          return
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          throw err
        }
      }

      // 3 — no share sheet (most desktop browsers).
      await navigator.clipboard.writeText(text)
      toast.success('Contact details copied to clipboard')
    } catch {
      toast.error('Could not share this contact')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={busy}
      className="inline-flex items-center gap-1.5 h-11 sm:h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-accent transition-colors shrink-0 disabled:opacity-60"
      title="Share this contact"
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
      <span className="whitespace-nowrap">Share</span>
    </button>
  )
}
