'use client'

import { useState } from 'react'
import { useScenarioStore } from '@/stores/equity-scenario-store'
import { Button } from '@/components/ui/button'
import { Download, Share2, Loader2, Check, Copy } from 'lucide-react'

export default function ExportShareBar() {
  const { activeScenarioId, activeScenarioName } = useScenarioStore()
  const [exporting, setExporting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!activeScenarioId) return null

  async function handleExportPDF() {
    setExporting(true)
    try {
      const res = await fetch('/api/equity/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: activeScenarioId }),
      })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ber-wilson-equity-${(activeScenarioName ?? 'scenario').toLowerCase().replace(/\s+/g, '-')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  async function handleShare() {
    setSharing(true)
    try {
      const res = await fetch('/api/equity/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: activeScenarioId,
          expiresInDays: 7,
          maxAccesses: 10,
        }),
      })
      if (!res.ok) throw new Error('Share link creation failed')
      const data = await res.json()
      setShareUrl(data.url)
    } catch (err) {
      console.error('Share failed:', err)
    } finally {
      setSharing(false)
    }
  }

  async function handleCopy() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={handleExportPDF}
        disabled={exporting}
        className="h-7 text-xs"
      >
        {exporting ? <Loader2 size={12} className="animate-spin mr-1" /> : <Download size={12} className="mr-1" />}
        Export PDF
      </Button>

      {!shareUrl ? (
        <Button
          variant="outline"
          size="sm"
          onClick={handleShare}
          disabled={sharing}
          className="h-7 text-xs"
        >
          {sharing ? <Loader2 size={12} className="animate-spin mr-1" /> : <Share2 size={12} className="mr-1" />}
          Share Link
        </Button>
      ) : (
        <div className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1">
          <span className="text-[10px] text-muted-foreground truncate max-w-48">
            {shareUrl}
          </span>
          <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground">
            {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
          </button>
        </div>
      )}
    </div>
  )
}
