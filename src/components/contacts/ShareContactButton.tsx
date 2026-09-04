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
 * recipient gets a real contact card they can save — and degrades to a
 * plain-text share, then to copying the details to the clipboard.
 */
export default function ShareContactButton(props: Props) {
  const [busy, setBusy] = useState(false)

  /**
   * Clipboard fallback. navigator.clipboard only exists in a secure context,
   * so a plain-http origin (e.g. the tailnet IP rather than the HTTPS name)
   * needs the legacy path or the copy throws.
   */
  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return true
      }
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }

  async function handleShare() {
    if (busy) return
    setBusy(true)
    const text = buildText(props)

    try {
      const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      let shareError: unknown = null

      if (canShare) {
        // A share sheet consumes the user gesture whether it succeeds or not,
        // so only ONE share() call is ever attempted — a second would fail with
        // NotAllowedError and mask the real reason. Pick the best payload the
        // browser says it can take, then fall straight through to the clipboard.
        let payload: ShareData = { title: props.fullName, text }
        try {
          const file = new File([buildVCard(props)], fileName(props.fullName), {
            type: 'text/vcard',
          })
          if (navigator.canShare?.({ files: [file] })) {
            payload = { files: [file], title: props.fullName }
          }
        } catch {
          // File unsupported — the text payload already covers it.
        }

        try {
          await navigator.share(payload)
          return
        } catch (err) {
          // Cancelling is a decision, not a failure.
          if (err instanceof DOMException && err.name === 'AbortError') return
          shareError = err
        }
      }

      // No share sheet, or the sheet refused — make sure the details still
      // reach the user rather than dead-ending on an error.
      const copied = await copyToClipboard(text)
      if (copied && !shareError) {
        toast.success('Contact details copied to clipboard')
      } else if (copied) {
        toast.success('Sharing unavailable — details copied to clipboard')
      } else {
        const reason =
          shareError instanceof Error ? `${shareError.name}: ${shareError.message}` : 'no share or clipboard support'
        toast.error(`Could not share this contact (${reason})`)
      }
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
