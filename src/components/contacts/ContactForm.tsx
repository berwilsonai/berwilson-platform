'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createContact } from '@/app/contacts/actions'
import type { ContactFormState } from '@/app/contacts/actions'

const inputClass = cn(
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
)
const textareaClass = cn(
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
  'min-h-[80px] resize-y'
)
const labelClass = 'block text-xs font-medium text-foreground mb-1'

export default function ContactForm() {
  const [state, formAction, isPending] = useActionState<ContactFormState, FormData>(
    createContact,
    null
  )

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {state && 'error' in state && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {state.error}
        </div>
      )}

      {/* Contact type */}
      <div>
        <label className={labelClass}>Contact Type</label>
        <div className="flex gap-4 mt-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="is_organization"
              value="false"
              defaultChecked
              className="accent-primary"
            />
            Individual
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="is_organization"
              value="true"
              className="accent-primary"
            />
            Organization / Firm
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="full_name" className={labelClass}>
            Full Name <span className="text-destructive">*</span>
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            placeholder="Jane Smith"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="company" className={labelClass}>Company / Firm</label>
          <input
            id="company"
            name="company"
            type="text"
            placeholder="Acme Construction"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="title" className={labelClass}>Title / Role</label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder="VP of Development"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>Email</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="jane@example.com"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>Phone</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            placeholder="(801) 555-0100"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="relationship_notes" className={labelClass}>Relationship Notes</label>
        <textarea
          id="relationship_notes"
          name="relationship_notes"
          placeholder="How we know them, key context, relationship history…"
          className={textareaClass}
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending} size="sm">
          {isPending ? 'Saving…' : 'Add Contact'}
        </Button>
        <Link
          href="/contacts"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
