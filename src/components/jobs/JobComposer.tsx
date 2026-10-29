'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'

/**
 * Give the working assistant a task.
 *
 * The examples are deliberately the SHAPES rather than pretty sentences: a
 * backlog to work, an audit that proposes fixes, a question over the corpus,
 * and a bulk change. A reader who sees only one shape assumes the others are
 * not possible.
 *
 * ⚠ THE FILING ONE LEADS (10-29), because it is the shape nobody could have
 * guessed was available: until the job could list UNFILED mail it had no way to work the backlog, and 1,823 of 2,080 deal threads are on no record.
 * Richard asked for exactly this in his own words — *"scrub through data to
 * clean it up"* — so the example is written the way he said it rather than in
 * the vocabulary of the verbs underneath.
 */
const EXAMPLES = [
  'Find the correspondence about Whiskey (TX) that is not filed onto the project yet. Read each thread before you decide — a newsletter that mentions the town is not about the deal. Propose filing the ones that really are about it, and propose adding the counterparty contacts on those threads as players on the project.',
  'Go through every contact with no company and work out where they are from — their email domain, the threads they appear in, any document that names them. Propose filling the blank ones you are confident about and list the ones you are not.',
  'Which of our projects have a milestone that is past due and not marked complete? Name the project, the milestone and how many days over.',
  'Read the unfiled deal mail from the last sixty days and tell me whether any of it is work we have no record for. Propose opening a project or an opportunity only where something was actually signed, bid or negotiated.',
]

export default function JobComposer() {
  const router = useRouter()
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = instruction.trim()
    if (!text) {
      setError('Say what the job is.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: text }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not queue the job.')
      router.push(`/jobs/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue the job.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
      <Field
        id="instruction"
        label="What needs doing"
        hint="It reads the platform's own records. It cannot change anything without showing you first."
      >
        <Textarea
          id="instruction"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={5}
          className="min-h-32"
          placeholder="Go through…"
          disabled={busy}
          autoFocus
        />
      </Field>

      <div className="space-y-1.5">
        <p className="label-caps text-muted-foreground">Or start from one of these</p>
        {/*
          ⚠ THEY WERE ALWAYS CLICKABLE AND NEVER LOOKED IT. `text-xs
          text-muted-foreground` with no border and no resting affordance
          reads as fine print, which is what the UI audit called them — and
          these three are the page's entire onboarding: they are the three
          SHAPES a job can take (a question, an audit that proposes fixes, a
          bulk change). A control whose only affordance appears on hover does
          not exist on a phone (§12), and that is the case here even though
          the handler was wired the whole time.
        */}
        <div className="grid gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setInstruction(ex)}
              disabled={busy}
              /* ⚠ `bg-muted/40`, NOT `bg-card`. The composer is itself a
                 `<Panel>` on `bg-card`, so a card-coloured child is invisible
                 against it — only its border would have shown. A recessed
                 surface is both the honest treatment for a thing you pick
                 FROM and the reason `conventions.test.ts` is right to count
                 the card shell: the 227th copy was about to be one that
                 could not be seen. */
              className="block w-full rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-left text-xs leading-relaxed text-foreground outline-none transition-colors hover:border-primary/40 hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-critical">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          {busy ? 'Queueing…' : 'Start the job'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Runs on this machine. A long job keeps going if you close the tab.
        </p>
      </div>
    </form>
  )
}
