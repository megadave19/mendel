/**
 * Eval bench runner (v2.0 / F19).
 *
 * Loads every JSON fixture under `eval/fixtures/`, runs the REAL
 * `calculateConfidence` pipeline against each (offline mode = inputs already
 * pre-parsed in the fixture), and aggregates a CalibrationReport.
 *
 * The harness imports `calculateConfidence` directly — same function the
 * runtime runner uses — so the bench measures the actual pipeline, not a
 * copy. V2_PLAN §F19 "Integration (no-breakage)": pure additive.
 *
 * No IO except (a) loading fixture files and (b) returning the aggregated
 * report; rendering and writing are the reporter's job. Keeping this layer
 * pure makes it usable from tests + future CI surfaces.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { calculateConfidence } from '@/lib/agent/confidence/score'
import {
  FixtureCaseSchema,
  type BenchOptions,
  type CalibrationReport,
  type FixtureCase,
  type FixtureRunResult,
} from './types'
import { aggregateReport, scoreOne } from './scoring'

// ── Fixture loading ───────────────────────────────────────────────────────────

/**
 * Read every `*.json` fixture under `fixturesDir`. Each file must validate
 * against `FixtureCaseSchema` — a malformed fixture FAILS LOUDLY at load time
 * with the bad path attached, so the bench can never silently skip a case.
 */
export async function loadFixtures(fixturesDir: string): Promise<FixtureCase[]> {
  const entries = await readdir(fixturesDir, { withFileTypes: true })
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => path.join(fixturesDir, e.name))
    .sort() // deterministic load order

  const cases: FixtureCase[] = []
  for (const file of jsonFiles) {
    let raw: string
    try {
      raw = await readFile(file, 'utf-8')
    } catch (err) {
      throw new Error(`failed to read fixture ${file}: ${(err as Error).message}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`fixture ${file} is not valid JSON: ${(err as Error).message}`)
    }

    const validated = FixtureCaseSchema.safeParse(parsed)
    if (!validated.success) {
      const detail = validated.error.issues
        .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
        .join('\n')
      throw new Error(`fixture ${file} failed schema validation:\n${detail}`)
    }
    cases.push(validated.data)
  }
  return cases
}

// ── Running a single fixture (pure-ish — only the clock is impure) ────────────

/**
 * Invokes the REAL `calculateConfidence` pipeline on the fixture's pre-parsed
 * inputs, then scores the result against the fixture's expectation.
 */
export function runFixture(fixture: FixtureCase): FixtureRunResult {
  const start = Date.now()
  const observed = calculateConfidence(fixture.input)
  const durationMs = Date.now() - start
  return scoreOne({ fixture, observed, durationMs })
}

// ── Running the whole bench ───────────────────────────────────────────────────

export interface RunBenchInput {
  fixturesDir: string
  options?: BenchOptions
  /** Clock injection for tests. */
  now?: () => Date
}

export async function runBench(input: RunBenchInput): Promise<CalibrationReport> {
  const { fixturesDir, options = {}, now = () => new Date() } = input

  let cases = await loadFixtures(fixturesDir)
  if (options.onlyTag) {
    cases = cases.filter((c) => c.tags?.includes(options.onlyTag!) ?? false)
  }

  if (cases.length === 0) {
    // Empty bench is a real failure mode (typo on --only-tag, deleted dir).
    // Don't pretend "100% pass on 0 fixtures."
    throw new Error(
      options.onlyTag
        ? `no fixtures matched tag "${options.onlyTag}" in ${fixturesDir}`
        : `no fixtures found in ${fixturesDir}`,
    )
  }

  const results: FixtureRunResult[] = []
  for (const fx of cases) {
    results.push(runFixture(fx))
  }

  return aggregateReport({
    fixtures: results,
    generatedAt: now().toISOString(),
    releaseLabel: options.releaseLabel ?? 'local',
    gitCommit: options.gitCommit ?? null,
  })
}
