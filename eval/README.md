# Eval Bench — Mendel calibration honesty anchor (v2.0 / F19)

The bench runs the **real** scoring pipeline (`lib/agent/confidence/score.ts`)
against a curated set of fixtures with known-correct expected outcomes, and
emits a calibration report. The committed `reports/baseline.json` is the
honesty anchor per CLAUDE.md §5b v2 rule 2 — a calibration regression
release-over-release is stop-the-line.

## Run

```bash
pnpm eval                       # run, compare to baseline, exit non-zero on regression
pnpm eval --only-tag self-test  # filter
pnpm eval --update-baseline     # re-baselining ceremony (commit the result)
pnpm eval --label v2.0          # tag this report in its header
```

Reports land in `eval/reports/<timestamp>.{json,md}` (gitignored). The
markdown is scannable in a terminal AND a PR diff view.

## Add a fixture

Drop a JSON file under `eval/fixtures/`. Schema = `FixtureCase` in
`lib/eval/types.ts` (Zod-validated at load — malformed fixtures fail
loudly, never silently skipped).

Minimum fields:

```json
{
  "id": "filename-safe-id",
  "packageName": "real-or-synthetic",
  "fromVersion": "x.y.z",
  "toVersion": "x.y.z",
  "description": "what this case proves",
  "mode": "offline",
  "input": {
    "breakingChanges": [],
    "semanticDiff": null,
    "patchedFilePaths": [],
    "verificationPassed": true
  },
  "expected": {
    "bucket": "high|medium|low",
    "overall": { "min": 0, "max": 100 },
    "perSymbolHits": [{ "symbol": "foo", "shouldDetect": true }]
  }
}
```

`mode: "offline"` = inputs are pre-parsed (no network, deterministic, fast).
Live-tarball mode is a v2.x add — not v2.0.

## What's in the baseline today (v2.0)

5 fixtures, one per branch of the scoring matrix:

| id | exercise |
| --- | --- |
| `synthetic-self-test` | both-agree → score 90 → bucket **high** |
| `axios-0.24-to-0.27` | real public-API case, both-agree → **high** |
| `semantic-only-undocumented` | semantic catches what changelog missed → score 70 → **medium** |
| `changelog-only-high-coverage` | changelog asserts, semantic disagrees with full coverage → score 48 → **low** |
| `verification-failed-cap` | strong signals but Phase B failed → capped at 50 → **low** |
| `version-bump-only` | no signals → baseline 75 → **medium** |

The bench's own self-test fixture (`synthetic-self-test`) validates the
scorer math — if it ever fails, the scorer drifted.
