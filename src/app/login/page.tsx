import type { Metadata } from 'next'
import LoginForm from './LoginForm'

export const metadata: Metadata = {
  title: 'Sign In — Ber Wilson Intelligence',
  description: 'Sign in to the Ber Wilson Executive Intelligence Platform.',
}

export default function LoginPage() {
  return <LoginForm />
}
