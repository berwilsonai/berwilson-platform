'use client'

import { useState } from 'react'
import { Bot, X, MessageSquare } from 'lucide-react'
import AgentChat from './AgentChat'

interface AgentSidebarProps {
  projectId: string
}

export default function AgentSidebar({ projectId }: AgentSidebarProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Toggle button — fixed on right edge */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-primary-foreground shadow-lg hover:bg-primary/90 transition-all hover:shadow-xl"
        >
          <MessageSquare size={16} />
          <span className="text-sm font-medium">Agent</span>
        </button>
      )}

      {/* Sidebar panel */}
      {open && (
        <div className="fixed right-0 top-0 bottom-0 z-50 w-[400px] max-w-[90vw] bg-background border-l shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot size={14} className="text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Executive Agent</p>
                <p className="text-[10px] text-muted-foreground">Project-scoped intelligence</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Chat body */}
          <AgentChat projectId={projectId} className="flex-1 min-h-0" />
        </div>
      )}
    </>
  )
}
