import { Mail, ClipboardPaste, FileText, Bot, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UpdateSource } from '@/lib/supabase/types'

const SOURCE_CONFIG: Record<
  string,
  { label: string; icon: typeof Mail; style: string }
> = {
  email: {
    label: 'Email',
    icon: Mail,
    style: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 ring-blue-200 dark:ring-blue-800/60',
  },
  manual_paste: {
    label: 'Paste',
    icon: ClipboardPaste,
    style: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800/60',
  },
  document: {
    label: 'Document',
    icon: FileText,
    style: 'bg-slate-50 dark:bg-slate-950/40 text-slate-600 dark:text-slate-400 ring-slate-200 dark:ring-slate-800/60',
  },
  agent: {
    label: 'Agent',
    icon: Bot,
    style: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800/60',
  },
  manual_task: {
    label: 'Task',
    icon: ListChecks,
    style: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800/60',
  },
}

interface SourceTagProps {
  source: UpdateSource
  className?: string
}

export default function SourceTag({ source, className }: SourceTagProps) {
  const config = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.document
  const Icon = config.icon

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        config.style,
        className
      )}
    >
      <Icon size={11} />
      {config.label}
    </span>
  )
}
