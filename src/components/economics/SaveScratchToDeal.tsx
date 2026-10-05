'use client'

/**
 * Put a quick calc onto a deal.
 *
 * ⚠ IT ADDS TO AN EXISTING MODEL RATHER THAN REPLACING IT, and the button says
 * so once a target is chosen. A scratch calc silently overwriting a model
 * somebody curated would be the worst thing this feature could do.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { scratchToParams, type ScratchInput } from '@/lib/economics/scratch'

interface Record_ {
  id: string
  name: string
  kind: 'project' | 'opportunity'
}

export default function SaveScratchToDeal({ input }: { input: ScratchInput }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [records, setRecords] = useState<Record_[] | null>(null)
  const [withheld, setWithheld] = useState(0)
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')

  async function openPicker() {
    setOpen(true)
    if (records) return
    setLoading(true)
    try {
      const res = await fetch('/api/economics/records')
      const payload = (await res.json()) as {
        projects?: Record_[]
        opportunities?: Record_[]
        withheld_protected?: number
        error?: string
      }
      if (!res.ok) {
        toast.error(payload.error ?? 'Could not load the deals')
        return
      }
      setRecords([...(payload.projects ?? []), ...(payload.opportunities ?? [])])
      setWithheld(payload.withheld_protected ?? 0)
    } finally {
      setLoading(false)
    }
  }

  async function save() {
    const record = records?.find((r) => `${r.kind}:${r.id}` === target)
    if (!record) {
      toast.error('Pick a deal first')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/economics/from-scratch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [record.kind === 'project' ? 'project_id' : 'opportunity_id']: record.id,
          params: scratchToParams(input).toString(),
          label: label.trim() || undefined,
        }),
      })
      const payload = (await res.json()) as {
        error?: string
        path?: string
        created_model?: boolean
        lines_added?: number
      }
      if (!res.ok) {
        toast.error(payload.error ?? 'Could not save it')
        return
      }
      toast.success(
        payload.created_model
          ? `Model started on ${record.name} with ${payload.lines_added} line(s)`
          : `${payload.lines_added} line(s) added to ${record.name}`
      )
      if (payload.path) router.push(payload.path)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={openPicker}>
        <Save className="size-4" />
        Save onto a deal
      </Button>
    )
  }

  const selected = records?.find((r) => `${r.kind}:${r.id}` === target)

  return (
    <div className="w-full rounded-lg border border-border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="scratch-target" label="Deal">
          <Select
            id="scratch-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={loading}
          >
            <option value="">{loading ? 'Loading…' : 'Pick one'}</option>
            {(records ?? []).map((r) => (
              <option key={`${r.kind}:${r.id}`} value={`${r.kind}:${r.id}`}>
                {r.name}
                {r.kind === 'opportunity' ? ' (opportunity)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="scratch-label" label="Name the line" hint="so the model reads as a decision">
          <Input
            id="scratch-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="From the quick calc"
          />
        </Field>
      </div>
      {withheld > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {withheld} protected {withheld === 1 ? 'project is' : 'projects are'} not listed. Open one
          directly to model it.
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {selected
          ? `This adds to whatever ${selected.name} already has. Nothing is replaced.`
          : 'The calculation is added as a line. An existing model is never replaced.'}
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={save} disabled={saving || !target}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Add it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
