import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasStepUp, isConfidentialProject, STEP_UP_TTL_MS } from '@/lib/security/confidential'
import { hasVerifiedTotp } from '@/lib/security/mfa'
import { mayStepUp } from '@/lib/security/request'
import StepUpPrompt from '@/components/security/StepUpPrompt'

export const metadata = { title: 'Protected project — Ber Wilson Intelligence' }

/**
 * The unlock prompt. Reached only by the middleware REWRITE of a confidential
 * project's path, so the reader's address bar still reads /projects/<id>.
 *
 * Deliberately a sibling of /projects/[id] rather than a child: that layout
 * prints the project's name, client, stage and ten row counts before it renders
 * anything, which is most of what the lock is for.
 *
 * Every precondition is re-checked here rather than trusted from the rewrite.
 * A page that can be reached directly must not assume it was reached the
 * intended way.
 */
export default async function LockedProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams
  const viewer = await getViewer()

  if (!id || !mayStepUp(viewer)) redirect('/projects')
  // Not protected, or already open — nothing to prompt for. Send the reader to
  // the project itself; middleware will serve it.
  if (!(await isConfidentialProject(id))) redirect(`/projects/${id}`)
  if (await hasStepUp(viewer!.authUserId, id)) redirect(`/projects/${id}`)

  // Only now, with the viewer confirmed eligible, is the name safe to print.
  const { data: project } = await createAdminClient()
    .from('projects')
    .select('name')
    .eq('id', id)
    .maybeSingle()

  return (
    <StepUpPrompt
      projectName={project?.name ?? null}
      hasAuthenticator={await hasVerifiedTotp()}
      minutes={Math.round(STEP_UP_TTL_MS / 60000)}
    />
  )
}
