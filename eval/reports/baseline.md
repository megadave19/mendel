# Mendel Calibration Report — `local`

Generated: 2026-06-01T22:57:09.104Z · commit `b0e2ef4cddff`

## Headline

- **Fixtures:** 14
- **Passed:** 14 / 14 (100%)
- **Bucket accuracy:** 100%
- **Overall-in-range:** 100%

## Bucket confusion

| expected ↓ / observed → | high | medium | low |
| --- | --- | --- | --- |
| **high** | 3 | 0 | 0 |
| **medium** | 0 | 8 | 0 |
| **low** | 0 | 0 | 3 |

## Per-fixture

| status | id | package | bucket | overall | duration |
| --- | --- | --- | --- | --- | --- |
| ✓ | `axios-0.24-to-0.27` | axios 0.24.0→0.27.2 | high | 90 | 7ms |
| ✓ | `changelog-only-high-coverage` | synthetic-changelog-only 5.0.0→6.0.0 | low | 48 | 0ms |
| ✓ | `go-httprouter-1-to-1-3` | github.com/julienschmidt/httprouter v1.0.0→v1.3.0 | medium | 75 | 0ms |
| ✓ | `go-singlesignal-changelog` | github.com/example/widget v1.0.0→v2.0.0 | medium | 60 | 0ms |
| ✓ | `monorepo-cross-package-bump` | @scope/ui 3.0.0→4.0.0 | high | 90 | 0ms |
| ✓ | `python-cachetools-4-to-5` | cachetools 4.2.4→5.3.0 | medium | 74 | 1ms |
| ✓ | `rust-maxbucket-clamp` | example-crate 1.0.0→2.0.0 | medium | 79 | 0ms |
| ✓ | `rust-semver-0-11-to-1` | semver 0.11.0→1.0.0 | medium | 72 | 0ms |
| ✓ | `rust-singlesignal-changelog` | example-widget 1.0.0→2.0.0 | medium | 60 | 0ms |
| ✓ | `semantic-only-undocumented` | synthetic-semantic-only 3.0.0→4.0.0 | medium | 70 | 0ms |
| ✓ | `smoke-failed-cap` | synthetic-smoke-cap 9.0.0→10.0.0 | low | 50 | 0ms |
| ✓ | `synthetic-self-test` | synthetic 1.0.0→2.0.0 | high | 90 | 0ms |
| ✓ | `verification-failed-cap` | synthetic-verify-cap 7.0.0→8.0.0 | low | 50 | 0ms |
| ✓ | `version-bump-only` | synthetic-bump-only 1.2.3→1.2.4 | medium | 75 | 0ms |

