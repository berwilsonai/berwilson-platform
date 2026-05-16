import Link from 'next/link'
import {
  BarChart3,
  PieChart,
  Handshake,
  Calculator,
  TrendingUp,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ScenarioSelector from '@/components/equity/ScenarioSelector'

const MODULES = [
  {
    href: '/equity/exit-scenarios',
    title: 'Exit Scenarios & Reality Check',
    description: 'See what each stakeholder receives at different exit valuations. The most important view for strategic decisions.',
    icon: TrendingUp,
    priority: true,
  },
  {
    href: '/equity/cap-table',
    title: 'Cap Table Simulator',
    description: 'Visualize ownership stages from founding through key hires. Eric stays at 51% minimum.',
    icon: PieChart,
    priority: false,
  },
  {
    href: '/equity/investor-deal',
    title: 'Investor Deal Modeler',
    description: 'Model convertible note, SAFE, and preferred equity structures. See the full 5-lane package.',
    icon: Handshake,
    priority: false,
  },
  {
    href: '/equity/valuation',
    title: 'Valuation Calculator',
    description: 'Three valuation methods (DCF, multiples, asset/IP) blended into a defensible range.',
    icon: BarChart3,
    priority: false,
  },
  {
    href: '/equity/originator-fees',
    title: 'Originator Fee Calculator',
    description: 'Calculate tiered originator fees on sourced deals across different contract sizes.',
    icon: Calculator,
    priority: false,
  },
]

export default function DashboardPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          Equity & Valuation Modeling
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Scenario analysis for Ber Wilson Inc. partnership decisions.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-[1fr_280px]">
        <div className="grid gap-4 md:grid-cols-2 auto-rows-min">
          {MODULES.map(({ href, title, description, icon: Icon, priority }) => (
            <Link key={href} href={href} className="group">
              <Card className={`h-full transition-all hover:shadow-md ${priority ? 'border-amber-300 bg-amber-50/30' : ''}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-md ${priority ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}`}>
                      <Icon size={16} />
                    </div>
                    <CardTitle className="text-sm font-medium group-hover:text-amber-700 transition-colors">
                      {title}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-xs leading-relaxed">
                    {description}
                  </CardDescription>
                  {priority && (
                    <p className="text-xs text-amber-600 font-medium mt-2 uppercase tracking-wide">
                      Start here
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div>
          <ScenarioSelector />
        </div>
      </div>
    </div>
  )
}
