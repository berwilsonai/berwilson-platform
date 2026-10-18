'use client'

import { useEffect, useState } from 'react'

import { Kbd } from '@/components/ui/kbd'
import { SHORTCUTS, SCOPE_LABELS, type Shortcut } from '@/lib/ui/docks'

/**
 * The shortcuts help, on `?`.
 *
 * ⚠ THERE WAS NO HELP AT ALL. ⌘K and ⌘J had a visible hint in the header, ⌘/
 * was discoverable only through a `title=` attribute — which never appears on a
 * phone and never on keyboard focus — and `/decide`'s vim keys were stated on
 * `/decide` and nowhere else. So the best-executed interactions in the app were
 * the least findable.
 *
 * ⚠ GENERATED FROM `SHORTCUTS`, never hand-listed, so a key added to the
 * registry cannot be missing from the help (§12).
 *
 * `?` is unmodified, so the handler has to stand down inside a field or the
 * reader cannot type a question mark. Modified combinations fall through
 * untouched, which is what leaves ⌘K and ⌘J working.
 */
export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== '?') return
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  if (!open) return null

  const scopes = [...new Set(SHORTCUTS.map((s) => s.scope))]

  return (
    <div
      className="print:hidden fixed inset-0 z-[80] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-foreground/20 backdrop-blur-[1px]"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-card elev-3 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
          <span className="text-xs text-muted-foreground">
            <Kbd>?</Kbd> or <Kbd>esc</Kbd> to close
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {scopes.map((scope) => (
            <div key={scope}>
              <p className="label-caps text-muted-foreground mb-2">{SCOPE_LABELS[scope]}</p>
              <dl className="space-y-1.5">
                {SHORTCUTS.filter((s) => s.scope === scope).map((s: Shortcut) => (
                  <div key={s.keys.join('+') + s.label} className="flex items-baseline gap-3">
                    <dt className="flex shrink-0 items-center gap-1 w-28">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dt>
                    <dd className="text-sm text-muted-foreground">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
