'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { X } from 'lucide-react'

export default function RemovePlayerButton({
  playerId,
  playerName,
}: {
  playerId: string
  playerName: string
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button
          onClick={() => setConfirming(false)}
          className="h-6 px-2 rounded text-xs border border-input hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          disabled={removing}
          onClick={async () => {
            setRemoving(true)
            const res = await fetch(`/api/project-players/${playerId}`, { method: 'DELETE' })
            if (res.ok) {
              toast.success(`${playerName} removed from project`)
              router.refresh()
            } else {
              toast.error('Failed to remove player')
              setRemoving(false)
              setConfirming(false)
            }
          }}
          className="h-6 px-2 rounded text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-60"
        >
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={`Remove ${playerName} from project`}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
    >
      <X size={14} />
    </button>
  )
}
