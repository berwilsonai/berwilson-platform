import type { Metadata } from 'next'
import SetPasswordForm from './SetPasswordForm'

export const metadata: Metadata = {
  title: 'Set Password — Ber Wilson Intelligence',
}

export default function SetPasswordPage() {
  return <SetPasswordForm />
}
