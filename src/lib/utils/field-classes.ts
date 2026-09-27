/**
 * The class strings behind `src/components/ui/field.tsx`.
 *
 * They live here, outside the `'use client'` module, for two reasons: a server
 * component may need to style a control without pulling a client boundary in
 * (§12), and the migration path off the old hand-rolled forms is to repoint a
 * file's local `inputClass` at these rather than to rewrite its markup.
 *
 * ⚠ THERE WERE TWENTY-NINE COPIES OF THIS. Five of them — ProjectForm,
 * OpportunityForm, ContactForm, InvestorForm and SteelDealForm — were
 * byte-identical, and the rest disagreed on height, padding or radius. Every
 * one of them used `focus:ring-2`, which fires on a mouse click as well as on
 * keyboard focus, so clicking into any field in the app flashed a ring at you.
 *
 * Changes here are felt everywhere. That is the point.
 */

/** A single-line control: input, select. 44px on touch, 36px from `sm` up. */
export const FIELD_CONTROL_CLASS =
  'h-11 sm:h-9 w-full rounded-lg border border-input bg-background px-3 text-base sm:text-sm text-foreground ' +
  'transition-colors placeholder:text-muted-foreground/70 outline-none ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** The compact variant, for inline editors and table cells. */
export const FIELD_CONTROL_SM_CLASS =
  'h-9 sm:h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm sm:text-xs text-foreground ' +
  'transition-colors placeholder:text-muted-foreground/70 outline-none ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** A multi-line control. Sizes by `rows`, so it carries its own padding. */
export const FIELD_TEXTAREA_CLASS =
  'w-full min-h-[4.5rem] rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm text-foreground ' +
  'leading-relaxed resize-y transition-colors placeholder:text-muted-foreground/70 outline-none ' +
  'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

/** The field label. */
export const FIELD_LABEL_CLASS = 'block text-xs font-medium text-muted-foreground mb-1'
