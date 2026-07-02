import { Target, ThumbsUp, ThumbsDown, HelpCircle, AlertTriangle } from 'lucide-react'
import type { FitAssessment } from '@/lib/ai/fit-assessment'

/**
 * Ber AI fit-assessment card — the pursue/consider/pass read scored against the
 * company pursuit profile. Shared by the proposal intake wizard and the email
 * ingestion review screen so both render the assessment identically.
 */

const REC_STYLE: Record<FitAssessment['recommendation'], {
  label: string
  ring: string
  bg: string
  text: string
  bar: string
  Icon: typeof ThumbsUp
}> = {
  pursue: { label: 'Pursue', ring: 'border-green-300 dark:border-green-700/60', bg: 'bg-green-50/60 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-300', bar: 'bg-green-500', Icon: ThumbsUp },
  consider: { label: 'Consider', ring: 'border-amber-300 dark:border-amber-700/60', bg: 'bg-amber-50/60 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300', bar: 'bg-amber-500', Icon: HelpCircle },
  pass: { label: 'Pass', ring: 'border-red-300 dark:border-red-700/60', bg: 'bg-red-50/60 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-300', bar: 'bg-red-500', Icon: ThumbsDown },
}

function FitList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items?.length) return null
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className={`text-xs leading-relaxed flex gap-1.5 ${tone}`}>
            <span className="select-none">•</span>
            <span className="text-foreground">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function FitAssessmentCard({ fit }: { fit: FitAssessment }) {
  const s = REC_STYLE[fit.recommendation] ?? REC_STYLE.consider
  return (
    <div className={`rounded-lg border ${s.ring} ${s.bg} p-4 space-y-4`}>
      {/* Header: recommendation + score */}
      <div className="flex items-start gap-3">
        <Target size={18} className={`${s.text} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Ber AI Fit Assessment</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${s.text} bg-background ring-1 ring-inset ${s.ring}`}>
              <s.Icon size={11} /> {s.label}
            </span>
          </div>
          {fit.summary && <p className="text-sm text-foreground mt-1.5 leading-relaxed">{fit.summary}</p>}
        </div>
        <div className="text-right shrink-0">
          <div className={`text-2xl font-bold tabular-nums ${s.text}`}>{fit.fit_score}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">fit / 100</div>
        </div>
      </div>

      {/* Score bar */}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${s.bar} rounded-full transition-all`} style={{ width: `${fit.fit_score}%` }} />
      </div>

      {fit.profile_incomplete && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-900/40 rounded px-2.5 py-1.5 flex items-center gap-1.5">
          <AlertTriangle size={12} className="shrink-0" />
          This assessment is low-confidence — flesh out the pursuit profile on the <a href="/company" className="underline font-medium">Company page</a> for sharper judgments.
        </p>
      )}

      {/* Detail columns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <FitList title="Why it fits" items={fit.strengths} tone="text-green-700 dark:text-green-300" />
        <FitList title="Concerns" items={fit.concerns} tone="text-amber-700 dark:text-amber-300" />
        <FitList title="Gaps to close" items={fit.gaps} tone="text-red-700 dark:text-red-300" />
        <FitList title="Key questions" items={fit.key_questions} tone="text-blue-700 dark:text-blue-300" />
      </div>
    </div>
  )
}
