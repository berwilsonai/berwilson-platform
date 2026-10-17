import { AlertTriangle, CalendarClock, FileText, MapPin, TrendingUp } from 'lucide-react'

import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

/**
 * One realistic deal screen, rendered once per candidate direction.
 *
 * ⚠ IT USES ONLY TOKEN-BACKED CLASSES. No `slate-*`, no `amber-*`, no literal
 * hex — every colour, radius, shadow and gap here resolves through a CSS
 * variable, which is the only reason swapping the variables restyles it. A
 * single `text-amber-700` would sit unchanged across all three columns and
 * quietly make the comparison a lie.
 *
 * ⚠ AND THE CONTENT IS REAL. Steelton — Cleveland-Cliffs (PA), capture stage,
 * 99% win probability, 181 live documents, and a PSA closing dated 17 Oct 2026
 * against Ber Wilson's 1 Nov revision: all read out of the live database, not
 * invented. A mock-up with tidy fake data flatters a design. This one carries
 * the things that actually break a layout — a title that wraps, an address long
 * enough to truncate, a capture value that is genuinely unset, and a figure
 * that must not read as a failed render.
 *
 * Temporary, like `directions.css`. It dies with the two rejected directions.
 */
export default function DirectionPreview() {
  return (
    <div className="bg-background text-foreground p-4">
      {/* Breadcrumb + record header, as the project layout renders it */}
      <nav className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Projects</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="font-medium truncate">Steelton — Cleveland-Cliffs (PA)</span>
      </nav>

      <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold leading-tight">Steelton — Cleveland-Cliffs (PA)</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Cleveland-Cliffs Steelton LLC</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <MapPin size={11} className="shrink-0" />
            <span className="truncate">215 S Front St, Steelton, Dauphin County, PA</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Chip tone="info">Capture</Chip>
          <Chip tone="caution">Infrastructure</Chip>
        </div>
      </div>

      {/* Tab strip */}
      <div className="mt-4 flex items-center gap-4 border-b border-border text-sm overflow-hidden">
        {['Overview', 'Players', 'Documents', 'Milestones', 'Economics'].map((t, i) => (
          <span
            key={t}
            className={
              i === 0
                ? 'pb-2 -mb-px border-b-2 border-primary font-medium whitespace-nowrap'
                : 'pb-2 text-muted-foreground whitespace-nowrap'
            }
          >
            {t}
            {t === 'Documents' && <span className="ml-1.5 text-xs tnum text-muted-foreground">181</span>}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0 space-y-4">
          {/* The thing that outranks everything else on this record today */}
          <div className="flex items-start gap-2.5 rounded-lg px-3 py-2.5 bg-critical-surface text-critical ring-1 ring-inset ring-critical-edge">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <p className="text-xs">
              <strong className="font-semibold">PSA closing is today.</strong> The agreement sets
              17 Oct 2026; Ber Wilson is pushing to 1 Nov and the mail does not resolve it.
            </p>
          </div>

          {/* KPI band */}
          <Panel className="px-4 py-3">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-3">
              <div className="min-w-0">
                <dt className="label-caps text-muted-foreground">Win probability</dt>
                <dd className="mt-1 text-3xl font-semibold tnum heading-tight">99%</dd>
                <dd className="mt-0.5 text-xs text-muted-foreground">Capture stage</dd>
              </div>
              <div className="min-w-0">
                <dt className="label-caps text-muted-foreground">BW capture value</dt>
                {/* Not an em dash. §12: a bare em dash at a value's own weight
                    reads as a failed render — name the absence in words. */}
                <dd className="mt-1 text-3xl font-semibold text-muted-foreground heading-tight">
                  Not set
                </dd>
                <dd className="mt-0.5 text-xs text-muted-foreground">No economics model yet</dd>
              </div>
              <div className="min-w-0">
                <dt className="label-caps text-muted-foreground">Documents</dt>
                <dd className="mt-1 text-3xl font-semibold tnum heading-tight">181</dd>
                <dd className="mt-0.5 text-xs text-muted-foreground">9 from email, rest a data room</dd>
              </div>
            </dl>
          </Panel>

          {/* Narrative — the long-text case */}
          <Panel className="px-4 py-3">
            <h3 className="label-caps text-muted-foreground">Brief</h3>
            <p className="mt-2 text-sm leading-relaxed">
              Seller is Cleveland-Cliffs Steelton LLC, signing through Paul Finan, with financing
              arranged by JPMorgan Chase via Tensor IQ and Merlin Corbin carrying a 4% broker fee.
              The signed PCA states 900 MW of Planned IT Capacity, which at PUE 1.4 implies roughly
              1,260 utility MW — against a site roadmap topping out at 700 MW and PPL supporting
              300 MW today. Either the 900 is utility load mislabelled in a signed document, or the
              project needs some 560 MW more than it plans for.
            </p>
          </Panel>

          {/* A table — the dense, financial case */}
          <Panel className="overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
              <CalendarClock size={13} className="text-muted-foreground" />
              <h3 className="label-caps text-muted-foreground">Milestones</h3>
              <span className="ml-auto text-xs tnum text-muted-foreground">2</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="font-medium px-4 py-2 text-xs">Milestone</th>
                  <th className="font-medium px-4 py-2 text-xs">Target</th>
                  <th className="font-medium px-4 py-2 text-xs text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="px-4 py-2">PSA closing — as scheduled by Seller</td>
                  <td className="px-4 py-2 tnum">17 Oct 2026</td>
                  <td className="px-4 py-2 text-right">
                    <Chip tone="critical">Due today</Chip>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2">PSA closing — Ber Wilson target revision</td>
                  <td className="px-4 py-2 tnum">1 Nov 2026</td>
                  <td className="px-4 py-2 text-right">
                    <Chip tone="caution">Proposed</Chip>
                  </td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <div className="flex items-center gap-2">
            <Button>Open economics</Button>
            <Button variant="outline">Add update</Button>
            <Button variant="ghost">
              <FileText size={13} />
              Documents
            </Button>
          </div>
        </div>

        {/* Rail */}
        <div className="w-full lg:w-64 shrink-0 space-y-3">
          <Panel className="px-4 py-3">
            <h3 className="label-caps text-muted-foreground">Pursuit</h3>
            <div className="mt-3 space-y-2.5 text-sm">
              {([
                ['Counterparty', 'Cleveland-Cliffs'],
                ['Signatory', 'Paul Finan'],
                ['Financing', 'JPMorgan Chase'],
                ['Broker fee', '4.0%'],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-muted-foreground shrink-0">{k}</span>
                  <span className="text-xs font-medium text-right truncate">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Win probability</span>
                <span className="tnum font-medium">99%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full w-[99%] rounded-full bg-positive" />
              </div>
            </div>
          </Panel>

          <Panel className="px-4 py-3">
            <h3 className="label-caps text-muted-foreground">Capacity flag</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              900 IT MW implies ~1,260 utility MW. Roadmap caps at 700.
            </p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-caution">
              <TrendingUp size={12} className="shrink-0" />
              <span className="tnum">560 MW unaccounted</span>
            </p>
          </Panel>
        </div>
      </div>
    </div>
  )
}
