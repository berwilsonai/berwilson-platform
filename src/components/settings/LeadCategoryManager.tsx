'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Trash2, Save, X, Route as RouteIcon } from 'lucide-react'
import { Panel } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Field, Input, Select, Textarea, FormGrid } from '@/components/ui/field'
import { TONE_BADGE, TONE_NAMES } from '@/lib/utils/leads'

/**
 * The lead routing registry, edited.
 *
 * ONE row per line of business, and this screen is the only place a new one is
 * born. The taxonomy used to be five values baked into a CHECK constraint, a
 * TypeScript union, five label maps and five paragraphs of prompt prose — so
 * adding flooring meant a migration, a constraint swap, a prompt edit and a
 * rebuild, in four files, none of which fails loudly if you miss it.
 *
 * Every field here feeds something real, which is why each one says what:
 * `routing_rule` is read to the AI verbatim, `handoff_email` is who the lead is
 * sent to, `drive_folder_id` is where its files land, `share_with` is who can
 * open them.
 */

export interface CategoryRow {
  id: string
  key: string
  label: string
  destination: string
  routing_rule: string | null
  destination_note: string | null
  handoff_email: string | null
  share_with: string[]
  drive_folder_id: string | null
  publish_sheet: boolean
  chat_webhook_key: string | null
  tone: string
  sort_order: number
  active: boolean
  system: boolean
}

/** How many leads each lane currently owns — server-counted. */
export type LaneCounts = Record<string, number>

const DESTINATIONS: { value: string; label: string; hint: string }[] = [
  {
    value: 'project',
    label: 'Becomes a project',
    hint: 'Work Ber Wilson builds itself. Accepting creates a project and copies the bid package onto it.',
  },
  {
    value: 'steel_deal',
    label: 'Becomes a steel deal',
    hint: 'Priced by the steel plant. Accepting creates a deal in the Steel CRM at the Quote stage.',
  },
  {
    value: 'opportunity',
    label: 'Becomes an opportunity',
    hint: 'Acquisitions, JVs, equity — not built work. Accepting creates an opportunity.',
  },
  {
    value: 'handoff',
    label: 'Handed off by email',
    hint: 'For a team with no login here. Accepting emails them the brief and the files, and nothing is created in the platform.',
  },
  {
    value: 'manual',
    label: 'Placed by a human',
    hint: 'No one-click destination is offered. Use for a lane where the right home genuinely varies.',
  },
]

const BLANK: Omit<CategoryRow, 'id' | 'system'> = {
  key: '',
  label: '',
  destination: 'handoff',
  routing_rule: '',
  destination_note: '',
  handoff_email: '',
  share_with: [],
  drive_folder_id: '',
  publish_sheet: true,
  chat_webhook_key: '',
  tone: 'sky',
  sort_order: 100,
  active: true,
}

export default function LeadCategoryManager({
  initial,
  counts,
}: {
  initial: CategoryRow[]
  counts: LaneCounts
}) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<CategoryRow> | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CategoryRow | null>(null)

  const totals = useMemo(
    () => ({
      lanes: rows.filter((r) => r.active).length,
      handoffs: rows.filter((r) => r.active && r.destination === 'handoff').length,
      // The count worth surfacing: a lane that cannot deliver. This is the
      // DINO_LEAD_EMAIL failure made visible instead of remembered.
      unconfigured: rows.filter(
        (r) => r.active && r.destination === 'handoff' && !r.handoff_email
      ).length,
    }),
    [rows]
  )

  function startEdit(row: CategoryRow) {
    setEditing(row.id)
    setDraft({ ...row })
  }

  function startCreate() {
    setEditing('new')
    setDraft({ ...BLANK })
  }

  function cancel() {
    setEditing(null)
    setDraft(null)
  }

  function set<K extends keyof CategoryRow>(field: K, value: CategoryRow[K]) {
    setDraft((d) => (d ? { ...d, [field]: value } : d))
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    try {
      const creating = editing === 'new'
      const res = await fetch(
        creating ? '/api/settings/lead-categories' : `/api/settings/lead-categories/${editing}`,
        {
          method: creating ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            // The textarea holds one address per line; the API accepts either.
            share_with: Array.isArray(draft.share_with) ? draft.share_with : [],
          }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save.')

      const saved = json.category as CategoryRow
      setRows((prev) =>
        creating
          ? [...prev, saved].sort((a, b) => a.sort_order - b.sort_order)
          : prev.map((r) => (r.id === saved.id ? saved : r))
      )
      toast.success(creating ? `“${saved.label}” added.` : `“${saved.label}” saved.`)
      cancel()
      // The queue's tabs and the triage prompt both read this registry, so the
      // rest of the app needs re-rendering against it.
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: CategoryRow) {
    setBusy(true)
    try {
      const res = await fetch(`/api/settings/lead-categories/${row.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not delete.')
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success(`“${row.label}” deleted.`)
      router.refresh()
    } catch (err) {
      // Long by design: the refusal explains that switching off is the move,
      // and truncating it would leave the reader thinking deletion is broken.
      toast.error(err instanceof Error ? err.message : 'Could not delete.', { duration: 10_000 })
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  const form = (row: CategoryRow | null) => {
    if (!draft) return null
    const isHandoff = draft.destination === 'handoff'
    return (
      <div className="space-y-4 rounded-md border border-primary/30 bg-primary/[0.03] p-4">
        <FormGrid>
          <Field label="Label" hint="What people read — on the queue tabs, in the digest, in the email subject.">
            <Input
              value={draft.label ?? ''}
              onChange={(e) => set('label', e.target.value)}
              placeholder="Dino Plumbing"
            />
          </Field>
          <Field
            label="Key"
            hint={
              row?.system
                ? 'Built in — cannot be renamed.'
                : row
                  ? 'Renaming carries existing leads with it.'
                  : 'Lowercase, no spaces. The AI answers with this, so keep it the TRADE — the label names who does it.'
            }
          >
            <Input
              value={draft.key ?? ''}
              onChange={(e) => set('key', e.target.value)}
              placeholder="plumbing"
              disabled={row?.system}
            />
          </Field>
        </FormGrid>

        <Field
          label="What this becomes"
          hint={DESTINATIONS.find((d) => d.value === draft.destination)?.hint}
        >
          <Select
            value={draft.destination ?? 'handoff'}
            onChange={(e) => set('destination', e.target.value)}
            disabled={row?.system}
          >
            {DESTINATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="How the AI recognises this"
          hint="Read to the model word for word when it reads info@. Say what the WORK is, not where it should go — it cannot see the database. Name the thing that distinguishes this lane from the others, and the case it must NOT catch."
        >
          <Textarea
            rows={4}
            value={draft.routing_rule ?? ''}
            onChange={(e) => set('routing_rule', e.target.value)}
            placeholder="Standalone flooring work: carpet, tile, LVP, hardwood, epoxy, subfloor prep. Standalone means the flooring IS the job — flooring inside a building project is construction."
          />
        </Field>

        {isHandoff && (
          <FormGrid>
            <Field
              label="Send leads to"
              hint="The inbox that receives the brief and the files. Without it, handing off fails on press."
            >
              <Input
                type="email"
                value={draft.handoff_email ?? ''}
                onChange={(e) => set('handoff_email', e.target.value)}
                placeholder="plumbing@dinoservicepros.com"
              />
            </Field>
            <Field
              label="Drive folder"
              hint="Paste the folder's link. Create it yourself in the shared drive first — the platform can add files to a folder a person made, but cannot make one."
            >
              <Input
                value={draft.drive_folder_id ?? ''}
                onChange={(e) => set('drive_folder_id', e.target.value)}
                placeholder="https://drive.google.com/drive/folders/…"
              />
            </Field>
          </FormGrid>
        )}

        <Field
          label="Give these people access"
          hint="One address per line. Granted reader on this lane's Drive folder and its lead sheet — needed for anyone outside berwilson.com, who domain sharing does not reach."
        >
          <Textarea
            rows={2}
            value={(draft.share_with ?? []).join('\n')}
            onChange={(e) =>
              set(
                'share_with',
                e.target.value
                  .split(/[\n,;]+/)
                  .map((a) => a.trim())
                  .filter(Boolean)
              )
            }
            placeholder={'brent@dinoservicepros.com\nscheduling@dinoservicepros.com'}
          />
        </Field>

        <FormGrid>
          <Field label="Colour" hint="How this lane's chip reads in the queue.">
            <Select value={draft.tone ?? 'sky'} onChange={(e) => set('tone', e.target.value)}>
              {TONE_NAMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order" hint="Where the tab sits in the queue.">
            <Input
              type="number"
              value={String(draft.sort_order ?? 100)}
              onChange={(e) => set('sort_order', Number(e.target.value))}
            />
          </Field>
        </FormGrid>

        <Field
          label="One line for the reader"
          hint="Shown under a lead's title, saying where it is headed."
        >
          <Input
            value={draft.destination_note ?? ''}
            onChange={(e) => set('destination_note', e.target.value)}
            placeholder="Flooring — handed to the flooring team"
          />
        </Field>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.publish_sheet ?? false}
              onChange={(e) => set('publish_sheet', e.target.checked)}
              className="mt-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <span>
              Publish a Google Sheet of these leads
              <span className="block text-xs text-muted-foreground">
                A read-only list in Drive, rebuilt every sweep. The right surface for a team with
                no login here — leave it off for lanes worked by people who use this platform, or
                it becomes a second place to look at the same queue.
              </span>
            </span>
          </label>

          {!row?.system && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.active ?? true}
                onChange={(e) => set('active', e.target.checked)}
                className="mt-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <span>
                Accepting new leads
                <span className="block text-xs text-muted-foreground">
                  Switch off to close a lane. The AI stops being told it exists and no new lead
                  lands here, while the leads it already owns stay readable and keep their label.
                </span>
              </span>
            </label>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={busy}>
            <Save className="size-4" />
            {busy ? 'Saving…' : row ? 'Save' : 'Add line of business'}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            <X className="size-4" />
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <RouteIcon className="size-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl">Lead categories</h1>
          <p className="text-sm text-muted-foreground">
            Every line of business a lead can belong to, and where each one sends it. This is the
            only place a new one is defined — the AI that reads info@, the queue&rsquo;s tabs, the
            handoff email and the Drive sheets all read from here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: 'Active lanes', value: String(totals.lanes) },
          { label: 'Handed off by email', value: String(totals.handoffs) },
          {
            label: 'Missing an address',
            value: String(totals.unconfigured),
            warn: totals.unconfigured > 0,
          },
        ].map((s) => (
          <Panel key={s.label} className="p-3">
            <p className="label-caps text-muted-foreground">{s.label}</p>
            <p className={`tnum mt-0.5 text-xl font-semibold ${s.warn ? 'text-amber-600' : ''}`}>
              {s.value}
            </p>
          </Panel>
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((row) =>
          editing === row.id ? (
            <div key={row.id}>{form(row)}</div>
          ) : (
            <Panel key={row.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={TONE_BADGE[row.tone] ?? TONE_BADGE.slate}>{row.label}</Chip>
                <code className="text-xs text-muted-foreground">{row.key}</code>
                {!row.active && (
                  <span className="text-xs text-muted-foreground">· closed to new leads</span>
                )}
                <span className="tnum ml-auto text-xs text-muted-foreground">
                  {counts[row.key] ?? 0} lead{(counts[row.key] ?? 0) === 1 ? '' : 's'}
                </span>
                {/* Gated on `sm:` rather than hover alone — a control that only
                    appears on hover does not exist on a phone (§12). */}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>
                    Edit
                  </Button>
                  {!row.system && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(row)}
                      title="Delete this line of business"
                      className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive outline-none focus-visible:text-destructive"
                    >
                      <Trash2 className="size-4" />
                      <span className="absolute -inset-3" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              <p className="mt-1.5 text-sm">
                {DESTINATIONS.find((d) => d.value === row.destination)?.label ?? row.destination}
                {row.destination === 'handoff' &&
                  (row.handoff_email ? (
                    <span className="text-muted-foreground"> → {row.handoff_email}</span>
                  ) : (
                    <span className="text-amber-600"> — no address set, so handing off fails</span>
                  ))}
              </p>

              {row.routing_rule ? (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {row.routing_rule}
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-600">
                  No routing rule — the AI is told this lane exists but not how to recognise it, so
                  it will rarely choose it.
                </p>
              )}
            </Panel>
          )
        )}
      </div>

      {editing === 'new' ? (
        form(null)
      ) : (
        <Button variant="outline" onClick={startCreate} disabled={busy}>
          <Plus className="size-4" />
          Add a line of business
        </Button>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete “${confirmDelete?.label}”?`}
        description="This removes the line of business entirely. It only works when no lead is filed under it — if any are, switch it off instead, which keeps their history and stops new ones arriving."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDelete) return remove(confirmDelete)
        }}
      />
    </div>
  )
}
