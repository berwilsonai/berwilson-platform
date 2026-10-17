import { count, scan, sourceFiles } from '../src/lib/ui/source-scan.ts'

const components = sourceFiles('src/components')
const rows: [string, number, string][] = [
  ['focus: (must be focus-visible:)',     count(/(?:^|[^-\w])focus:[a-z-]/),                    'src'],
  ['raw shadow-* in components',          count(/shadow-(?:sm|md|lg|xl|2xl|\[)/, components),   'src/components'],
  ['window.alert( / window.confirm(',     count(/window\.(?:alert|confirm)\(/),                 'src'],
  ['card shell at rounded-lg',            count(/rounded-lg border border-border bg-card/),     'src'],
  ['card shell at rounded-xl',            count(/rounded-xl border border-border bg-card/),     'src'],
  ['text-[11px] (label-caps longhand)',   count(/text-\[11px\]/),                               'src'],
  ['local input/label class constants',   count(/const\s+(?:input|label|textarea)\w*(?:Class|Cls|Classes)\s*=/), 'src'],
  ['raw badge triples outside tone.ts',   count(/'[^']*\bbg-[a-z]+-\d+[^']*\btext-[a-z]+-\d+[^']*'/), 'src'],
  ['aria-current (want MORE of this)',    count(/aria-current/),                                'src'],
]
console.log('\n  count  convention')
for (const [label, n] of rows) console.log(`  ${String(n).padStart(5)}  ${label}`)

console.log('\n  where the focus: hits are:')
for (const h of scan(/(?:^|[^-\w])focus:[a-z-]/)) console.log(`    ${h.file}:${h.line}  ${h.text.trim()}`)
console.log('\n  where the local class constants are:')
for (const h of scan(/const\s+(?:input|label|textarea)\w*(?:Class|Cls|Classes)\s*=/)) console.log(`    ${h.file}:${h.line}  ${h.text.trim()}`)
console.log()
