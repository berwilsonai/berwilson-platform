import { Mail, ClipboardPaste, FileText, Bot, HardHat } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UpdateSource } from '@/lib/supabase/types'

const SOURCE_CONFIG: Record<
  string,
  { label: string; icon: typeof Mail; style: string }
> = {
  email: {
    label: 'Email',
    icon: Mail,
    style: 'bg-blue-50 text-blue-700 ring-blue-200',
  },
  manual_paste: {
    label: 'Paste',
    icon: ClipboardPaste,
    style: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  document: {
    label: 'Document',
    icon: FileText,
    style: 'bg-slate-50 text-slate-600 ring-slate-200',
  },
  agent: {
    label: 'Agent',
    icon: Bot,
    style: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  procore: {
    label: 'Procore',
    icon: HardHat,
    style: 'bg-orange-50 text-orange-700 ring-orange-200',
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
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        config.style,
        className
      )}
    >
      <Icon size={11} />
      {config.label}
    </span>
  )
}
