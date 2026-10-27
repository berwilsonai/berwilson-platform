import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // `elev-1` rather than a raw shadow-*: it is the house idiom, it is the
        // token that just became a real shadow again, and the conventions test
        // ratchets raw `shadow-*` in components downward.
        default:
          "bg-primary text-primary-foreground elev-1 hover:bg-primary/90 active:bg-primary/80 active:scale-[0.98]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground hover:shadow-sm aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        /*
          ⚠ NAMED ON 2026-10-26 BECAUSE IT ALREADY EXISTED. `bg-foreground
          text-background` appears in 65 files — including a byte-identical
          retry button in 42 of the 55 `error.tsx` files — as a de-facto
          "inverse" button that `button.tsx` had no variant for. An unnamed
          variant in 65 files is a sixth button style nobody can restyle in one
          place, which is exactly the drift this primitive exists to prevent.
        */
        inverse:
          "bg-foreground text-background elev-1 hover:bg-foreground/90 active:bg-foreground/80",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
        ── SIZES, RAISED ONE STEP ON 2026-10-26 ────────────────────────────────
        At the old `--spacing: 0.22rem` the default button was `h-8` = 28.2px —
        smaller than it reads in the source, and visibly timid next to the
        chunky primary actions that make Jobber and Attio feel like products.
        At 0.25rem these are 28 / 32 / 36 / 40px, and the padding opened up with
        them: `px-2.5` on a primary action was the tightest thing on the screen.

        ⚠ The per-size `rounded-[min(var(--radius-md),10px)]` caps are GONE.
        They existed to stop a small button looking like a pill back when
        `--radius` was 4px and `--radius-md` was 3.2px, so the `min()` never
        bound anything. At 8px, `--radius-md` is 6.4px and the cap is still
        inert — an expression that has never once changed a pixel, in four
        places. Small buttons now take the same `rounded-lg` as every other
        surface, which is the point of having one radius ladder.

        ⚠ None of these meet the 44px touch floor, and deliberately so: a
        touch target is written absolutely (`h-[2.75rem]`) by the caller that
        needs one, because it is a physical constraint rather than a size step.
        `StepUpPrompt` already does exactly this.
      */
      size: {
        default:
          "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-[0.95rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
