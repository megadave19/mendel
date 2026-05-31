/**
 * CLI: `pnpm eval` — runs the calibration bench (F19).
 *
 * Resolves:
 *   - fixtures from   ./eval/fixtures
 *   - writes JSON to  ./eval/reports/<timestamp>.json  (gitignored)
 *   - writes MD   to  ./eval/reports/<timestamp>.md    (gitignored)
 *   - compares against ./eval/reports/baseline.json    (committed honesty anchor)
 *
 * Exit codes:
 *   0  bench passed AND not a regression vs. baseline
 *   1  regression detected (newly-failing fixtures OR bucket-accuracy drop)
 *   2  bench failed to run (missing dir, malformed fixture, etc.)
 *
 * Flags:
 *   --only-tag <tag>       run only fixtures matching `tags`
 *   --baseline <path>      override the baseline path
 *   --update-baseline      write the current report to baseline.json (re-baselining ceremony)
 *   --label <text>         release label written into the report (default: "local")
 *
 * Eval is CLI-only by design (V2_PLAN §F19) — it must NEVER be exposed as an
 * unauthenticated HTTP endpoint (CLAUDE.md §5 rule 17 / §11 forbidden).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { runBench } from '@/lib/eval/bench-runner'
import { compareToBaseline } from '@/lib/eval/scoring'
import { renderJsonReport, renderMarkdownReport } from '@/lib/eval/reporter'
import { CalibrationReportSchema, type CalibrationReport } from '@/lib/eval/types'

interface CliArgs {
  onlyTag?: string
  baseline: string
  updateBaseline: boolean
  label: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    baseline: path.resolve('eval/reports/baseline.json'),
    updateBaseline: false,
    label: 'local',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only-tag') {
      args.onlyTag = argv[++i]
    } else if (a === '--baseline') {
      args.baseline = path.resolve(argv[++i])
    } else if (a === '--update-baseline') {
      args.updateBaseline = true
    } else if (a === '--label') {
      args.label = argv[++i]
    } else if (a === '-h' || a === '--help') {
      // Inline help is enough for a 4-flag CLI; no commander dep needed.
      console.log(
`pnpm eval [flags]

  --only-tag <tag>       run only fixtures matching tags
  --baseline <path>      override baseline (default: eval/reports/baseline.json)
  --update-baseline      re-baseline (overwrite committed baseline.json)
  --label <text>         release label in the report (default: "local")
`)
      process.exit(0)
    } else {
      console.error(`unknown flag: ${a}`)
      process.exit(2)
    }
  }
  return args
}

async function loadBaseline(p: string): Promise<CalibrationReport | null> {
  if (!existsSync(p)) return null
  try {
    const raw = await readFile(p, 'utf-8')
    const parsed = JSON.parse(raw)
    return CalibrationReportSchema.parse(parsed)
  } catch (err) {
    console.error(`baseline at ${p} is corrupt: ${(err as Error).message}`)
    process.exit(2)
  }
}

function shortSha(): string | null {
  // Best-effort, never blocks the bench. Used for the report header only.
  // CLAUDE.md §5 rule 18: new child-process calls use execFile (args-as-array),
  // never a shell string — no shell = no injection surface.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process')
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  const fixturesDir = path.resolve(cwd, 'eval/fixtures')
  const reportsDir = path.resolve(cwd, 'eval/reports')

  if (!existsSync(fixturesDir)) {
    console.error(`fixtures dir not found: ${fixturesDir}`)
    process.exit(2)
  }
  await mkdir(reportsDir, { recursive: true })

  let report: CalibrationReport
  try {
    report = await runBench({
      fixturesDir,
      options: {
        releaseLabel: args.label,
        gitCommit: shortSha(),
        onlyTag: args.onlyTag,
      },
    })
  } catch (err) {
    console.error(`bench failed to run: ${(err as Error).message}`)
    process.exit(2)
  }

  // Render JSON + markdown. Timestamped filenames keep history without
  // polluting the committed baseline.
  const stamp = report.generatedAt.replace(/[:.]/g, '-')
  const jsonPath = path.join(reportsDir, `${stamp}.json`)
  const mdPath = path.join(reportsDir, `${stamp}.md`)
  await writeFile(jsonPath, renderJsonReport(report))
  await writeFile(mdPath, renderMarkdownReport(report))

  // Console summary — keep it scannable.
  console.log(`\nMendel Calibration Report — ${args.label}`)
  console.log(`Fixtures: ${report.totals.fixtures} · Passed: ${report.totals.passed} / ${report.totals.fixtures}`)
  console.log(`Bucket accuracy: ${report.totals.bucketAccuracyPercent}%`)
  console.log(`Overall-in-range: ${report.totals.overallInRangePercent}%`)
  console.log(`Report: ${path.relative(cwd, mdPath)}`)

  // Re-baseline ceremony — overwrite the committed honesty anchor.
  // Write BOTH baseline.json (the machine-comparable source of truth) and
  // baseline.md (the human-readable companion that lives next to it). Both
  // are gitignore-excepted; everything else under reports/ stays local.
  if (args.updateBaseline) {
    const baselineMd = args.baseline.replace(/\.json$/, '.md')
    await writeFile(args.baseline, renderJsonReport(report))
    await writeFile(baselineMd, renderMarkdownReport(report))
    console.log(`\n↑ baseline updated → ${path.relative(cwd, args.baseline)}`)
    console.log(`              + → ${path.relative(cwd, baselineMd)}`)
    console.log('  Commit both. Any future regression vs. baseline.json is stop-the-line (§5b v2 rule 2).')
    process.exit(0)
  }

  // Baseline regression check.
  const baseline = await loadBaseline(args.baseline)
  if (!baseline) {
    console.log(`\n(no baseline at ${path.relative(cwd, args.baseline)} — run with --update-baseline to seed one)`)
    process.exit(report.totals.failed === 0 ? 0 : 1)
  }

  const verdict = compareToBaseline(baseline, report)
  console.log('\nvs. baseline:')
  for (const line of verdict.summary) console.log(`  ${line}`)

  if (!verdict.ok) {
    console.log('\n✕ calibration regression — stop-the-line per CLAUDE.md §5b v2 rule 2')
    process.exit(1)
  }
  console.log('\n✓ no regression vs. baseline')
  process.exit(report.totals.failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err))
  process.exit(2)
})
