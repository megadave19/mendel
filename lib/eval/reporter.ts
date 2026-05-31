/**
 * Eval reporter (v2.0 / F19).
 *
 * Renders a CalibrationReport to (a) deterministic JSON for the committed
 * baseline file, and (b) a human-readable markdown summary so the report is
 * scannable in a PR diff or terminal.
 *
 * Pure — no IO. The CLI writes the strings to disk.
 *
 * Determinism matters: the JSON shape is sorted (fixtures already sorted by
 * id in `aggregateReport`) and indented consistently so re-running the bench
 * on the same inputs produces a byte-identical baseline. That's what makes
 * `git diff eval/reports/baseline.json` a real calibration regression signal.
 */

import type { CalibrationReport, FixtureRunResult } from './types'

// ── JSON ─────────────────────────────────────────────────────────────────────

export function renderJsonReport(report: CalibrationReport): string {
  // 2-space indent + trailing newline; matches our prettier/JSON conventions.
  return JSON.stringify(report, null, 2) + '\n'
}

// ── Markdown ─────────────────────────────────────────────────────────────────

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length)
}

function statusGlyph(passed: boolean): string {
  return passed ? '✓' : '✕'
}

function renderConfusionTable(c: CalibrationReport['bucketConfusion']): string {
  // Row = expected bucket, col = observed bucket. Diagonal = correct.
  const rows = ['high', 'medium', 'low'] as const
  const cols = ['high', 'medium', 'low'] as const
  const header = `| expected ↓ / observed → | high | medium | low |`
  const sep =    `| --- | --- | --- | --- |`
  const body = rows
    .map((r) => `| **${r}** | ${cols.map((co) => String(c[r][co])).join(' | ')} |`)
    .join('\n')
  return [header, sep, body].join('\n')
}

function renderFixtureRow(f: FixtureRunResult): string {
  // Single-line per fixture so the table fits a terminal AND PR diff view.
  const bucket = `${f.observedBucket}${f.bucketMatch ? '' : ` (≠${f.expectedBucket})`}`
  const overall = `${f.observedOverall}${f.overallInRange ? '' : ` (∉[${f.expectedOverallMin},${f.expectedOverallMax}])`}`
  return `| ${statusGlyph(f.passed)} | \`${f.id}\` | ${f.packageName} ${f.fromVersion}→${f.toVersion} | ${bucket} | ${overall} | ${f.durationMs}ms |`
}

export function renderMarkdownReport(report: CalibrationReport): string {
  const t = report.totals
  const lines: string[] = []

  lines.push(`# Mendel Calibration Report — \`${report.release.label}\``)
  lines.push('')
  lines.push(`Generated: ${report.generatedAt}${report.release.gitCommit ? ` · commit \`${report.release.gitCommit.slice(0, 12)}\`` : ''}`)
  lines.push('')

  // Headline numbers — the §5b honesty anchor.
  lines.push('## Headline')
  lines.push('')
  lines.push(`- **Fixtures:** ${t.fixtures}`)
  lines.push(`- **Passed:** ${t.passed} / ${t.fixtures} (${pct(t.passed, t.fixtures)}%)`)
  lines.push(`- **Bucket accuracy:** ${t.bucketAccuracyPercent}%`)
  lines.push(`- **Overall-in-range:** ${t.overallInRangePercent}%`)
  lines.push('')

  // Confusion matrix — calibration health at a glance.
  lines.push('## Bucket confusion')
  lines.push('')
  lines.push(renderConfusionTable(report.bucketConfusion))
  lines.push('')

  // Per-fixture table.
  lines.push('## Per-fixture')
  lines.push('')
  lines.push('| status | id | package | bucket | overall | duration |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const f of report.fixtures) {
    lines.push(renderFixtureRow(f))
  }
  lines.push('')

  // Failure detail (only when there are failures — keep clean reports clean).
  const failed = report.fixtures.filter((f) => !f.passed)
  if (failed.length > 0) {
    lines.push('## Failures')
    lines.push('')
    for (const f of failed) {
      lines.push(`### \`${f.id}\``)
      for (const reason of f.failures) {
        lines.push(`- ${reason}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n') + '\n'
}

function pct(n: number, d: number): number {
  if (d === 0) return 0
  return Math.round((n / d) * 1000) / 10
}

// Re-export so callers don't need a second import for the symbol.
export { pad }
