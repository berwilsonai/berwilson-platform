'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, X } from 'lucide-react'
import AgentChat from './AgentChat'

/**
 * Ambient "Ask Ber AI" — a global slide-over hosting the executive agent,
 * available from every page via the header button, ⌘J / Ctrl+J, or a
 * window 'open-ber-ai' CustomEvent (optionally carrying {query}).
 *
 * Context-aware: on a project page the agent is scoped to that project
 * (soft default — it can still reach portfolio-wide when asked).
 */
export default function AskBerAIDock() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState('')

  // Project scope from the route: /projects/<uuid>[/...]
  const projectId = pathname.match(
    /^\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  )?.[1]

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    function onOpenEvent(e: Event) {
      const detail = (e as CustomEvent<{ query?: string }>).detail
      if (detail?.query) setSeed(detail.query)
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('open-ber-ai', onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('open-ber-ai', onOpenEvent)
    }
  }, [])

  // Stays mounted while closed so the conversation survives close/reopen.
  return (
    <div className={`fixed inset-0 z-[70] ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      {/* Backdrop */}
      {open && (
        <button
          aria-label="Close Ask Ber AI"
          className="absolute inset-0 bg-foreground/30 backdrop-blur-sm animate-fade-in-up"
          style={{ animationDuration: '0.15s' }}
          onClick={close}
        />
      )}

      {/* Slide-over */}
      <div
        role="dialog"
        aria-label="Ask Ber AI"
        className={`absolute inset-y-0 right-0 w-full sm:w-[460px] bg-background border-l border-border elev-3 flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 h-14 px-4 border-b border-border shrink-0">
          <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Bot size={16} className="text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Ask Ber AI</p>
            <p className="text-xs text-muted-foreground truncate">
              {projectId ? 'Scoped to this project — can reach the whole portfolio' : 'Across your entire portfolio and knowledge base'}
            </p>
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <AgentChat
          key={projectId ?? 'portfolio'}
          projectId={projectId}
          initialInput={seed}
          placeholder={projectId ? 'Ask about this project…' : 'Ask anything across the portfolio…'}
          className="flex-1 min-h-0"
        />
      </div>
    </div>
  )
}
