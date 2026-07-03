import Link from 'next/link'
import { Search, ArrowRight } from 'lucide-react'
import EmailResearchForm from '@/components/email-ingestion/EmailResearchForm'

export const metadata = { title: 'Email Research — Ber Wilson Intelligence' }

export default function EmailResearchPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Search size={18} className="text-muted-foreground" />
          Email Research
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sweep your Outlook threads for a person, email, or project. Ber AI reads the matching
          threads and attachments, assembles a research report, and takes you straight to the
          review screen — nothing is created until you confirm.
        </p>
      </div>

      <EmailResearchForm />

      <Link
        href="/email-ingestion"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Go to Email Ingestion
        <ArrowRight size={14} />
      </Link>
    </div>
  )
}
