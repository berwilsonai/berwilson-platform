'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import SteelDealForm from './SteelDealForm'
import type { SteelDeal, SteelDealService } from '@/lib/supabase/types'

interface SourceContact {
  id: string
  full_name: string
  company: string | null
  is_organization: boolean | null
}

interface Props {
  deal: SteelDeal
  /** Steel sales reps for the Salesperson picker (+ the deal's current one). */
  reps: { id: string; name: string }[]
  /** The whole contacts directory — the marketing / referral source picker. */
  contacts: SourceContact[]
  /** The deal's current marketing/referral source (edit prefill). */
  referralSource: { id: string; full_name: string } | null
  /** Lead-source channels already in use, for suggestions. */
  leadSources: string[]
  /** The deal's existing line items. */
  services: SteelDealService[]
  /** Cost/margin/rate/referral controls — admin/executive only. */
  canSeeFinancials: boolean
}

/**
 * The single "Edit" affordance on the deal detail page: a right slide-over that
 * keeps you anchored on the deal instead of navigating to a separate edit page.
 * Reuses SteelDealForm as-is; on save the form returns in place and we close +
 * refresh so the detail re-renders with the new data.
 */
export default function SteelEditDrawer({
  deal,
  reps,
  contacts,
  referralSource,
  leadSources,
  services,
  canSeeFinancials,
}: Props) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const handleSaved = useCallback(() => {
    setOpen(false)
    router.refresh()
  }, [router])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors"
      >
        <Pencil size={13} />
        Edit
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
            <SheetTitle>Edit deal</SheetTitle>
            <SheetDescription className="truncate">{deal.name}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {/* Remount on each open so fields reset to the latest saved values. */}
            {open && (
              <SteelDealForm
                mode="edit"
                deal={deal}
                reps={reps}
                contacts={contacts}
                referralSource={referralSource}
                leadSources={leadSources}
                services={services}
                canSeeFinancials={canSeeFinancials}
                onSaved={handleSaved}
                onCancel={() => setOpen(false)}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
