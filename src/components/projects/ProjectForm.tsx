'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createProject, updateProject } from '@/app/projects/actions'
import type { ProjectFormState } from '@/app/projects/actions'
import type { Project, ProjectSector, ProjectStatus, ProjectStage } from '@/lib/supabase/types'
import { SECTOR_LABELS } from '@/lib/utils/sectors'
import { STAGE_LABELS, STAGES } from '@/lib/utils/stages'

const SECTORS: ProjectSector[] = ['government', 'infrastructure', 'real_estate', 'prefab', 'institutional']
const STATUSES: ProjectStatus[] = ['active', 'on_hold', 'won', 'lost', 'closed']
const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  won: 'Won',
  lost: 'Lost',
  closed: 'Closed',
}
const CONTRACT_TYPES = ['FFP', 'CPFF', 'T&M', 'GMP', 'Lump Sum', 'Cost Plus']
const DELIVERY_METHODS = ['Design-Build', 'Design-Bid-Build', 'CMAR']

const inputClass = cn(
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50'
)
const textareaClass = cn(
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground',
  'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50',
  'min-h-[80px] resize-y'
)
const labelClass = 'block text-xs font-medium text-foreground mb-1'

type ParentOption = Pick<Project, 'id' | 'name'>

interface ProjectFormProps {
  mode: 'create' | 'edit'
  project?: Project
  redirectAfterCreate?: string
  availableParents?: ParentOption[]
  defaultParentId?: string
}

export default function ProjectForm({ mode, project, redirectAfterCreate, availableParents = [], defaultParentId }: ProjectFormProps) {
  const action =
    mode === 'edit' && project
      ? updateProject.bind(null, project.id)
      : createProject

  const [state, formAction, isPending] = useActionState<ProjectFormState, FormData>(action, null)

  const [sector, setSector] = useState<ProjectSector | ''>(
    (project?.sector as ProjectSector) ?? ''
  )

  const cancelHref = mode === 'edit' && project ? `/projects/${project.id}` : '/projects'

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {redirectAfterCreate && (
        <input type="hidden" name="redirect_after_create" value={redirectAfterCreate} />
      )}
      {/* Error banner */}
      {state?.error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {state.error}
        </div>
      )}

      {/* Core info */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Core Info
        </h2>

        {/* Name */}
        <div>
          <label htmlFor="name" className={labelClass}>
            Project Name <span className="text-destructive">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            defaultValue={project?.name ?? ''}
            placeholder="e.g. Metro Substation Upgrade"
            className={inputClass}
          />
        </div>

        {/* Parent Program — always visible */}
        <div>
          <label htmlFor="parent_project_id" className={labelClass}>
            Parent Program <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <select
            id="parent_project_id"
            name="parent_project_id"
            defaultValue={project?.parent_project_id ?? defaultParentId ?? ''}
            className={inputClass}
            disabled={availableParents.length === 0 && !project?.parent_project_id && !defaultParentId}
          >
            <option value="">
              {availableParents.length === 0 ? 'No programs exist yet' : 'None (standalone project)'}
            </option>
            {availableParents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {availableParents.length === 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Save this project first, then future projects can be linked to it as sub-projects.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Sector */}
          <div>
            <label htmlFor="sector" className={labelClass}>
              Sector <span className="text-destructive">*</span>
            </label>
            <select
              id="sector"
              name="sector"
              required
              value={sector}
              onChange={(e) => setSector(e.target.value as ProjectSector | '')}
              className={inputClass}
            >
              <option value="">Select sector</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {SECTOR_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="status" className={labelClass}>
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={project?.status ?? ''}
              className={inputClass}
            >
              <option value="">—</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          {/* Stage */}
          <div>
            <label htmlFor="stage" className={labelClass}>
              Stage
            </label>
            <select
              id="stage"
              name="stage"
              defaultValue={project?.stage ?? ''}
              className={inputClass}
            >
              <option value="">—</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s as ProjectStage]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className={labelClass}>
            Description
          </label>
          <textarea
            id="description"
            name="description"
            defaultValue={project?.description ?? ''}
            placeholder="Brief project overview"
            className={textareaClass}
          />
        </div>
      </section>

      {/* Contract & Delivery */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contract & Delivery
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Estimated Value */}
          <div>
            <label htmlFor="estimated_value" className={labelClass}>
              Estimated Value ($)
            </label>
            <input
              id="estimated_value"
              name="estimated_value"
              type="number"
              step="any"
              min="0.01"
              defaultValue={project?.estimated_value ?? ''}
              placeholder="0"
              className={inputClass}
            />
          </div>

          {/* Contract Type */}
          <div>
            <label htmlFor="contract_type" className={labelClass}>
              Contract Type
            </label>
            <select
              id="contract_type"
              name="contract_type"
              defaultValue={project?.contract_type ?? ''}
              className={inputClass}
            >
              <option value="">—</option>
              {CONTRACT_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {ct}
                </option>
              ))}
            </select>
          </div>

          {/* Delivery Method */}
          <div>
            <label htmlFor="delivery_method" className={labelClass}>
              Delivery Method
            </label>
            <select
              id="delivery_method"
              name="delivery_method"
              defaultValue={project?.delivery_method ?? ''}
              className={inputClass}
            >
              <option value="">—</option>
              {DELIVERY_METHODS.map((dm) => (
                <option key={dm} value={dm}>
                  {dm}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Client & Location */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Client & Location
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="client_entity" className={labelClass}>
              Client Entity
            </label>
            <input
              id="client_entity"
              name="client_entity"
              type="text"
              defaultValue={project?.client_entity ?? ''}
              placeholder="e.g. City of Oakland"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="location" className={labelClass}>
              Location
            </label>
            <input
              id="location"
              name="location"
              type="text"
              defaultValue={project?.location ?? ''}
              placeholder="e.g. Oakland, CA"
              className={inputClass}
            />
          </div>
        </div>

        {/* Government-only: solicitation number */}
        {sector === 'government' && (
          <div>
            <label htmlFor="solicitation_number" className={labelClass}>
              Solicitation Number
            </label>
            <input
              id="solicitation_number"
              name="solicitation_number"
              type="text"
              defaultValue={project?.solicitation_number ?? ''}
              placeholder="e.g. W912DR-24-R-0001"
              className={inputClass}
            />
          </div>
        )}
      </section>

      {/* Key Dates */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Key Dates
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="award_date" className={labelClass}>
              Award Date
            </label>
            <input
              id="award_date"
              name="award_date"
              type="date"
              defaultValue={project?.award_date ?? ''}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="ntp_date" className={labelClass}>
              NTP Date
            </label>
            <input
              id="ntp_date"
              name="ntp_date"
              type="date"
              defaultValue={project?.ntp_date ?? ''}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="substantial_completion_date" className={labelClass}>
              Substantial Completion
            </label>
            <input
              id="substantial_completion_date"
              name="substantial_completion_date"
              type="date"
              defaultValue={project?.substantial_completion_date ?? ''}
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isPending}>
          {isPending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Create Project'
              : 'Save Changes'}
        </Button>
        <Link
          href={cancelHref}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
