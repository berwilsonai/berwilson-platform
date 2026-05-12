import type { CapTableHolder, CapTableInputs } from '@/types/equity-domain'
import { ERIC_OWNERSHIP_FLOOR } from '@/lib/equity/constants'

/**
 * Validate cap table: Eric >= 51%, total = 100%
 */
export function validateCapTable(holders: CapTableHolder[]): {
  valid: boolean
  total: number
  ericPercentage: number
  errors: string[]
} {
  const total = holders.reduce((sum, h) => sum + h.percentage, 0)
  const ericHolder = holders.find((h) => h.classB)
  const ericPercentage = ericHolder?.percentage ?? 0
  const errors: string[] = []

  if (Math.abs(total - 100) > 0.1) {
    errors.push(`Total is ${total.toFixed(1)}%, must equal 100.0%`)
  }
  if (ericPercentage < ERIC_OWNERSHIP_FLOOR) {
    errors.push(`Eric's ownership (${ericPercentage.toFixed(1)}%) is below the ${ERIC_OWNERSHIP_FLOOR}% floor`)
  }

  return {
    valid: errors.length === 0,
    total,
    ericPercentage,
    errors,
  }
}

/**
 * Auto-rebalance non-locked holders when one holder's percentage changes.
 * Eric (classB) is always locked. Other holders can be toggled locked.
 */
export function rebalanceHolders(
  holders: CapTableHolder[],
  changedIndex: number,
  newPercentage: number
): CapTableHolder[] {
  const updated = holders.map((h, i) => ({ ...h }))
  updated[changedIndex].percentage = newPercentage

  const ericHolder = updated.find((h) => h.classB)
  if (!ericHolder) return updated

  // Calculate how much is locked (Eric + any locked holders + the changed holder)
  const lockedTotal = updated.reduce(
    (sum, h, i) =>
      sum + (h.classB || h.locked || i === changedIndex ? h.percentage : 0),
    0
  )

  // Available for unlocked holders
  const available = 100 - lockedTotal

  // Get unlocked, unchanged holders
  const unlocked = updated.filter(
    (h, i) => !h.classB && !h.locked && i !== changedIndex
  )

  if (unlocked.length === 0 || available < 0) return updated

  // Current total of unlocked holders
  const currentUnlockedTotal = unlocked.reduce((sum, h) => sum + h.percentage, 0)

  // Redistribute proportionally
  unlocked.forEach((h) => {
    if (currentUnlockedTotal > 0) {
      h.percentage = Math.max(0, (h.percentage / currentUnlockedTotal) * available)
    } else {
      h.percentage = available / unlocked.length
    }
  })

  return updated
}

/**
 * Simulate dilution when new equity is issued.
 * Eric (Class B) stays fixed; Class A holders dilute proportionally.
 */
export function simulateDilution(
  holders: CapTableHolder[],
  newHolderName: string,
  newPercentage: number
): CapTableHolder[] {
  if (newPercentage <= 0 || newPercentage >= 100) return holders

  const ericHolder = holders.find((h) => h.classB)
  if (!ericHolder) return holders

  const ericPct = ericHolder.percentage
  const classATotal = 100 - ericPct
  const dilutionFactor = (classATotal - newPercentage) / classATotal

  const result = holders.map((h) => {
    if (h.classB) return { ...h } // Eric stays fixed
    return {
      ...h,
      percentage: h.percentage * dilutionFactor,
    }
  })

  result.push({
    name: newHolderName,
    percentage: newPercentage,
    role: 'New',
    classB: false,
  })

  return result
}

/**
 * Calculate dollar value of each holder's stake at a given valuation.
 */
export function calculateHolderValues(
  holders: CapTableHolder[],
  companyValuation: number
): { name: string; percentage: number; value: number; role: string }[] {
  return holders.map((h) => ({
    name: h.name,
    percentage: h.percentage,
    value: (h.percentage / 100) * companyValuation,
    role: h.role,
  }))
}
