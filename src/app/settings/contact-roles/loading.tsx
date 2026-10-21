import { Panel } from '@/components/ui/card'

export default function ContactRolesLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-4 w-96 rounded bg-muted" />
      </div>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-32 rounded bg-muted" />
          <Panel className="h-28" />
        </div>
      ))}
    </div>
  )
}
