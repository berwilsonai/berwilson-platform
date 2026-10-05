/**
 * How this deal's numbers changed, and why.
 *
 * A version is a deliberate act with a name. The column-by-column audit trail
 * already records every edit and who made it; this records the moments someone
 * wanted to be able to come back to, which a diff cannot say.
 *
 * Server component, reading its own rows. Renders nothing when there are none:
 * an empty "Version history" panel on every deal is a permanent invitation to
 * a dead end.
 */

import { formatDate } from '@/lib/utils/constants'
import { calcDb, type VersionRow } from '@/lib/economics/db'

export default async function VersionHistory({ economicsId }: { economicsId: string }) {
  const { data, error } = await calcDb()
    .from('economics_versions')
    .select('id,version,label,note,created_by,created_at')
    .eq('economics_id', economicsId)
    .order('version', { ascending: false })
    .limit(20)

  if (error) {
    // Said out loud rather than rendered as "no versions", which would read as
    // a history that does not exist rather than one that could not be read.
    return (
      <p className="text-[11px] text-muted-foreground">
        Version history could not be read: {error.message}
      </p>
    )
  }

  const versions = (data ?? []) as Pick<
    VersionRow,
    'id' | 'version' | 'label' | 'note' | 'created_by' | 'created_at'
  >[]
  if (versions.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-card elev-1 p-4 sm:p-5">
      <h2 className="label-caps text-muted-foreground">Version history</h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="tnum text-muted-foreground">v{v.version}</span>
            <span>{v.label ?? 'Unnamed'}</span>
            <span className="text-[11px] text-muted-foreground">
              {formatDate(v.created_at)}
              {v.created_by ? ` · ${v.created_by}` : ''}
            </span>
            {v.note ? (
              <span className="basis-full text-[11px] text-muted-foreground">{v.note}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
