# Mendel Calibration Report — `local`

Generated: 2026-06-01T17:58:01.881Z · commit `42f90971bfa5`

## Headline

- **Fixtures:** 10
- **Passed:** 10 / 10 (100%)
- **Bucket accuracy:** 100%
- **Overall-in-range:** 100%

## Bucket confusion

| expected ↓ / observed → | high | medium | low |
| --- | --- | --- | --- |
| **high** | 3 | 0 | 0 |
| **medium** | 0 | 4 | 0 |
| **low** | 0 | 0 | 3 |

## Per-fixture

| status | id | package | bucket | overall | duration |
| --- | --- | --- | --- | --- | --- |
| ✓ | `axios-0.24-to-0.27` | axios 0.24.0→0.27.2 | high | 90 | 8ms |
| ✓ | `changelog-only-high-coverage` | synthetic-changelog-only 5.0.0→6.0.0 | low | 48 | 0ms |
| ✓ | `go-singlesignal-changelog` | github.com/example/widget v1.0.0→v2.0.0 | medium | 60 | 0ms |
| ✓ | `monorepo-cross-package-bump` | @scope/ui 3.0.0→4.0.0 | high | 90 | 0ms |
| ✓ | `python-cachetools-4-to-5` | cachetools 4.2.4→5.3.0 | medium | 74 | 0ms |
| ✓ | `semantic-only-undocumented` | synthetic-semantic-only 3.0.0→4.0.0 | medium | 70 | 0ms |
| ✓ | `smoke-failed-cap` | synthetic-smoke-cap 9.0.0→10.0.0 | low | 50 | 0ms |
| ✓ | `synthetic-self-test` | synthetic 1.0.0→2.0.0 | high | 90 | 0ms |
| ✓ | `verification-failed-cap` | synthetic-verify-cap 7.0.0→8.0.0 | low | 50 | 0ms |
| ✓ | `version-bump-only` | synthetic-bump-only 1.2.3→1.2.4 | medium | 75 | 0ms |

