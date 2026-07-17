'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle, XCircle, ArrowRightLeft, Loader2, FolderPlus } from 'lucide-react'
import Link from 'next/link'
import ReviewEditModal from './ReviewEditModal'

interface ReviewActionsProps {
  reviewId: string
  recordId: string
  sourceTable: string
  sourceLink: string
  currentProjectId?: string
  allProjects: { id: string; name: string }[]
  reason?: string
}

export default function ReviewActions({
  reviewId,
  recordId,
  sourceTable,
  currentProjectId,
  allProjects,
  reason,
}: ReviewActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | 'reassign' | null>(null)
  const [resolved, setResolved] = useState<string | null>(null)
  const [showReassign, setShowReassign] = useState(false)
  const [reassignError, setReassignError] = useState<string | null>(null)

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
      toast.success(resolution === 'approved' ? 'Item approved' : 'Item rejected')
      router.refresh()
    } else {
      toast.error('Failed to resolve item')
    }
  }

  async function reassign(projectId: string) {
    setLoading('reassign')
    setReassignError(null)
    const res = await fetch(`/api/review/${reviewId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    })
    setLoading(null)
    setShowReassign(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const msg = data.error ?? 'Reassign failed — please try again'
      setReassignError(msg)
      toast.error(msg)
    } else {
      toast.success('Item reassigned to project')
      router.refresh()
    }
  }

  function handleEditResolved() {
    setResolved('edited')
  }

  if (resolved) {
    const labels: Record<string, { text: string; color: string }> = {
      approved: { text: 'Approved', color: 'text-emerald-600 dark:text-emerald-400' },
      rejected: { text: 'Rejected', color: 'text-red-600 dark:text-red-400' },
      edited: { text: 'Edited & Approved', color: 'text-blue-600 dark:text-blue-400' },
    }
    const label = labels[resolved] ?? labels.approved
    return (
      <span className={`text-xs font-medium ${label.color}`}>
        {label.text}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {reassignError && (
        <p className="text-xs text-red-600 dark:text-red-400">{reassignError}</p>
      )}
    <div className="flex items-center gap-2 flex-wrap">
      {/* Approve */}
      <button
        onClick={() => resolve('approved')}
        disabled={loading !== null}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50 transition-colors"
      >
        <CheckCircle size={13} />
        {loading === 'approve' ? 'Approving...' : 'Approve'}
      </button>

      {/* Reject */}
      <button
        onClick={() => resolve('rejected')}
        disabled={loading !== null}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 transition-colors"
      >
        <XCircle size={13} />
        {loading === 'reject' ? 'Rejecting...' : 'Reject'}
      </button>

      {/* Edit (modal) */}
      <ReviewEditModal
        reviewId={reviewId}
        recordId={recordId}
        sourceTable={sourceTable}
        onResolved={handleEditResolved}
      />

      {/* Create Project — shown when email has no matching project */}
      {reason === 'unknown_project' && (
        <Link
          href="/projects/new?from=review"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Create a new project — you'll be returned here to reassign"
        >
          <FolderPlus size={13} />
          New project
        </Link>
      )}

      {/* Reassign */}
      <div className="relative">
        <button
          onClick={() => setShowReassign(!showReassign)}
          disabled={loading !== null}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {loading === 'reassign' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ArrowRightLeft size={13} />
          )}
          Reassign
        </button>

        {showReassign && (
          <>
            {/* Click-away overlay */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowReassign(false)}
            />
            <div className="absolute right-0 bottom-full mb-1 z-50 w-64 rounded-lg border border-border bg-popover elev-3">
              <div className="p-2 border-b border-border">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Move to project
                </p>
              </div>
              <div className="max-h-48 overflow-y-auto p-1">
                {allProjects
                  .filter((p) => p.id !== currentProjectId)
                  .map((project) => (
                    <button
                      key={project.id}
                      onClick={() => reassign(project.id)}
                      disabled={loading !== null}
                      className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-accent disabled:opacity-50 transition-colors"
                    >
                      {project.name}
                    </button>
                  ))}
                {allProjects.filter((p) => p.id !== currentProjectId).length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No other projects available
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </div>
  )
}
