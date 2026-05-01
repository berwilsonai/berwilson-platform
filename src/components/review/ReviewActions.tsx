'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle, XCircle, Pencil } from 'lucide-react'
import Link from 'next/link'

interface ReviewActionsProps {
  reviewId: string
  sourceLink: string
}

export default function ReviewActions({ reviewId, sourceLink }: ReviewActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [resolved, setResolved] = useState<'approved' | 'rejected' | null>(null)

  async function resolve(resolution: 'approved' | 'rejected') {
    setLoading(resolution === 'approved' ? 'approve' : 'reject')
    const res = await fetch(`/api/review/${reviewId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution }),
    })
    setLoading(null)
    if (res.ok) {
      setResolved(resolution)
      router.refresh()
    }
  }

  if (resolved) {
    return (
      <span
        className={`text-xs font-medium ${
          resolved === 'approved' ? 'text-emerald-600' : 'text-red-600'
        }`}
      >
        {resolved === 'approved' ? 'Approved' : 'Rejected'}
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => resolve('approved')}
        disabled={loading !== null}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
      >
        <CheckCircle size={13} />
        {loading === 'approve' ? 'Approving…' : 'Approve'}
      </button>
      <button
        onClick={() => resolve('rejected')}
        disabled={loading !== null}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
      >
        <XCircle size={13} />
        {loading === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
      <Link
        href={sourceLink}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Pencil size={13} />
        Edit
      </Link>
    </div>
  )
}
