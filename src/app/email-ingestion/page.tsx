import { redirect } from 'next/navigation'

// Email Intake merged into the unified Intake destination (2026-07-17).
// The /email-ingestion/[id] review routes remain live under this segment.
export default function EmailIngestionRedirect() {
  redirect('/intake')
}
