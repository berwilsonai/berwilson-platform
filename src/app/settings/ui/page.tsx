import { redirect } from 'next/navigation'
import { AlertTriangle, Check, Info, TriangleAlert } from 'lucide-react'

import { getViewer } from '@/lib/auth/viewer'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Kbd } from '@/components/ui/kbd'
import { STATUS_TONES, CATEGORY_TONES, type Tone } from '@/lib/ui/tone'
import { measureTones, readThemeTokens } from '@/lib/ui/tokens'
import DirectionGallery from './DirectionGallery'

export const metadata = { title: 'Interface — Ber Wilson Intelligence' }

/**
 * The living style guide, and the verification instrument for the UI work.
 *
 * ⚠ IT RENDERS BOTH THEMES AT ONCE, SIDE BY SIDE. That is the entire reason it
 * exists. Nothing else catches a wrong tone mapping or a dark-mode contrast
 * failure: a build exits 0, `tsc` is satisfied, the tests assert thresholds,
 * and the screen still looks wrong in the theme nobody opened. The right-hand
 * column is wrapped in `.dark`, which is all the theme switch is — a class on
 * an ancestor — so the dark column is genuinely the dark theme and not a
 * mock-up of it.
 *
 * ⚠ THE CONTRAST RATIOS ARE MEASURED AT RENDER, NOT TYPED IN. They are read
 * out of globals.css through the same module the tests use, so this page cannot
 * claim a ratio the palette does not actually have — and a figure printed here
 * going red is the first thing anyone will notice.
 *
 * URL-only on purpose: it is in `TITLE_EXTRAS` so the chrome names it, and in
 * no nav group, because a style guide is not one of the company's working
 * surfaces.
 */
export default async function UiSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string }>
}) {
  const viewer = await getViewer()
  if (viewer && !viewer.isAdmin) redirect('/tasks')

  const { direction } = await searchParams

  const measurements = measureTones()
  const tokens = readThemeTokens()
  const light = measurements.filter((m) => m.theme === 'light')
  const dark = measurements.filter((m) => m.theme === 'dark')

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Interface</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every token and primitive, rendered in both themes at once. This is the page to open
          after any change to the palette, the type scale or a shared component — a dark-mode
          contrast failure is invisible everywhere else until someone hits it on a real screen.
        </p>
      </header>

      <DirectionGallery only={direction} />

      <div className="border-t border-border pt-5">
        <h2 className="text-lg font-semibold">Current tokens and primitives</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          What is live today. The directions above do not touch any of this — they are scoped to
          their own previews.
        </p>
      </div>

      {/* ── Tones ──────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Status tones" count={STATUS_TONES.length} />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          Four meanings plus two modifiers. These resolve to CSS tokens, so one class carries both
          themes and there is no <code className="font-mono">dark:</code> variant left to forget.
          <strong className="text-foreground"> critical</strong> is a status;{' '}
          <strong className="text-foreground">destructive</strong> is an action — they are
          deliberately different colours.
        </p>
        <TwoThemes>
          <div className="flex flex-wrap gap-2">
            {STATUS_TONES.map((t) => (
              <Chip key={t} tone={t}>
                {t}
              </Chip>
            ))}
          </div>
        </TwoThemes>
      </Panel>

      <Panel>
        <PanelHeader label="Categorical tones" count={CATEGORY_TONES.length} />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          These say only &ldquo;a different kind from that one&rdquo; — a sector, a lane, a line of
          business. No semantic token, because <code className="font-mono">--violet</code> is not an
          improvement on <code className="font-mono">violet</code>; they carry explicit light and
          dark halves instead, in one place.
        </p>
        <TwoThemes>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_TONES.map((t) => (
              <Chip key={t} tone={t}>
                {t}
              </Chip>
            ))}
          </div>
        </TwoThemes>
      </Panel>

      {/* ── Measured contrast ──────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Measured contrast" />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          Read out of <code className="font-mono">globals.css</code> at render through the same
          module the test suite asserts on. Text needs 4.5:1; a tinted block needs only to be
          perceptible. The <em>surface on canvas</em> column is the one to watch — in light mode a
          tinted block off a card reads at barely 1.05:1, which is why the ring is not decoration.
        </p>
        <div className="p-4 grid gap-4 lg:grid-cols-2">
          <ContrastTable title="Light" rows={light} />
          <ContrastTable title="Dark" rows={dark} />
        </div>
      </Panel>

      {/* ── Type scale ─────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Type scale" />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          <code className="font-mono">xs</code> and <code className="font-mono">sm</code> run a
          notch above Tailwind&apos;s defaults because they are the workhorses of a tool read all
          day. The five above them are tokenised at Tailwind&apos;s exact defaults for now, so the
          ladder can be adjusted in one place without having moved anything yet.
        </p>
        <TwoThemes>
          <div className="space-y-2">
            {([
              ['text-3xl', '$152.5M'],
              ['text-2xl', 'Good morning, Richard'],
              ['text-xl', 'Steelton — Cleveland-Cliffs'],
              ['text-lg', 'Pipeline value'],
              ['text-base', 'Body copy at base size'],
              ['text-sm', 'The workhorse: body and most labels'],
              ['text-xs', 'The most-used size in this application'],
            ] as const).map(([cls, sample]) => (
              <div key={cls} className="flex items-baseline gap-3">
                <span className="label-caps text-muted-foreground w-20 shrink-0">{cls.replace('text-', '')}</span>
                <span className={`${cls} font-semibold heading-tight`}>{sample}</span>
              </div>
            ))}
            <div className="flex items-baseline gap-3 pt-1">
              <span className="label-caps text-muted-foreground w-20 shrink-0">caps</span>
              <span className="label-caps text-muted-foreground">label-caps, the section label</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="label-caps text-muted-foreground w-20 shrink-0">tnum</span>
              <span className="text-sm tnum">1,240,000 · 74.9 MW · 17 Oct</span>
            </div>
          </div>
        </TwoThemes>
      </Panel>

      {/* ── Elevation ──────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Elevation" />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          Two-layer tinted shadows, re-declared darker for the dark theme. Always{' '}
          <code className="font-mono">.elev-*</code>, never a raw{' '}
          <code className="font-mono">shadow-*</code>. <code className="font-mono">.lift</code>{' '}
          adds the hover rise and now reads its duration from{' '}
          <code className="font-mono">--dur</code>.
        </p>
        <TwoThemes>
          <div className="flex flex-wrap gap-3">
            {['elev-1', 'elev-2', 'elev-3'].map((e) => (
              <div key={e} className={`rounded-xl border border-border bg-card px-4 py-3 text-xs ${e}`}>
                {e}
              </div>
            ))}
            <div className="rounded-xl border border-border bg-card px-4 py-3 text-xs elev-1 lift">
              .lift (hover)
            </div>
          </div>
        </TwoThemes>
      </Panel>

      {/* ── Buttons ────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Buttons" />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          Tab through these rather than clicking them: the focus ring is{' '}
          <code className="font-mono">focus-visible:</code> only, so a mouse click must not show
          it. Note <code className="font-mono">destructive</code> is a tinted style, not a solid
          red button.
        </p>
        <TwoThemes>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const).map((v) => (
                <Button key={v} variant={v}>
                  {v}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(['xs', 'sm', 'default', 'lg'] as const).map((s) => (
                <Button key={s} size={s} variant="outline">
                  size {s}
                </Button>
              ))}
              <Button disabled>disabled</Button>
            </div>
          </div>
        </TwoThemes>
      </Panel>

      {/* ── Callouts ───────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Callouts" />
        <p className="px-4 pt-3 text-xs text-muted-foreground max-w-prose">
          There is no <code className="font-mono">Alert</code> primitive yet — 38 blocks of this
          shape are hand-rolled across 18 files. These are the tones a shared one would take.
        </p>
        <TwoThemes>
          <div className="space-y-2">
            {([
              ['positive', Check, 'The filing audit came back clean — 103 documents, none misfiled.'],
              ['caution', TriangleAlert, 'Nine days to the Steelton close and the date is unresolved in the mail.'],
              ['critical', AlertTriangle, 'Planned IT capacity exceeds the grid roadmap by 560 MW.'],
              ['info', Info, 'Two protected projects are not included in anything on this page.'],
            ] as const).map(([tone, Icon, text]) => (
              <div
                key={tone}
                className={`flex items-start gap-2.5 rounded-lg px-3 py-2.5 ring-1 ring-inset ${
                  tone === 'positive'
                    ? 'bg-positive-surface text-positive ring-positive-edge'
                    : tone === 'caution'
                      ? 'bg-caution-surface text-caution ring-caution-edge'
                      : tone === 'critical'
                        ? 'bg-critical-surface text-critical ring-critical-edge'
                        : 'bg-info-surface text-info ring-info-edge'
                }`}
              >
                <Icon size={14} className="mt-0.5 shrink-0" />
                <p className="text-xs">{text}</p>
              </div>
            ))}
          </div>
        </TwoThemes>
      </Panel>

      {/* ── Keys ───────────────────────────────────────────────────────────── */}
      <Panel>
        <PanelHeader label="Keys" />
        <TwoThemes>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Kbd>⌘K</Kbd> command palette</span>
            <span className="flex items-center gap-1.5"><Kbd>⌘J</Kbd> Ask Ber AI</span>
            <span className="flex items-center gap-1.5"><Kbd>⌘/</Kbd> quick calc</span>
            <span className="flex items-center gap-1.5"><Kbd>j</Kbd><Kbd>k</Kbd> move</span>
          </div>
        </TwoThemes>
      </Panel>

      <p className="text-xs text-muted-foreground">
        {Object.keys(tokens.light).length} tokens in <code className="font-mono">:root</code>,{' '}
        {Object.keys(tokens.dark).length} in <code className="font-mono">.dark</code>.
      </p>
    </div>
  )
}

/**
 * The same children rendered twice, the right half inside `.dark`.
 *
 * `bg-background` on each half matters: without it the dark column inherits the
 * light canvas and every contrast judgement made by eye is wrong.
 */
function TwoThemes({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 grid gap-3 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="label-caps text-muted-foreground mb-3">Light</p>
        {children}
      </div>
      <div className="dark rounded-lg border border-border bg-background p-4">
        <p className="label-caps text-muted-foreground mb-3">Dark</p>
        {children}
      </div>
    </div>
  )
}

function ContrastTable({
  title,
  rows,
}: {
  title: string
  rows: ReturnType<typeof measureTones>
}) {
  const cell = (v: number | null, min: number) => {
    if (v === null) return <span className="text-muted-foreground">—</span>
    const ok = v >= min
    return (
      <span className={`tnum ${ok ? 'text-muted-foreground' : 'text-critical font-semibold'}`}>
        {v.toFixed(2)}
        {!ok && ' ⚠'}
      </span>
    )
  }
  return (
    <div>
      <p className="label-caps text-muted-foreground mb-2">{title}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="font-medium pb-2">tone</th>
            <th className="font-medium pb-2 text-right">ink/card</th>
            <th className="font-medium pb-2 text-right">ink/surf</th>
            <th className="font-medium pb-2 text-right">surf/card</th>
            <th className="font-medium pb-2 text-right">surf/canvas</th>
            <th className="font-medium pb-2 text-right">edge/card</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.theme}-${r.tone}`} className="border-t border-border">
              <td className="py-1.5">
                <Chip tone={r.tone as Tone}>{r.tone}</Chip>
              </td>
              <td className="py-1.5 text-right">{cell(r.inkOnCard, 4.5)}</td>
              <td className="py-1.5 text-right">{cell(r.inkOnSurface, 4.5)}</td>
              <td className="py-1.5 text-right">{cell(r.surfaceOnCard, 1.04)}</td>
              <td className="py-1.5 text-right">{cell(r.surfaceOnCanvas, 1.01)}</td>
              <td className="py-1.5 text-right">{cell(r.edgeOnCard, 1.25)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
