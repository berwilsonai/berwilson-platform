import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Portfolio — Ber Wilson Intelligence',
}

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
