import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import ContactForm from '@/components/contacts/ContactForm'

export const metadata = { title: 'Add Contact — Ber Wilson Intelligence' }

export default function NewContactPage() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Link
          href="/contacts"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft size={14} />
          Contacts
        </Link>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Add Contact</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Add a person or firm to your relationship directory.
        </p>
      </div>

      <ContactForm />
    </div>
  )
}
