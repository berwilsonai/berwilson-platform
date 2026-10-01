import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import { mayStepUp } from '@/lib/security/request'
import { listTotpFactors } from '@/lib/security/mfa'
import SecurityManager from '@/components/security/SecurityManager'

export const metadata = { title: 'Security — Ber Wilson Intelligence' }

export default async function SecuritySettingsPage() {
  const viewer = await getViewer()
  // Only an admin can hold a step-up, so only an admin has anything to enrol an
  // authenticator for. Calls mayStepUp() rather than restating it, so the two
  // can never drift apart.
  if (!mayStepUp(viewer)) redirect('/tasks')
  // Read on the server so the screen arrives populated — no load-on-mount
  // effect, and no flash of "no authenticator yet" for someone who has one.
  return <SecurityManager factors={await listTotpFactors()} />
}
