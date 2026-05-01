import { Brain } from 'lucide-react'
import EmptyState from '@/components/shared/EmptyState'

export const metadata = { title: 'Intel — Ber Wilson Intelligence' }

export default function IntelPage() {
  return (
    <EmptyState
      icon={Brain}
      title="Intelligence"
      description="AI-powered search and synthesis will be available in Phase 3."
    />
  )
}
