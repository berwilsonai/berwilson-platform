'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, Save, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useScenarios, useCreateScenario } from '@/hooks/equity-use-scenarios'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import {
  getDefaultValuationInputs,
  getDefaultCapTableInputs,
  getDefaultInvestorDealInputs,
  getDefaultOriginatorFeeInputs,
  getDefaultExitScenarioInputs,
} from '@/stores/equity-scenario-store'

export default function ScenarioSelector() {
  const router = useRouter()
  const { data: scenarios, isLoading } = useScenarios()
  const createScenario = useCreateScenario()
  const store = useScenarioStore()
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    setCreating(true)
    try {
      const result = await createScenario.mutateAsync({
        name: 'New Scenario',
        valuation_inputs: getDefaultValuationInputs(),
        cap_table_inputs: getDefaultCapTableInputs(),
        nancy_deal_inputs: getDefaultInvestorDealInputs(),
        originator_fee_inputs: getDefaultOriginatorFeeInputs(),
        exit_scenario_inputs: getDefaultExitScenarioInputs(),
      } as Record<string, unknown>)
      store.loadScenario(result)
      router.push('/equity/exit-scenarios')
    } finally {
      setCreating(false)
    }
  }

  function handleSelect(scenario: { id: string; name: string }) {
    // Load will be handled by the page that needs it
    store.setActiveScenario(scenario.id, scenario.name)
    router.push('/equity/exit-scenarios')
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading scenarios...
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Saved Scenarios</h2>
        <Button
          size="sm"
          onClick={handleCreate}
          disabled={creating}
          className="h-8 text-xs"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          <span className="ml-1">New Scenario</span>
        </Button>
      </div>

      {scenarios && scenarios.length > 0 ? (
        <div className="space-y-2">
          {scenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSelect(s)}
              className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors hover:bg-muted ${
                store.activeScenarioId === s.id
                  ? 'border-amber-300 dark:border-amber-700/60 bg-amber-50/50 dark:bg-amber-950/40'
                  : 'border-border'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{s.name}</span>
                {store.activeScenarioId === s.id && (
                  <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                    {store.isDirty ? (
                      <><Save size={10} /> Unsaved</>
                    ) : (
                      <><Check size={10} /> Active</>
                    )}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Updated {new Date(s.updated_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No scenarios yet. Create one to get started.
        </p>
      )}
    </div>
  )
}
