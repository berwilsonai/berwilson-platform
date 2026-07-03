import { redirect } from 'next/navigation'

// Folded into the Directory (2026-07-03) — Vendors & Contractors is a tab on /contacts now.
// Detail pages (/vendors/[id]) and /vendors/new still live here.
export default function VendorsRedirect() {
  redirect('/contacts?tab=vendors')
}
