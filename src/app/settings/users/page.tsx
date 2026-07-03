import { redirect } from 'next/navigation'
import { getViewer } from '@/lib/auth/viewer'
import UserAccessManager from '@/components/settings/UserAccessManager'

export const metadata = { title: 'Users & Access — Ber Wilson Intelligence' }

export default async function UsersSettingsPage() {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  return <UserAccessManager />
}
