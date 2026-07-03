import { redirect } from 'next/navigation'

// Folded into Team Tasks (2026-07-03) — the workload strip there shows per-person load.
export default function CapacityRedirect() {
  redirect('/tasks')
}
