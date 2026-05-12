import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { LEGAL_DISCLAIMER } from '@/lib/equity/constants'
import {
  calculateBlendedValuation,
} from '@/lib/equity/calculations/valuation'
import {
  calculateAllExitResults,
  calculateBaselinePayout,
} from '@/lib/equity/calculations/exit-scenarios'
import {
  calculateAllDealFees,
  calculateTotalLifetimeFees,
} from '@/lib/equity/calculations/originator-fees'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)

const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return fmt(n)
}

const pct = (n: number) => `${n.toFixed(1)}%`

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: 'Helvetica', color: '#1e293b' },
  coverPage: { padding: 40, justifyContent: 'center', alignItems: 'center', fontFamily: 'Helvetica' },
  coverTitle: { fontSize: 28, fontFamily: 'Helvetica-Bold', color: '#1e293b', marginBottom: 8 },
  coverSubtitle: { fontSize: 14, color: '#64748b', marginBottom: 40 },
  coverScenario: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#d97706', marginBottom: 6 },
  coverMeta: { fontSize: 10, color: '#94a3b8' },
  watermark: { fontSize: 60, color: '#f1f5f9', position: 'absolute', top: 200, left: 80, transform: 'rotate(-30deg)' },
  sectionTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1e293b', marginBottom: 10, marginTop: 20 },
  subsectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#475569', marginBottom: 6, marginTop: 12 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0', paddingVertical: 4 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingBottom: 4, marginBottom: 2 },
  cell: { flex: 1, fontSize: 9 },
  cellRight: { flex: 1, fontSize: 9, textAlign: 'right' },
  cellBold: { flex: 1, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  cellRightBold: { flex: 1, fontSize: 9, textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  heroCard: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fcd34d', borderRadius: 4, padding: 12, marginBottom: 12 },
  heroValue: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#b45309', textAlign: 'center' },
  heroLabel: { fontSize: 8, color: '#92400e', textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  statGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 4, padding: 8, alignItems: 'center' },
  statValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1e293b' },
  statLabel: { fontSize: 7, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40 },
  footerText: { fontSize: 6.5, color: '#94a3b8', lineHeight: 1.4 },
  pageNumber: { position: 'absolute', bottom: 20, right: 40, fontSize: 8, color: '#94a3b8' },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TableRow({ cells, header = false }: { cells: { text: string; bold?: boolean; right?: boolean }[]; header?: boolean }) {
  return (
    <View style={header ? styles.headerRow : styles.row}>
      {cells.map((c, i) => (
        <Text
          key={i}
          style={
            c.bold && c.right ? styles.cellRightBold :
            c.bold ? styles.cellBold :
            c.right ? styles.cellRight :
            styles.cell
          }
        >
          {c.text}
        </Text>
      ))}
    </View>
  )
}

interface ScenarioPDFProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenario: any
  modules: string[]
  generatedBy: string
}

export function ScenarioPDF({ scenario, modules, generatedBy }: ScenarioPDFProps) {
  const valInputs = scenario.valuation_inputs ?? {}
  const capInputs = scenario.cap_table_inputs ?? {}
  const exitInputs = scenario.exit_scenario_inputs ?? {}
  const origInputs = scenario.originator_fee_inputs ?? {}

  return (
    <Document>
      {/* Cover Page */}
      <Page size="LETTER" style={styles.coverPage}>
        <Text style={styles.watermark}>BER WILSON</Text>
        <Text style={styles.coverTitle}>Ber Wilson Inc.</Text>
        <Text style={styles.coverSubtitle}>Equity & Valuation Modeling</Text>
        <Text style={styles.coverScenario}>{scenario.name}</Text>
        <Text style={styles.coverMeta}>Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
        <Text style={styles.coverMeta}>by {generatedBy}</Text>
        <View style={{ position: 'absolute', bottom: 40, left: 40, right: 40 }}>
          <Text style={styles.footerText}>{LEGAL_DISCLAIMER}</Text>
        </View>
      </Page>

      {/* Exit Scenarios */}
      {modules.includes('exit-scenarios') && exitInputs.exitValuations && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionTitle}>Exit Scenarios & Reality Check</Text>
          <View style={styles.statGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Eric&apos;s Ownership</Text>
              <Text style={styles.statValue}>{pct(exitInputs.ericPercentage ?? 51)}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Exit Year</Text>
              <Text style={styles.statValue}>Year {exitInputs.exitYear ?? 5}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Baseline (Unfunded)</Text>
              <Text style={styles.statValue}>{fmtCompact(calculateBaselinePayout(exitInputs))}</Text>
            </View>
          </View>

          <TableRow
            header
            cells={[
              { text: 'Exit Valuation', bold: true },
              { text: "Eric's Payout", bold: true, right: true },
              { text: "Investor's Payout", bold: true, right: true },
              { text: 'vs. Unfunded', bold: true, right: true },
              { text: 'Multiplier', bold: true, right: true },
            ]}
          />
          {calculateAllExitResults(exitInputs).map((r, i) => (
            <TableRow
              key={i}
              cells={[
                { text: fmtCompact(r.exitValuation) },
                { text: fmt(r.ericPayout), right: true },
                { text: fmt(r.investorPayout), right: true },
                { text: `${r.netGain > 0 ? '+' : ''}${fmt(r.netGain)}`, right: true },
                { text: `${r.multiplier.toFixed(1)}x`, right: true },
              ]}
            />
          ))}

          <View style={styles.footer}>
            <Text style={styles.footerText}>{LEGAL_DISCLAIMER}</Text>
          </View>
          <Text style={styles.pageNumber} render={({ pageNumber }) => `${pageNumber}`} />
        </Page>
      )}

      {/* Cap Table */}
      {modules.includes('cap-table') && capInputs.holders && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionTitle}>Cap Table</Text>
          <Text style={{ fontSize: 10, color: '#64748b', marginBottom: 12 }}>
            {capInputs.stage ? `Stage: ${capInputs.stage}` : ''}
          </Text>

          <TableRow
            header
            cells={[
              { text: 'Holder', bold: true },
              { text: 'Role', bold: true },
              { text: 'Class', bold: true },
              { text: '%', bold: true, right: true },
            ]}
          />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(capInputs.holders as any[]).map((h: any, i: number) => (
            <TableRow
              key={i}
              cells={[
                { text: h.name, bold: h.classB },
                { text: h.role },
                { text: h.classB ? 'Class B' : 'Class A' },
                { text: pct(h.percentage), right: true, bold: h.classB },
              ]}
            />
          ))}

          <View style={styles.footer}>
            <Text style={styles.footerText}>{LEGAL_DISCLAIMER}</Text>
          </View>
          <Text style={styles.pageNumber} render={({ pageNumber }) => `${pageNumber}`} />
        </Page>
      )}

      {/* Valuation */}
      {modules.includes('valuation') && valInputs.weightDCF !== undefined && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionTitle}>Valuation Calculator</Text>

          {(() => {
            const result = calculateBlendedValuation(valInputs)
            return (
              <>
                <View style={styles.heroCard}>
                  <Text style={styles.heroLabel}>Blended Valuation (Mid)</Text>
                  <Text style={styles.heroValue}>{fmtCompact(result.blended.mid)}</Text>
                </View>

                <View style={styles.statGrid}>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Conservative</Text>
                    <Text style={styles.statValue}>{fmtCompact(result.blended.low)}</Text>
                  </View>
                  <View style={styles.statBox}>
                    <Text style={styles.statLabel}>Optimistic</Text>
                    <Text style={styles.statValue}>{fmtCompact(result.blended.high)}</Text>
                  </View>
                </View>

                <Text style={styles.subsectionTitle}>By Method</Text>
                <TableRow
                  header
                  cells={[
                    { text: 'Method', bold: true },
                    { text: 'Low', bold: true, right: true },
                    { text: 'Mid', bold: true, right: true },
                    { text: 'High', bold: true, right: true },
                    { text: 'Weight', bold: true, right: true },
                  ]}
                />
                <TableRow cells={[
                  { text: 'DCF' },
                  { text: fmtCompact(result.dcf.low), right: true },
                  { text: fmtCompact(result.dcf.mid), right: true, bold: true },
                  { text: fmtCompact(result.dcf.high), right: true },
                  { text: pct(valInputs.weightDCF * 100), right: true },
                ]} />
                <TableRow cells={[
                  { text: 'Multiples' },
                  { text: fmtCompact(result.multiples.low), right: true },
                  { text: fmtCompact(result.multiples.mid), right: true, bold: true },
                  { text: fmtCompact(result.multiples.high), right: true },
                  { text: pct(valInputs.weightMultiples * 100), right: true },
                ]} />
                <TableRow cells={[
                  { text: 'Assets & IP' },
                  { text: fmtCompact(result.assets.low), right: true },
                  { text: fmtCompact(result.assets.mid), right: true, bold: true },
                  { text: fmtCompact(result.assets.high), right: true },
                  { text: pct(valInputs.weightAssets * 100), right: true },
                ]} />

                {valInputs.contracts && valInputs.contracts.length > 0 && (
                  <>
                    <Text style={styles.subsectionTitle}>Contract Portfolio</Text>
                    <TableRow
                      header
                      cells={[
                        { text: 'Contract', bold: true },
                        { text: 'Value', bold: true, right: true },
                        { text: 'Prob.', bold: true, right: true },
                        { text: 'Weighted', bold: true, right: true },
                      ]}
                    />
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(valInputs.contracts as any[]).map((c: any, i: number) => (
                      <TableRow key={i} cells={[
                        { text: c.name },
                        { text: fmtCompact(c.value), right: true },
                        { text: pct(c.probability * 100), right: true },
                        { text: fmtCompact(c.value * c.probability), right: true, bold: true },
                      ]} />
                    ))}
                  </>
                )}
              </>
            )
          })()}

          <View style={styles.footer}>
            <Text style={styles.footerText}>{LEGAL_DISCLAIMER}</Text>
          </View>
          <Text style={styles.pageNumber} render={({ pageNumber }) => `${pageNumber}`} />
        </Page>
      )}

      {/* Originator Fees */}
      {modules.includes('originator-fees') && origInputs.sampleDeals && origInputs.tiers && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionTitle}>Originator Fee Analysis</Text>

          {(() => {
            const results = calculateAllDealFees(
              origInputs.sampleDeals,
              origInputs.tiers,
              origInputs.netMarginAssumption ?? 0.12
            )
            const total = calculateTotalLifetimeFees(results)
            return (
              <>
                <View style={styles.heroCard}>
                  <Text style={styles.heroLabel}>Total Lifetime Originator Fees</Text>
                  <Text style={styles.heroValue}>{fmt(total)}</Text>
                </View>

                <TableRow
                  header
                  cells={[
                    { text: 'Deal', bold: true },
                    { text: 'Revenue', bold: true, right: true },
                    { text: 'Net Profit', bold: true, right: true },
                    { text: 'Fee', bold: true, right: true },
                    { text: 'Annual', bold: true, right: true },
                  ]}
                />
                {results.map((r, i) => (
                  <TableRow key={i} cells={[
                    { text: r.dealName },
                    { text: fmtCompact(r.contractRevenue), right: true },
                    { text: fmtCompact(r.netProfit), right: true },
                    { text: fmt(r.originatorFee), right: true, bold: true },
                    { text: `${fmtCompact(r.annualFee)}/yr`, right: true },
                  ]} />
                ))}
              </>
            )
          })()}

          <View style={styles.footer}>
            <Text style={styles.footerText}>{LEGAL_DISCLAIMER}</Text>
          </View>
          <Text style={styles.pageNumber} render={({ pageNumber }) => `${pageNumber}`} />
        </Page>
      )}
    </Document>
  )
}
