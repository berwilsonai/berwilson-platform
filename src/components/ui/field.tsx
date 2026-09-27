'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/date-picker'

/**
 * The app's one form-field language.
 *
 * ⚠ WHY THIS EXISTS. Before it there were 278 raw `<input>`s across 68 files,
 * 142 `<select>`s and 62 `<textarea>`s, with **twenty-nine** separate local
 * `inputClass`/`fieldClass`/`labelClass` constants and almost no two of them
 * agreeing on height, padding or radius. Worse, 79% of controls carried a
 * label that sat next to the field but was not tied to it — so clicking the
 * word did not focus the box, and a screen reader announced an unlabelled
 * control. `Field` generates the id and the association, once, from `useId`.
 *
 * Focus follows `button.tsx`, deliberately: `focus-visible:ring-3`, never the
 * `focus:ring-2` that 248 hand-rolled sites used. `focus:` fires on a mouse
 * click too, which is why half the app flashed a ring every time you clicked
 * into a box.
 *
 * Composition, not configuration:
 *
 *   <Field label="Bid due date" hint="The submission deadline">
 *     <FieldDate name="bid_due_date" defaultValue={project.bid_due_date} />
 *   </Field>
 *
 * For a server-action form pass an explicit `id` — those submit by `name` and
 * their labels already use stable, readable ids; a generated `«r3»` would be
 * a regression in the markup a person reads.
 */

interface FieldContextValue {
  id: string
  describedById: string
  invalid: boolean
}

const FieldContext = React.createContext<FieldContextValue | null>(null)

function useFieldContext(): FieldContextValue | null {
  return React.useContext(FieldContext)
}

// ─── Field ───────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  error,
  required,
  id: idProp,
  className,
  labelClassName,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'id'> & {
  /** The visible label. Omit only when a neighbouring element already names the control. */
  label?: React.ReactNode
  /** Quiet helper text under the control. Announced via `aria-describedby`. */
  hint?: React.ReactNode
  /** An error message. Sets `aria-invalid` on the control and replaces the hint. */
  error?: React.ReactNode
  required?: boolean
  /** Explicit id — required for `<form action>` forms that submit by name. */
  id?: string
  labelClassName?: string
}) {
  const generated = React.useId()
  const id = idProp ?? generated
  const describedById = `${id}-description`
  const ctx = React.useMemo(
    () => ({ id, describedById, invalid: Boolean(error) }),
    [id, describedById, error]
  )

  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn('space-y-1.5', className)} {...props}>
        {label && (
          <label
            htmlFor={id}
            className={cn('block text-xs font-medium text-muted-foreground', labelClassName)}
          >
            {label}
            {required && (
              <span className="ml-0.5 text-destructive" aria-hidden>
                *
              </span>
            )}
          </label>
        )}
        {children}
        {error ? (
          <p id={describedById} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : hint ? (
          <p id={describedById} className="text-xs text-muted-foreground/80">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

// ─── Control styling ─────────────────────────────────────────────────────────

const controlVariants = cva(
  'w-full rounded-lg border border-input bg-background text-foreground transition-colors outline-none ' +
    'placeholder:text-muted-foreground/70 ' +
    'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ' +
    'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        /**
         * 44px on touch, 36px from `sm` up. This is the app's documented
         * minimum target size and the default for anything a thumb meets.
         */
        default: 'h-11 sm:h-9 px-3 text-base sm:text-sm',
        /** Inline editors and table cells, where the row height is the constraint. */
        sm: 'h-9 sm:h-8 px-2.5 text-sm sm:text-xs',
        /** Prominent single fields — a title, a search. */
        lg: 'h-12 sm:h-11 px-3.5 text-base',
      },
    },
    defaultVariants: { size: 'default' },
  }
)

type ControlSize = VariantProps<typeof controlVariants>['size']

interface WirableProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
}

/** Wire a control to its `<Field>` without clobbering an explicit prop. */
function useControlProps<T extends WirableProps>(props: T, hasOwnDescription: boolean): T {
  const ctx = useFieldContext()
  if (!ctx) return props
  return {
    ...props,
    id: props.id ?? ctx.id,
    'aria-describedby': props['aria-describedby'] ?? (hasOwnDescription ? ctx.describedById : undefined),
    'aria-invalid': props['aria-invalid'] ?? (ctx.invalid ? true : undefined),
  }
}

// ─── Input ───────────────────────────────────────────────────────────────────

function Input({
  className,
  size = 'default',
  type = 'text',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & { size?: ControlSize }) {
  const wired = useControlProps(props, true)
  return <input type={type} className={cn(controlVariants({ size }), className)} {...wired} />
}

// ─── Select ──────────────────────────────────────────────────────────────────

function Select({
  className,
  size = 'default',
  children,
  ...props
}: Omit<React.ComponentProps<'select'>, 'size'> & { size?: ControlSize }) {
  const wired = useControlProps(props, true)
  return (
    <select
      // `appearance-none` would take the native arrow with it and this app has
      // no popover Select to replace it — the chevron is the affordance.
      className={cn(controlVariants({ size }), 'cursor-pointer pr-2', className)}
      {...wired}
    >
      {children}
    </select>
  )
}

// ─── Textarea ────────────────────────────────────────────────────────────────

function Textarea({
  className,
  rows = 3,
  ...props
}: React.ComponentProps<'textarea'>) {
  const wired = useControlProps(props, true)
  return (
    <textarea
      rows={rows}
      className={cn(
        controlVariants({ size: 'default' }),
        // The height variants are for single-line controls; a textarea sizes
        // by `rows` and needs its own vertical padding.
        'h-auto min-h-[4.5rem] py-2 leading-relaxed resize-y',
        className
      )}
      {...wired}
    />
  )
}

// ─── Date ────────────────────────────────────────────────────────────────────

/**
 * The date control. Always this, never `<input type="date">` — the native one
 * renders differently on every platform and cannot be typed into consistently.
 */
function FieldDate({
  className,
  ...props
}: React.ComponentProps<typeof DatePicker>) {
  const ctx = useFieldContext()
  return <DatePicker id={props.id ?? ctx?.id} className={className} {...props} />
}

// ─── Layout ──────────────────────────────────────────────────────────────────

/**
 * A titled group of fields.
 *
 * Extracted from `ProjectForm`, which already had this shape written out six
 * times in longhand — the two longest forms in the app were the two doing it
 * right, so this is their pattern promoted rather than a new one invented.
 *
 * `collapsible` is how a 34-control form stops being a 34-control form: the
 * optional tails start closed, so the reader meets a dozen fields instead of
 * all of them, and — unlike a wizard — every field stays mounted, so the
 * server action, the validation and the tab order are untouched.
 */
function FormSection({
  title,
  description,
  collapsible = false,
  defaultOpen = true,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'section'>, 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const shown = collapsible ? open : true

  return (
    <section className={cn('space-y-4', className)} {...props}>
      <div className="space-y-1">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="group flex w-full items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="label-caps text-muted-foreground">{title}</span>
            <span className="text-xs text-muted-foreground/70" aria-hidden>
              {open ? '−' : '+'}
            </span>
          </button>
        ) : (
          <h2 className="label-caps text-muted-foreground">{title}</h2>
        )}
        {description && shown && (
          <p className="text-xs text-muted-foreground/80">{description}</p>
        )}
      </div>
      {shown && children}
    </section>
  )
}

/** The form grid. Column count is a prop, not a class string spelled out per form. */
function FormGrid({
  cols = 2,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { cols?: 1 | 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        cols === 2 && 'sm:grid-cols-2',
        cols === 3 && 'sm:grid-cols-3',
        cols === 4 && 'sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** Submit / cancel row. Six forms hand-rolled this. */
function FormActions({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export {
  Field,
  Input,
  Select,
  Textarea,
  FieldDate,
  FormSection,
  FormGrid,
  FormActions,
  controlVariants,
}
