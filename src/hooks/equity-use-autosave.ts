'use client'

import { useEffect, useRef } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { useUpdateScenario } from '@/hooks/equity-use-scenarios'

export function useAutosave() {
  const store = useScenarioStore()
  const updateScenario = useUpdateScenario()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!store.activeScenarioId || !store.isDirty) return

    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      updateScenario.mutate(
        {
          id: store.activeScenarioId!,
          name: store.activeScenarioName,
          valuation_inputs: store.valuation,
          cap_table_inputs: store.capTable,
          nancy_deal_inputs: store.investorDeal,
          originator_fee_inputs: store.originatorFees,
          exit_scenario_inputs: store.exitScenarios,
        },
        {
          onSuccess: () => {
            store.markClean()
          },
        }
      )
    }, 1500)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store.activeScenarioId,
    store.isDirty,
    store.valuation,
    store.capTable,
    store.investorDeal,
    store.originatorFees,
    store.exitScenarios,
    store.activeScenarioName,
  ])
}
