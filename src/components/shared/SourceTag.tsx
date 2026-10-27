import { Mail, ClipboardPaste, FileText, Bot, ListChecks, MessageSquare, Phone, NotebookPen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UpdateSource } from '@/lib/supabase/types'

const SOURCE_CONFIG: Record<
  string,
  { label: string; icon: typeof Mail; style: string }
> = {
  email: {
    label: 'Email',
    icon: Mail,
    style: 'bg-info-surface text-info ring-info-edge',
  },
  manual_paste: {
    label: 'Paste',
    icon: ClipboardPaste,
    style: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 ring-violet-200 dark:ring-violet-800/60',
  },
  document: {
    label: 'Document',
    icon: FileText,
    style: 'bg-muted dark:bg-muted/40 text-muted-foreground ring-border dark:ring-border/60',
  },
  agent: {
    label: 'Agent',
    icon: Bot,
    style: 'bg-caution-surface text-caution ring-caution-edge',
  },
  manual_task: {
    label: 'Task',
    icon: ListChecks,
    style: 'bg-positive-surface text-positive ring-positive-edge',
  },
  // ⚠ THE THREE LOCAL SOURCES, WHICH FELL THROUGH TO "Document". The fallback
  // below is `SOURCE_CONFIG.document`, so a text message on a project read as a
  // document — the same class of mislabelling the `update_source` migrations
  // fixed in the database, surviving in the component that renders it. An enum
  // member with no entry here is invisible rather than wrong-looking, which is
  // why it lasted (§12: never print a stored enum at a reader).
  imessage: {
    label: 'Text',
    icon: MessageSquare,
    style: 'bg-positive-surface text-positive ring-positive-edge',
  },
  call: {
    label: 'Call',
    icon: Phone,
    style: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 ring-teal-200 dark:ring-teal-800/60',
  },
  note: {
    label: 'Note',
    icon: NotebookPen,
    style: 'bg-caution-surface text-caution ring-caution-edge',
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
