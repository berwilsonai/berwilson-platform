// One-shot codemod: append `dark:` variants next to hardcoded light `slate`/`white`
// utility classes in the portfolio module so it renders correctly in dark mode.
// It only APPENDS — light-mode classes are untouched, so light mode is unchanged.
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../src/', import.meta.url)

const FILES = [
  'app/portfolio/page.tsx',
  'app/portfolio/sites/[id]/page.tsx',
  'app/portfolio/sites/[id]/layout.tsx',
  'components/portfolio/CapitalStackClient.tsx',
  'components/portfolio/SiteDocumentsClient.tsx',
  'components/portfolio/ComponentsClient.tsx',
  'components/portfolio/PortfolioKanban.tsx',
  'components/portfolio/StakeholdersClient.tsx',
  'components/portfolio/ComplianceClient.tsx',
  'components/portfolio/SiteTabBar.tsx',
]

// light class -> dark variant to append. Longer/prefixed keys first.
const MAP = {
  'hover:bg-slate-700': 'dark:hover:bg-white/10',
  'hover:bg-slate-100': 'dark:hover:bg-muted',
  'hover:bg-slate-50': 'dark:hover:bg-muted/50',
  'hover:border-slate-300': 'dark:hover:border-border',
  'hover:border-slate-400': 'dark:hover:border-border',
  'hover:text-slate-900': 'dark:hover:text-foreground',
  'hover:text-slate-700': 'dark:hover:text-slate-200',
  'bg-white': 'dark:bg-card',
  'border-slate-200': 'dark:border-border',
  'border-slate-100': 'dark:border-border/60',
  'border-slate-50': 'dark:border-border/40',
  'border-slate-900': 'dark:border-white/20',
  'ring-slate-200': 'dark:ring-border',
  'divide-slate-100': 'dark:divide-border/60',
  'text-slate-900': 'dark:text-foreground',
  'text-slate-700': 'dark:text-slate-200',
  'text-slate-600': 'dark:text-slate-300',
  'text-slate-500': 'dark:text-muted-foreground',
  'text-slate-400': 'dark:text-muted-foreground',
  'text-slate-300': 'dark:text-muted-foreground',
  'bg-slate-50': 'dark:bg-muted/50',
  'bg-slate-100': 'dark:bg-muted',
  'bg-slate-900': 'dark:bg-white/15',
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

let totalEdits = 0
for (const rel of FILES) {
  const url = new URL(rel, ROOT)
  let src = readFileSync(url, 'utf8')
  let fileEdits = 0
  for (const [light, dark] of Object.entries(MAP)) {
    // Match the token only at a class boundary (not preceded by [\w:-], not
    // followed by [\w-]) and not already followed by its dark variant.
    const re = new RegExp(`(?<![\\w:-])${esc(light)}(?![\\w-])(?!\\s+${esc(dark)})`, 'g')
    src = src.replace(re, (m) => {
      fileEdits++
      return `${m} ${dark}`
    })
  }
  if (fileEdits > 0) {
    writeFileSync(url, src)
    totalEdits += fileEdits
    console.log(`${rel}: +${fileEdits}`)
  } else {
    console.log(`${rel}: (no changes)`)
  }
}
console.log(`\nTotal dark variants appended: ${totalEdits}`)
