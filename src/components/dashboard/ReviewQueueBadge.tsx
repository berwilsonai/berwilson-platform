import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'

interface ReviewQueueBadgeProps {
  count: number
}

export default function ReviewQueueBadge({ count }: ReviewQueueBadgeProps) {
  if (count === 0) return null

  return (
    <Link
      href="/review"
      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 ring-inset hover:bg-amber-100 transition-colors"
    >
      <ClipboardCheck size={13} />
      {count} pending review{count !== 1 ? 's' : ''}
    </Link>
  )
}
