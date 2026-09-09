'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronRight,
  ExternalLink,
  Folder,
  FolderOpen,
  Link2,
  Link2Off,
  Loader2,
  Archive,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatDate } from '@/lib/utils/constants'

/**
 * Point a project at the team's own Drive folder.
 *
 * Linking is done by hand — one folder, once — because the real folder names are
 * ambiguous: "Myton - Utah" has two candidate projects here, so does "Stockton,
 * Utah", and West Wendover appears in two separate trees. A confident misfile is
 * worse than an unlinked folder, which at least announces itself.
 *
 * The picker drills one level at a time rather than rendering a whole tree: the
 * shared drive is several hundred folders deep in places, and the person linking
 * already knows the path they are walking.
 */

interface Crumb {
  id: string
  name: string
  driveId: string | null
}

interface Row {
  id: string
  name: string
  archive?: boolean
  files?: number | null
  newest?: string | null
}

interface Root {
  id: string
  name: string
  kind: 'shared' | 'my-drive'
  driveId: string | null
}

export default function DriveFolderLink({
  projectId,
  folderId,
  folderUrl,
}: {
  projectId: string
  folderId: string | null
  folderUrl: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [roots, setRoots] = useState<Root[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [pasted, setPasted] = useState('')

  const load = useCallback(async (trail: Crumb[]) => {
    setLoading(true)
    try {
      const here = trail[trail.length - 1]
      const params = new URLSearchParams()
      if (here) {
        params.set('parent', here.id)
        if (here.driveId) params.set('driveId', here.driveId)
      }
      const res = await fetch(`/api/drive/browse?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not read Drive')
      setRoots(data.roots ?? [])
      setRows(data.folders ?? [])
      setCrumbs(trail)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read Drive')
    } finally {
      setLoading(false)
    }
  }, [])

  function openPicker() {
    setOpen(true)
    // Fetched on open rather than in an effect: the dialog is rarely used and
    // an effect here would be one more setState-in-effect to explain.
    void load([])
  }

  async function save(id: string | null) {
    setSaving(true)
    try {
      const res = await fetch('/api/drive/source-folder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, folder_id: id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save the link')

      setOpen(false)
      if (id) {
        toast.success('Folder linked. Importing now…')
        // Import immediately rather than waiting for tonight: the whole point of
        // linking is to see the folder's contents arrive.
        const imp = await fetch('/api/drive/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId }),
        })
        const result = await imp.json()
        if (imp.ok) {
          toast.success(
            result.added > 0
              ? `${result.added} document${result.added === 1 ? '' : 's'} imported from Drive`
              : 'Linked — nothing new to import yet'
          )
        } else {
          toast.error(result.error ?? 'Linked, but the first import failed')
        }
      } else {
        toast.success('Folder unlinked. Documents already imported stay on the project.')
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the link')
    } finally {
      setSaving(false)
      setUnlinking(false)
    }
  }

  const here = crumbs[crumbs.length - 1]

  return (
    <>
      {folderId ? (
        <div className="flex items-center gap-1.5">
          <a
            href={folderUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-primary hover:bg-accent"
          >
            <FolderOpen className="size-3.5" />
            Drive folder
            <ExternalLink className="size-3" />
          </a>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={openPicker}>
            Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground"
            onClick={() => setUnlinking(true)}
          >
            <Link2Off className="size-3.5" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={openPicker}>
          <Link2 className="mr-1.5 size-3.5" />
          Link Drive folder
        </Button>
      )}

      <ConfirmDialog
        open={unlinking}
        onOpenChange={setUnlinking}
        title="Unlink this Drive folder?"
        description="New files in it will stop reaching this project. Documents already imported stay exactly where they are."
        confirmLabel="Unlink"
        onConfirm={() => void save(null)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Link a Drive folder</DialogTitle>
            <DialogDescription>
              Everything in this folder is imported nightly and indexed for Ber AI. Files dragged
              into an <span className="font-medium">Archive</span> subfolder are skipped — that is
              how the team retires a document without a platform login.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <button className="hover:text-foreground" onClick={() => void load([])}>
              Drive
            </button>
            {crumbs.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <button
                  className="hover:text-foreground"
                  onClick={() => void load(crumbs.slice(0, i + 1))}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </div>

          <div className="max-h-72 min-h-40 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Reading Drive…
              </div>
            ) : roots.length > 0 ? (
              roots.map((r) => (
                <button
                  key={r.id}
                  className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm last:border-0 hover:bg-accent"
                  onClick={() => void load([{ id: r.id, name: r.name, driveId: r.driveId }])}
                >
                  <Folder className="size-4 shrink-0 text-primary" />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="label-caps text-muted-foreground">
                    {r.kind === 'shared' ? 'Shared drive' : ''}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))
            ) : rows.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
                <span>No subfolders here.</span>
                {here && <span className="text-xs">Link this folder itself with the button below.</span>}
              </div>
            ) : (
              rows.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-accent"
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() =>
                      void load([
                        ...crumbs,
                        { id: f.id, name: f.name, driveId: here?.driveId ?? null },
                      ])
                    }
                  >
                    {f.archive ? (
                      <Archive className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Folder className="size-4 shrink-0 text-primary" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs tnum text-muted-foreground">
                      {f.archive
                        ? 'skipped'
                        : f.files == null
                          ? ''
                          : f.files === 0
                            ? 'empty'
                            : `${f.files} file${f.files === 1 ? '' : 's'}${f.newest ? ` · ${formatDate(f.newest)}` : ''}`}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    disabled={saving || f.archive}
                    onClick={() => void save(f.id)}
                  >
                    Link
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="…or paste a Drive folder link"
              className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={!pasted.trim() || saving}
              onClick={() => void save(pasted.trim())}
            >
              Link
            </Button>
          </div>

          <DialogFooter>
            {here && (
              <Button disabled={saving} onClick={() => void save(here.id)}>
                {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Link “{here.name}”
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
