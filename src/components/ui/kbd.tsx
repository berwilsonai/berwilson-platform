import { cn } from '@/lib/utils'

/**
 * A key cap. One rendering of a keystroke, so the hint under the Decide queue,
 * the 404 and the header's ⌘K badge do not each invent their own.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-foreground/75',
        className
      )}
    >
      {children}
    </kbd>
  )
}
