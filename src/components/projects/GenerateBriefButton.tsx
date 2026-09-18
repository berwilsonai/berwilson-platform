'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { BriefMarkdown } from '@/components/briefs/BriefMarkdown'
import ReadAloudButton from '@/components/shared/ReadAloudButton'
import { FileText, Loader2, X, Copy, Check, Save, Printer } from 'lucide-react'

interface Props {
  recordId: string
  recordName: string
  /** Which kind of record the brief covers; decides the API field and print URL. */
  kind?: 'project' | 'opportunity'
}

export default function GenerateBriefButton({ recordId, recordName, kind = 'project' }: Props) {
  const [loading, setLoading] = useState(false)
  const [brief, setBrief] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [modelInfo, setModelInfo] = useState<{ model: string; latency: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setBrief(null)
    setSaved(false)

    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'project' ? { project_id: recordId } : { opportunity_id: recordId }
        ),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
      }
      const data = await res.json() as { brief: string; model_used: string; latency_ms: number }
      setBrief(data.brief)
      setModelInfo({ model: data.model_used, latency: data.latency_ms })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!brief) return
    await navigator.clipboard.writeText(brief)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleSave() {
    if (!brief) return
    setSaving(true)
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: recordId,
          file_name: `${recordName} Brief - ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}.md`,
          doc_type: 'report',
          ai_summary: brief.slice(0, 500),
          source: 'agent',
          content: brief,
        }),
      })
      if (res.ok) setSaved(true)
    } catch {
      // silent fail for save
    } finally {
      setSaving(false)
    }
  }

  function close() {
    setBrief(null)
    setError(null)
    setModelInfo(null)
    setSaved(false)
  }

  return (
    <>
      <button
        onClick={generate}
        disabled={loading}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
      >
        {loading ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <FileText size={12} />
        )}
        {loading ? 'Generating…' : 'Generate Brief'}
      </button>

      {/* Modal */}
      {(brief || error) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            ref={modalRef}
            className="bg-card border border-border rounded-xl elev-3 w-full max-w-2xl max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Executive Brief — {recordName}
                </h3>
                {modelInfo && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {modelInfo.model} · {modelInfo.latency < 1000 ? `${modelInfo.latency}ms` : `${(modelInfo.latency / 1000).toFixed(1)}s`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {brief && (
                  <>
                    <ReadAloudButton
                      text={brief}
                      iconSize={11}
                      className="h-7 px-2.5 rounded-md text-xs font-medium border border-input hover:bg-accent"
                    />
                    <Link
                      href={`/${kind === 'project' ? 'projects' : 'opportunities'}/${recordId}/brief/print`}
                      target="_blank"
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-input hover:bg-accent transition-colors"
                    >
                      <Printer size={11} /> Print
                    </Link>
                    <button
                      onClick={handleCopy}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-input hover:bg-accent transition-colors"
                    >
                      {copied ? <Check size={11} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={11} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    {kind === 'project' && (
                    <button
                      onClick={handleSave}
                      disabled={saving || saved}
                      className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border border-input hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      {saved ? <Check size={11} className="text-emerald-600 dark:text-emerald-400" /> : <Save size={11} />}
                      {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
                    </button>
                    )}
                  </>
                )}
                <button
                  onClick={close}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}
              {brief && (
                <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-p:leading-relaxed">
                  <BriefMarkdown text={brief} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
