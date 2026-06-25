'use client'

import { useState } from 'react'
import { Bot, ChevronDown, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import AgentChat from './AgentChat'

interface ProjectAgentPanelProps {
  projectId: string
}

/**
 * Inline "Ask Ber AI" panel anchored to the top of a project.
 * Replaces the old floating Agent button — it's scoped to this project and
 * can read across its documents, notes, milestones, players and financials.
 */
export default function ProjectAgentPanel({ projectId }: ProjectAgentPanelProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden elev-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        aria-expanded={open}
      >
        <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Bot size={16} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
            Ask Ber AI <Sparkles size={12} className="text-primary" />
          </p>
          <p className="text-xs text-muted-foreground truncate">
            Question this project&apos;s documents, notes, milestones &amp; financials
          </p>
        </div>
        <ChevronDown
          size={18}
          className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="border-t border-border h-[60vh] max-h-[560px] min-h-[360px] flex flex-col animate-fade-in-up">
          <AgentChat projectId={projectId} className="flex-1 min-h-0" />
        </div>
      )}
    </div>
  )
}
