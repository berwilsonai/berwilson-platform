'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/date-picker'
import { FIELD_CONTROL_SM_CLASS } from '@/lib/utils/field-classes'
import {
  type InlineFieldName,
  inlineEditValue,
  inlineFieldSpec,
} from '@/lib/projects/inline-fields'

/**
 * One field on a project, edited where it is read.
 *
 * Richard, 2026-10-30: *"Make all those fields editable on a project by double
 * clicking rather than going to the 'edit' button."*
 *
 * ⚠ DOUBLE-CLICK IS ONE OF FOUR DOORS, NOT THE ONLY ONE, and that is not
 * gold-plating. §12: a control that only appears on hover does not exist on a
 * phone, and one without `focus-visible:opacity-100` is invisible to a
 * keyboard — a double-click has BOTH problems and a third, because there is no
 * reliable double-tap on touch. So the same editor opens from:
 *
 *   - a double-click on the value (what was asked for),
 *   - Enter or F2 while the value has keyboard focus,
 *   - the pencil, which is a real button — hidden on hover from `sm:` up,
 *     ALWAYS VISIBLE below it, which is the §12 rule about gating the hiding
 *     rather than the control.
 *
 * ⚠ AND THE VALUE IS A `<button>`, NOT A `<div onDoubleClick>`. A div with a
 * handler is unreachable by keyboard and silent to a screen reader, so the
 * second and third doors above could not exist. The two are siblings rather
 * than nested, because a button inside a button is invalid markup that React
 * renders anyway and the browser then mis-dispatches.
 */
export default function InlineField({
  projectId,
  field,
  value,
  display,
  className,
  valueClassName,
  onSaved,
  labelled = true,
}: {
  projectId: string
  field: InlineFieldName
  /** The stored value, as it is on the row. */
  value: string | number | null | undefined
  /**
   * What the reader sees when not editing.
   *
   * ⚠ PASSED IN RATHER THAN DERIVED. The caller already knows how its own
   * surface renders this — `formatValue` for money, `STAGE_LABELS` for a
   * stage, a chip with a badge colour for a band — and §12 is clear that a
   * stored enum must never be printed at a reader. Deriving it here would mean
   * a second formatting table beside the ones that exist.
   */
  display: React.ReactNode
  className?: string
  valueClassName?: string
  /** Told the new stored value, so the page can reconcile without a reload. */
  onSaved?: (field: InlineFieldName, stored: string | number | null) => void
  /** Render the field's own label above the value. */
  labelled?: boolean
}) {
  const router = useRouter()
  const spec = inlineFieldSpec(field)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(() => inlineEditValue(field, value))
  const controlRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null)

  /**
   * Open the editor, seeding the draft from whatever the row holds NOW.
   *
   * ⚠ THE SEEDING HAPPENS HERE, IN THE HANDLER, NOT IN AN EFFECT ON `editing`.
   * Both work, and the effect version was wrong in two ways at once. It was a
   * `setState` synchronously inside an effect, which is the pattern §9 lists as
   * standing lint noise and which triggers a cascading render for no reason —
   * and more importantly it made opening the editor a two-render operation
   * whose correctness depended on `value` being fresh at the moment the effect
   * ran rather than at the moment of the press.
   *
   * The problem it was solving is real: `useState(initial)` runs its
   * initialiser ONCE, the record page re-renders on `router.refresh()` after
   * every save, so a second edit of the same field would otherwise open on the
   * value from first paint — correcting a typo twice in a row would silently
   * restore the typo. Seeding on the press fixes that with no effect at all.
   */
  function openEditor() {
    setDraft(inlineEditValue(field, value))
    setEditing(true)
  }

  // Focus the control the moment it exists, so the editor is typeable without
  // a second click. `select()` on a text field, because replacing is the
  // common case and a caret at position 0 makes you clear it by hand first.
  useEffect(() => {
    if (!editing) return
    const el = controlRef.current
    if (!el) return
    el.focus()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select()
  }, [editing])

  async function save(next: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next === '' ? null : next }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        project?: Record<string, string | number | null>
      }
      if (!res.ok) {
        /*
          ⚠ THE ROUTE'S OWN SENTENCE, NEVER A GENERIC ONE. `coerceInlineValue`
          writes the refusal — "Sector cannot be emptied — pick a value.",
          "Win probability must be Low, Medium, High." — and it is the only
          text that tells the reader what to do differently. The editor STAYS
          OPEN on a failure, with the draft intact, because closing it would
          throw away what they typed and leave the old value looking accepted.
        */
        toast.error(data.error ?? 'Could not save')
        return
      }
      // The stored value as the database now holds it — which for a band is
      // the percentage, not the word that was picked.
      const stored = data.project?.[field] ?? null
      onSaved?.(field, stored)
      setEditing(false)
      /*
        ⚠ ALWAYS, AND NOT ONLY WHEN THERE IS NO `onSaved`.

        §12: an optimistic client mutation with no `router.refresh()` leaves
        every server-rendered figure lying until the tab is reloaded — and this
        control is used INSIDE server components (the record Overview, the
        pursuit rail), where there is no client state to update at all. Editing
        the stage would have left the stage chip right and the Pursuit Snapshot,
        the weighted value, the board totals and the sidebar badge all stale on
        the same screen.

        `onSaved` is the narrower half: a CLIENT caller that owns a list can
        move its own row immediately, and the refresh then only confirms it.
        A server caller cannot be passed a function across the boundary at
        all, which is why it cannot be the only mechanism.
      */
      router.refresh()
    } catch {
      toast.error('Could not save — the platform did not answer')
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(inlineEditValue(field, value))
    setEditing(false)
  }

  // ─── reading ──────────────────────────────────────────────────────────────

  if (!editing) {
    return (
      <div className={cn('group/inline space-y-0.5', className)}>
        {labelled && (
          <div className="label-caps text-muted-foreground">{spec.label}</div>
        )}
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            onDoubleClick={openEditor}
            onKeyDown={(e) => {
              // Enter and F2 are the two conventions for "edit this cell".
              // Space is deliberately NOT bound: it scrolls the page, and a
              // value is read far more often than it is changed.
              if (e.key === 'Enter' || e.key === 'F2') {
                e.preventDefault()
                openEditor()
              }
            }}
            title={`${spec.label} — double-click to edit`}
            className={cn(
              'text-left rounded -mx-1 px-1 outline-none',
              'focus-visible:ring-3 focus-visible:ring-ring/50',
              // A hint that this is live, without a border that would make
              // every fact on the page look like a form control.
              'hover:bg-muted/50 transition-colors',
              valueClassName
            )}
          >
            {display}
          </button>
          <button
            type="button"
            onClick={openEditor}
            aria-label={`Edit ${spec.label}`}
            title={`Edit ${spec.label}`}
            className={cn(
              'mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground transition-opacity',
              'hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              // ⚠ THE HIDING IS GATED ON `sm:`, NOT THE BUTTON (§12). Below
              // `sm` there is no hover and no double-click, so the pencil is
              // the ONLY door and must always be on screen.
              'sm:opacity-0 sm:group-hover/inline:opacity-100 focus-visible:opacity-100'
            )}
          >
            <Pencil size={11} />
          </button>
        </div>
      </div>
    )
  }

  // ─── editing ──────────────────────────────────────────────────────────────

  /** Enter commits, Escape abandons — for the controls where that is safe. */
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
    if (e.key === 'Enter' && spec.kind !== 'textarea') {
      e.preventDefault()
      save(draft)
    }
  }

  const control = (() => {
    switch (spec.kind) {
      case 'select':
      case 'band':
        return (
          <select
            ref={(el) => { controlRef.current = el }}
            value={draft}
            onChange={(e) => {
              // A picker commits on pick. Choosing from a list and then having
              // to press a tick is two gestures for one decision, and this is
              // the control Richard reaches for most (stage, win probability).
              setDraft(e.target.value)
              save(e.target.value)
            }}
            onKeyDown={keys}
            disabled={saving}
            aria-label={spec.label}
            className={FIELD_CONTROL_SM_CLASS}
          >
            {/* Only offered where the column can actually take a null — see
                `clearable` in the spec, which exists because `sector` is NOT
                NULL with no default and an explicit null is `23502`. */}
            {spec.clearable && <option value="">Not set</option>}
            {spec.options?.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )

      case 'date':
        return (
          <DatePicker
            value={draft}
            onChange={(v: string) => { setDraft(v); save(v) }}
            className="h-9 sm:h-8 px-2.5 text-sm sm:text-xs"
          />
        )

      case 'textarea':
        return (
          <textarea
            ref={(el) => { controlRef.current = el }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
            disabled={saving}
            rows={5}
            aria-label={spec.label}
            className={cn(
              'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground',
              'leading-relaxed resize-y outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
            )}
          />
        )

      default:
        return (
          <input
            ref={(el) => { controlRef.current = el }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={keys}
            disabled={saving}
            // `inputMode`, not `type="number"`: a money field has to accept
            // "$12,500" the way somebody types it, and a number input silently
            // discards the whole value when it cannot parse it.
            inputMode={spec.kind === 'money' ? 'decimal' : undefined}
            aria-label={spec.label}
            className={FIELD_CONTROL_SM_CLASS}
          />
        )
    }
  })()

  // A select and a date picker commit on change, so a tick beside them would
  // be a second way to do what has already happened.
  const needsCommit = spec.kind === 'text' || spec.kind === 'textarea' || spec.kind === 'money'

  return (
    <div className={cn('space-y-1', className)}>
      {labelled && <div className="label-caps text-muted-foreground">{spec.label}</div>}
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{control}</div>
        {needsCommit && (
          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
            <button
              type="button"
              onClick={() => save(draft)}
              disabled={saving}
              aria-label={`Save ${spec.label}`}
              className="rounded p-1 text-positive hover:bg-positive-surface outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              aria-label={`Cancel editing ${spec.label}`}
              className="rounded p-1 text-muted-foreground hover:bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {!needsCommit && saving && (
          <Loader2 size={13} className="mt-2 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {spec.hint && <p className="text-xs text-muted-foreground">{spec.hint}</p>}
    </div>
  )
}
