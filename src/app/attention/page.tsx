import { redirect } from 'next/navigation'

// Folded into the dashboard (2026-07-03) — Needs Attention lives there now.
export default function AttentionRedirect() {
  redirect('/dashboard')
}
