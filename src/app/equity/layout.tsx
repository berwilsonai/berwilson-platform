import QueryProvider from '@/components/equity/QueryProvider'

export const metadata = {
  title: 'Equity & Valuation — Ber Wilson Intelligence',
}

export default function EquityLayout({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>
}
