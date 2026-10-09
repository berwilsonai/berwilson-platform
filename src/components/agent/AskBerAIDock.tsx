'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, X } from 'lucide-react'
import AgentChat from './AgentChat'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/**
 * Which record the reader is standing on, as a TABLE rather than a regex per
 * kind.
 *
 * ⚠ It was one inline `/projects/<uuid>` match, so ⌘J on an OPPORTUNITY — the
 * record type carrying most of the live pipeline since it gained the same child
 * tables (2026-09-23) — opened the agent portfolio-wide, and the reader had to
 * name the deal in the question. Adding the next kind (a steel deal, a vehicle)
 * is a row here plus a prop on AgentChat, which `tsc` then demands everywhere.
 */
const SCOPE_ROUTES: { kind: 'project' | 'opportunity'; pattern: RegExp; noun: string }[] = [
  { kind: 'project', pattern: new RegExp(`^/projects/(${UUID})`, 'i'), noun: 'project' },
  { kind: 'opportunity', pattern: new RegExp(`^/opportunities/(${UUID})`, 'i'), noun: 'deal' },
]

/** Module scope, because it needs nothing but its argument (§12). */
function resolveScope(pathname: string) {
  for (const route of SCOPE_ROUTES) {
    const id = pathname.match(route.pattern)?.[1]
    if (id) return { kind: route.kind, id, noun: route.noun }
  }
  return null
}

/**
 * Ambient "Ask Ber AI" — a global slide-over hosting the executive agent,
 * available from every page via the header button, ⌘J / Ctrl+J, or a
 * window 'open-ber-ai' CustomEvent (optionally carrying {query}).
 *
 * Context-aware: on a project or opportunity page the agent is scoped to that
 * record (soft default — it can still reach portfolio-wide when asked).
 */
export default function AskBerAIDock() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState('')

  const scope = resolveScope(pathname)

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
              {scope
                ? `Scoped to this ${scope.noun} — can reach the whole portfolio`
                : 'Across your entire portfolio and knowledge base'}
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

        {/* `key` on the scope, so walking from one deal to another starts the
            conversation the reader expects rather than continuing the last. */}
        <AgentChat
          key={scope?.id ?? 'portfolio'}
          projectId={scope?.kind === 'project' ? scope.id : undefined}
          opportunityId={scope?.kind === 'opportunity' ? scope.id : undefined}
          initialInput={seed}
          placeholder={scope ? `Ask about this ${scope.noun}…` : 'Ask anything across the portfolio…'}
          className="flex-1 min-h-0"
        />
      </div>
    </div>
  )
}
