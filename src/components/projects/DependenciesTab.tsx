'use client'

import { useState, useEffect, useCallback } from 'react'
import { GitBranch, Plus, ArrowRight, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Dependency {
  id: string
  upstream_project_id: string
  downstream_project_id: string
  dependency_type: string
  description: string | null
  severity: string
  status: string
  created_at: string
  upstream: { id: string; name: string } | null
  downstream: { id: string; name: string } | null
}

interface Project {
  id: string
  name: string
}

interface DependenciesTabProps {
  projectId: string
  projectName: string
  allProjects: Project[]
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-slate-600 bg-slate-50 ring-slate-200',
  watch: 'text-yellow-600 bg-yellow-50 ring-yellow-200',
  critical: 'text-red-600 bg-red-50 ring-red-200',
  blocker: 'text-red-700 bg-red-100 ring-red-300',
}

export default function DependenciesTab({ projectId, projectName, allProjects }: DependenciesTabProps) {
  const [deps, setDeps] = useState<Dependency[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newDep, setNewDep] = useState({
    direction: 'downstream' as 'upstream' | 'downstream',
    otherProjectId: '',
    description: '',
    severity: 'watch',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/dependencies?project_id=${projectId}`)
      if (res.ok) {
        const data = await res.json() as { dependencies: Dependency[] }
        setDeps(data.dependencies)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const addDependency = async () => {
    const upstream = newDep.direction === 'upstream' ? newDep.otherProjectId : projectId
    const downstream = newDep.direction === 'downstream' ? newDep.otherProjectId : projectId

    const res = await fetch('/api/dependencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream_project_id: upstream,
        downstream_project_id: downstream,
        description: newDep.description || null,
        severity: newDep.severity,
      }),
    })

    if (res.ok) {
      setShowAdd(false)
      setNewDep({ direction: 'downstream', otherProjectId: '', description: '', severity: 'watch' })
      load()
    }
  }

  const resolve = async (id: string) => {
    await fetch(`/api/dependencies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
    load()
  }

  const remove = async (id: string) => {
    await fetch(`/api/dependencies/${id}`, { method: 'DELETE' })
    load()
  }

  const otherProjects = allProjects.filter(p => p.id !== projectId)
  const activeDeps = deps.filter(d => d.status === 'active')
  const resolvedDeps = deps.filter(d => d.status === 'resolved')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-pink-600" />
          <h3 className="text-sm font-semibold text-foreground">Cross-Project Dependencies</h3>
          {activeDeps.length > 0 && (
            <span className="text-xs font-medium bg-pink-50 text-pink-600 px-1.5 py-0.5 rounded ring-1 ring-pink-200">
              {activeDeps.length} active
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg border border-border p-3 space-y-3 bg-muted/20">
          <div className="flex gap-2">
            <select
              value={newDep.direction}
              onChange={e => setNewDep(d => ({ ...d, direction: e.target.value as 'upstream' | 'downstream' }))}
              className="text-xs rounded border border-border bg-card px-2 py-1.5"
            >
              <option value="downstream">{projectName} blocks...</option>
              <option value="upstream">{projectName} is blocked by...</option>
            </select>
            <select
              value={newDep.otherProjectId}
              onChange={e => setNewDep(d => ({ ...d, otherProjectId: e.target.value }))}
              className="text-xs rounded border border-border bg-card px-2 py-1.5 flex-1"
            >
              <option value="">Select project...</option>
              {otherProjects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            placeholder="Description (e.g. 'Xcel PSA must close before mobilization')"
            value={newDep.description}
            onChange={e => setNewDep(d => ({ ...d, description: e.target.value }))}
            className="w-full text-xs rounded border border-border bg-card px-2 py-1.5"
          />
          <div className="flex items-center gap-2">
            <select
              value={newDep.severity}
              onChange={e => setNewDep(d => ({ ...d, severity: e.target.value }))}
              className="text-xs rounded border border-border bg-card px-2 py-1.5"
            >
              <option value="info">Info</option>
              <option value="watch">Watch</option>
              <option value="critical">Critical</option>
              <option value="blocker">Blocker</option>
            </select>
            <button
              onClick={addDependency}
              disabled={!newDep.otherProjectId}
              className="px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Add Dependency
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && deps.length === 0 && (
        <div className="animate-pulse space-y-2">
          <div className="h-10 bg-muted rounded" />
          <div className="h-10 bg-muted rounded" />
        </div>
      )}

      {/* Empty state */}
      {!loading && deps.length === 0 && (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No cross-project dependencies tracked yet
        </p>
      )}

      {/* Active dependencies */}
      {activeDeps.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {activeDeps.map(dep => {
            const isUpstream = dep.upstream_project_id === projectId
            const otherName = isUpstream
              ? dep.downstream?.name ?? 'Unknown'
              : dep.upstream?.name ?? 'Unknown'

            return (
              <div key={dep.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30">
                <span className={cn(
                  'shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ring-1 ring-inset',
                  SEVERITY_COLORS[dep.severity] ?? SEVERITY_COLORS.watch
                )}>
                  {dep.severity}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <span>{isUpstream ? projectName : otherName}</span>
                    <ArrowRight size={10} className="text-muted-foreground shrink-0" />
                    <span>{isUpstream ? otherName : projectName}</span>
                  </div>
                  {dep.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{dep.description}</p>
                  )}
                </div>

                <button
                  onClick={() => resolve(dep.id)}
                  title="Mark resolved"
                  className="p-1 text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                >
                  <Check size={13} />
                </button>
                <button
                  onClick={() => remove(dep.id)}
                  title="Remove"
                  className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Resolved dependencies */}
      {resolvedDeps.length > 0 && (
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
            {resolvedDeps.length} resolved
          </summary>
          <div className="mt-2 rounded-lg border border-border divide-y divide-border overflow-hidden opacity-60">
            {resolvedDeps.map(dep => (
              <div key={dep.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-xs text-muted-foreground">Resolved</span>
                <div className="flex-1 text-xs text-muted-foreground line-through">
                  {dep.upstream?.name ?? 'Unknown'} → {dep.downstream?.name ?? 'Unknown'}
                  {dep.description && `: ${dep.description}`}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
